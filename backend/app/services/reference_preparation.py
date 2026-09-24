"""Managed audio imports, explicitly selected trims, durable voices and leases."""
from __future__ import annotations

import array
import hashlib
import json
import math
import shutil
import subprocess
import sys
import wave
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.errors import DomainError
from app.services.migrations import now_iso

MAX_IMPORT=50*1024*1024


def run_audio(args):
    try:
        return subprocess.run(args,capture_output=True,timeout=60,check=True)
    except (OSError,subprocess.SubprocessError) as exc:
        raise DomainError('INVALID_AUDIO','音频无法解码，请检查格式或重新导出。',status=422) from exc


def probe(path):
    result=run_audio(['ffprobe','-v','error','-select_streams','a:0','-show_entries',
        'stream=codec_name,sample_rate,channels:format=duration,format_name','-of','json',str(path)])
    try:
        body=json.loads(result.stdout); stream=body['streams'][0]
        duration=float(body['format']['duration'])
        if not math.isfinite(duration) or duration<=0:
            raise ValueError()
        return {'duration_seconds':duration,'sample_rate':int(stream['sample_rate']),
            'channels':int(stream['channels']),'codec':stream['codec_name'],
            'container':body['format'].get('format_name',''),'bytes':path.stat().st_size}
    except (KeyError,IndexError,ValueError) as exc:
        raise DomainError('INVALID_AUDIO','未检测到有效音轨。',status=422) from exc


def quality(path):
    with wave.open(str(path),'rb') as source:
        rate=source.getframerate(); samples=array.array('h',source.readframes(source.getnframes()))
    if sys.byteorder!='little':
        samples.byteswap()
    threshold=32768*10**(-45/20)
    silent=0; run=0; sumsq=0; loud=0; clipped=0
    for sample in samples:
        if abs(sample)<threshold:
            run+=1
        else:
            if run>=rate*.3: silent+=run
            run=0; sumsq+=(sample/32768)**2; loud+=1
        if abs(sample)>=32768*.999: clipped+=1
    if run>=rate*.3: silent+=run
    silence_ratio=silent/max(1,len(samples)); clipping=clipped/max(1,len(samples))
    rms=20*math.log10(math.sqrt(sumsq/loud)) if loud and sumsq else None
    warnings=[]
    if not loud: warnings.append('片段中未检测到清晰声音，建议重新录制。')
    elif silence_ratio>.4: warnings.append('片段静音较多，建议缩短选区。')
    if rms is not None and rms<-30: warnings.append('声音较轻，建议选择音量更稳定的片段。')
    if clipping>.001: warnings.append('检测到削波，建议换用未过载的录音。')
    return {'silence_ratio':round(silence_ratio,4),'non_silent_rms_db':rms,
        'clipping_ratio':round(clipping,4),'warnings':warnings}


class ReferenceService:
    def __init__(self,store):
        self.store=store
        self.root=store.data_root

    def import_audio(self,name,source):
        suffix=Path(name).suffix.lower()
        if suffix not in {'.wav','.mp3','.ogg','.m4a'}:
            raise DomainError('INVALID_AUDIO','支持 WAV、MP3、OGG Opus 和 M4A。',status=422)
        import_id=self.store.new_id('import'); directory=self.root/'cache'/'imports'/import_id
        directory.mkdir(parents=True,mode=0o700)
        path=directory/('source'+suffix)
        try:
            with path.open('wb') as dest:
                count=0
                while chunk:=source.read(1024*1024):
                    count+=len(chunk)
                    if count>MAX_IMPORT:
                        raise DomainError('REFERENCE_TOO_LARGE','源音频不能超过 50 MB。',status=422)
                    dest.write(chunk)
            path.chmod(0o600)
            metadata=probe(path)
            compatible={'.wav':['wav'],'.mp3':['mp3'],'.ogg':['ogg'],'.m4a':['mov','mp4','m4a']}
            if not any(item in metadata['container'].split(',') for item in compatible[suffix]):
                raise DomainError('INVALID_AUDIO','扩展名与实际音频容器不一致，请重新导出。',status=422)
            if suffix=='.ogg' and metadata['codec']!='opus':
                raise DomainError('INVALID_AUDIO','OGG 需使用 Opus 编码。',status=422)
            if metadata['duration_seconds']>600:
                raise DomainError('REFERENCE_TOO_LONG','源音频不能超过 10 分钟，请先截取。',status=422)
            mime={'.wav':'audio/wav','.mp3':'audio/mpeg','.ogg':'audio/ogg','.m4a':'audio/mp4'}[suffix]
            asset=self.store.register_asset(path,mime,owner_id=import_id,kind='reference_import',ownership='managed_reference')
            stamp=now_iso();expires=(datetime.now(timezone.utc)+timedelta(hours=1)).isoformat()
            with self.store._connect() as db:
                db.execute('INSERT INTO imports VALUES (?,?,?,?,?,?)',(import_id,asset['id'],json.dumps(metadata),expires,stamp,stamp))
            return {'import_id':import_id,'name':Path(name).name,'preview_asset_id':asset['id'],
                'needs_trim':metadata['duration_seconds']>30,'needs_conversion':suffix!='.wav' or metadata['channels']!=1,
                **metadata}
        except Exception:
            shutil.rmtree(directory)
            raise

    def prepare(self,import_id,start_seconds,end_seconds,name,persistent=False):
        with self.store._connect() as db:
            imported=db.execute('SELECT * FROM imports WHERE id=?',(import_id,)).fetchone()
        if not imported or imported['expires_at']<now_iso():
            raise DomainError('REFERENCE_EXPIRED','导入文件已过期，请重新选择。')
        metadata=json.loads(imported['metadata_json'])
        if (not math.isfinite(start_seconds) or not math.isfinite(end_seconds) or start_seconds<0 or
            end_seconds<=start_seconds or end_seconds-start_seconds>30 or end_seconds>metadata['duration_seconds']+.005):
            raise DomainError('REFERENCE_TOO_LONG','选区必须位于音频内，且大于 0 秒、不超过 30 秒。',status=422)
        source=self.store.resolve_asset(imported['source_asset_id'])['path']
        ref_id=self.store.new_id('voice')
        directory=self.root/('voices' if persistent else 'cache/voices')/ref_id
        directory.mkdir(parents=True,mode=0o700)
        path=directory/'reference.wav'
        rate=metadata['sample_rate'] if metadata['sample_rate'] in {8000,16000,24000,44100,48000} else 48000
        try:
            run_audio(['ffmpeg','-nostdin','-v','error','-i',str(source),'-ss',str(start_seconds),'-t',str(end_seconds-start_seconds),
                '-vn','-ac','1','-ar',str(rate),'-c:a','pcm_s16le',str(path)])
            checked=probe(path)
            if checked['duration_seconds']>30.001 or path.stat().st_size>10*1024*1024:
                raise DomainError('REFERENCE_TOO_LARGE','准备后的片段超过接口限制。',status=422)
            run_audio(['ffmpeg','-nostdin','-v','error','-i',str(path),'-f','null','-'])
            checked.update(quality(path));path.chmod(0o600)
            digest=hashlib.sha256(path.read_bytes()).hexdigest()
            asset=self.store.register_asset(path,'audio/wav',owner_id=ref_id,kind='reference',ownership='managed_reference',sha256=digest)
            stamp=now_iso(); expires=None if persistent else (datetime.now(timezone.utc)+timedelta(hours=1)).isoformat()
            with self.store._connect() as db:
                db.execute('INSERT INTO "references" VALUES (?,?,?,?,?,?,?,?,?,?,?)',
                    (ref_id,name.strip() or '我的声音',asset['id'],json.dumps(checked),int(persistent),None,None,expires,None,stamp,stamp))
            return self.get(ref_id)
        except Exception:
            shutil.rmtree(directory)
            raise

    def get(self,ref_id,allow_expired=False):
        with self.store._connect() as db:
            row=db.execute('SELECT * FROM "references" WHERE id=? AND deleted_at IS NULL',(ref_id,)).fetchone()
        if not row:
            raise DomainError('REFERENCE_EXPIRED','音色不存在或已被移除，请重新选择。')
        asset=self.store.resolve_asset(row['asset_id'])
        if asset['sha256'] and hashlib.sha256(asset['path'].read_bytes()).hexdigest()!=asset['sha256']:
            raise DomainError('REFERENCE_CHANGED','参考音频内容已变化，请重新导入并确认。')
        if not allow_expired and not row['persistent'] and row['expires_at'] and row['expires_at']<now_iso():
            with self.store._connect() as db:
                leased=db.execute('SELECT 1 FROM reference_leases WHERE reference_id=? AND released_at IS NULL',(ref_id,)).fetchone()
            if not leased:
                raise DomainError('REFERENCE_EXPIRED','临时音色已过期，请重新选择。')
        return {'id':row['id'],'reference_id':row['id'],'name':row['name'],'asset_id':row['asset_id'],
            'persistent':bool(row['persistent']),'sha256':asset['sha256'],**json.loads(row['metadata_json'])}

    def path(self,ref_id):
        return self.store.resolve_asset(self.get(ref_id)['asset_id'])['path']

    def list(self,persistent=True,q=''):
        with self.store._connect() as db:
            rows=db.execute('SELECT id FROM "references" WHERE deleted_at IS NULL AND persistent=? AND name LIKE ? ORDER BY updated_at DESC',
                (int(persistent),'%'+q+'%')).fetchall()
        items=[]
        for row in rows:
            try: items.append(self.get(row['id']))
            except (FileNotFoundError,KeyError,DomainError): pass
        return items

    def update(self,ref_id,name=None,persistent=None):
        ref=self.get(ref_id); stamp=now_iso()
        if persistent is False and ref['persistent']:
            raise DomainError('INVALID_PARAMS','已保存音色请通过明确的删除操作移除。',status=422)
        with self.store._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            if name is not None:
                db.execute('UPDATE "references" SET name=?,updated_at=? WHERE id=?',(name.strip(),stamp,ref_id))
            if persistent:
                if not ref['persistent']:
                    if db.execute('SELECT 1 FROM reference_leases WHERE reference_id=? AND released_at IS NULL',(ref_id,)).fetchone():
                        raise DomainError('REFERENCE_IN_USE','任务正在使用此音色，请完成后再保存到音色库。')
                    source=self.path(ref_id)
                    target=self.root/'voices'/ref_id/'reference.wav'
                    target.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
                    source.rename(target)
                    db.execute('UPDATE assets SET canonical_path=?,updated_at=? WHERE id=?',(str(target.resolve()),stamp,ref['asset_id']))
                db.execute('UPDATE "references" SET persistent=1,expires_at=NULL,updated_at=? WHERE id=?',(stamp,ref_id))
        return self.get(ref_id)

    def acquire(self,reference_ids,job_id):
        with self.store._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            stamp=now_iso()
            for ref_id in reference_ids:
                if not db.execute('SELECT 1 FROM "references" WHERE id=? AND deleted_at IS NULL',(ref_id,)).fetchone():
                    raise DomainError('REFERENCE_EXPIRED','音色已过期，请重新选择。')
                db.execute('INSERT OR REPLACE INTO reference_leases VALUES (?,?,?,?,?)',(job_id,ref_id,None,stamp,stamp))

    def release(self,job_id):
        with self.store._connect() as db:
            stamp=now_iso()
            db.execute('UPDATE reference_leases SET released_at=?,updated_at=? WHERE job_id=? AND released_at IS NULL',(stamp,stamp,job_id))

    def delete(self,ref_id):
        ref=self.get(ref_id,allow_expired=True)
        with self.store._connect() as db:
            db.execute('BEGIN IMMEDIATE')
            if db.execute('SELECT 1 FROM reference_leases WHERE reference_id=? AND released_at IS NULL',(ref_id,)).fetchone():
                raise DomainError('REFERENCE_IN_USE','此音色正在被任务使用，请等任务结束后再删除。')
            path=self.store.resolve_asset(ref['asset_id'])['path']
            # Only app-owned managed copy; never a supplied original source path.
            if self.root.resolve() not in path.resolve().parents or path.is_symlink():
                raise DomainError('ASSET_CHANGED','素材位置已变化，未删除文件。')
            path.unlink(missing_ok=True)
            db.execute('UPDATE "references" SET deleted_at=? WHERE id=?',(now_iso(),ref_id))
            db.execute('UPDATE assets SET deleted_at=? WHERE id=?',(now_iso(),ref['asset_id']))

    def delete_import(self,import_id):
        with self.store._connect() as db:
            row=db.execute('SELECT source_asset_id FROM imports WHERE id=?',(import_id,)).fetchone()
            if not row: return
            asset=self.store.resolve_asset(row['source_asset_id'])
            path=asset['path']
            if self.root.resolve() not in path.resolve().parents or path.is_symlink():
                raise DomainError('ASSET_CHANGED','素材位置已变化，未删除文件。')
            path.unlink(missing_ok=True)
            db.execute('DELETE FROM imports WHERE id=?',(import_id,))
            db.execute('UPDATE assets SET deleted_at=? WHERE id=?',(now_iso(),row['source_asset_id']))

    def cleanup_expired(self,all_unused=False):
        removed=0; removed_bytes=0
        with self.store._connect() as db:
            refs=db.execute('SELECT id FROM "references" WHERE persistent=0 AND deleted_at IS NULL'+('' if all_unused else ' AND expires_at<?'),
                () if all_unused else (now_iso(),)).fetchall()
            imports=db.execute('SELECT id FROM imports'+('' if all_unused else ' WHERE expires_at<?'),() if all_unused else (now_iso(),)).fetchall()
        for row in refs:
            try:
                size=self.get(row['id'],allow_expired=True)['bytes']; self.delete(row['id']);removed+=1;removed_bytes+=size
            except (DomainError,FileNotFoundError): pass
        for row in imports:
            self.delete_import(row['id']);removed+=1
        return {'removed_count':removed,'removed_bytes':removed_bytes}

    def consent(self,project_id,reference_ids,confirmed):
        if not confirmed or not reference_ids or len(reference_ids)>3 or len(reference_ids)!=len(set(reference_ids)):
            raise DomainError('CONSENT_REQUIRED','请确认本次上传的具体参考音频。')
        self.store.get_project(project_id)
        for ref_id in reference_ids: self.get(ref_id)
        token=self.store.new_id('consent');stamp=now_iso()
        expires=(datetime.now(timezone.utc)+timedelta(minutes=10)).isoformat()
        with self.store._connect() as db:
            db.execute('INSERT INTO upload_consents VALUES (?,?,?,?,?,?,?)',
                (token,json.dumps(sorted(reference_ids)),project_id,expires,None,stamp,stamp))
        return {'consent_id':token,'expires_at':expires}
