"""Transaction-backed generation batches; provider calls occur after commit."""
from __future__ import annotations

import hashlib
import json
import re

from app.errors import DomainError
from app.services.draft_compiler import DraftCompiler
from app.services.migrations import JOB_COLUMNS, job_row, now_iso
from app.services.storage import require_safe_id


class GenerationService:
    def __init__(self,store,adapter,directories,references,manager):
        self.store=store;self.adapter=adapter;self.directories=directories;self.references=references;self.manager=manager
        self.compiler=DraftCompiler(adapter)

    def canonical(self,payload):
        # Input snapshot digest permits safe replay even if draft revision later changed.
        body={key:payload.get(key) for key in ['project_id','expected_project_revision','mode','prompt','params','reference_bindings','output_directory_id','candidate_seeds']}
        return hashlib.sha256(json.dumps(body,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()

    def preflight(self,payload):
        try: project=self.store.get_project(payload['project_id'])
        except (ValueError,KeyError) as exc:
            raise DomainError('PROJECT_NOT_FOUND','草稿不存在，请先保存。',status=404) from exc
        if project['revision']!=payload['expected_project_revision']:
            raise DomainError('REVISION_CONFLICT','草稿已在另一处更新，请先载入最新版本。')
        bindings=payload.get('reference_bindings',[])
        previous=project['reference_bindings']
        if previous and payload['prompt']==project['prompt']:
            for raw in re.findall(r'@voice(\d+)',payload['prompt']):
                index=int(raw)-1
                if 0<=index<len(previous) and (index>=len(bindings) or previous[index]['reference_id']!=bindings[index]['reference_id']):
                    raise DomainError('INVALID_VOICE_BINDING','固定 @voice 编号的音色顺序发生变化，请检查台词绑定。',status=422,field='reference_bindings')
        seeds=payload['candidate_seeds']
        if len(seeds)!=len(set(seeds)):
            raise DomainError('INVALID_PARAMS','每个候选需要不同的 Seed。',status=422,field='candidate_seeds')
        compiled=self.compiler.compile(payload['mode'],payload['prompt'],bindings)
        params=payload['params']
        if params['format']=='mp3' and params['enable_cbr']:
            low,high=(8,64) if params['sample_rate']==8000 else ((8,160) if params['sample_rate'] in {16000,24000} else (32,320))
            if not low<=params['bit_rate']<=high:
                raise DomainError('INVALID_PARAMS',f'当前采样率的 MP3 CBR 码率范围为 {low}—{high} kbps，请调整。',status=422,field='params.bit_rate')
        # Reuse the provider-specific payload builder as the canonical validator.
        try:
            self.adapter.module.build_payload(prompt=compiled['compiled_prompt'],references=[],output_format=params['format'],
                sample_rate=params['sample_rate'],channels=params['channels'],volume=params['volume'],rate=params['rate'],
                seed=params['seed'],enable_cbr=params['enable_cbr'],bit_rate=params['bit_rate'],quality=params['quality'],
                enable_aigc_tag=params['enable_aigc_tag'])
        except (ValueError,RuntimeError) as exc:
            raise DomainError('INVALID_PARAMS','输出参数组合不受支持，请调整格式、采样率或编码参数。',status=422,field='params') from exc
        snapshots=[]
        for binding in bindings:
            try: ref=self.references.get(binding['reference_id'])
            except (FileNotFoundError,KeyError) as exc:
                raise DomainError('REFERENCE_EXPIRED','参考文件已缺失，请重新选择。') from exc
            snapshots.append({k:ref[k] for k in ['id','name','sha256','duration_seconds']})
            snapshots[-1]['reference_id']=snapshots[-1].pop('id')
            snapshots[-1]['alias']=binding.get('alias','')
        directory_id=payload.get('output_directory_id') or self.directories.get()['id']
        self.directories.validate(directory_id)
        # Includes effective output directory and immutable reference hashes/order.
        context={'payload_hash':self.canonical(payload),'directory_id':directory_id,'references':snapshots}
        digest=hashlib.sha256(json.dumps(context,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
        return {**compiled,'warnings':[],'output_directory':self.directories.public(directory_id),
            'request_hash':digest,'reference_snapshot':snapshots,'candidate_count':len(seeds)}

    def get(self,request_id):
        with self.store._connect() as db:
            row=db.execute('SELECT * FROM generation_requests WHERE client_request_id=?',(request_id,)).fetchone()
        if not row: raise DomainError('REQUEST_NOT_FOUND','未找到该生成请求。',status=404)
        ids=json.loads(row['job_ids_json'])
        return {'batch_id':row['batch_id'],'job_ids':ids,'client_request_id':request_id,
            'statuses':[self.store.get_job(job_id)['status'] for job_id in ids]}

    def submit(self,payload):
        request_id=payload['client_request_id'];require_safe_id(request_id)
        # The stored signature includes both the exact submitted content and its
        # confirmed environment. This stays comparable after a draft/ref deletion.
        digest=hashlib.sha256((self.canonical(payload)+payload['confirmed_request_hash']).encode()).hexdigest()
        with self.store._connect() as db:
            existing=db.execute('SELECT request_hash FROM generation_requests WHERE client_request_id=?',(request_id,)).fetchone()
        if existing:
            if existing['request_hash']!=digest:
                raise DomainError('DUPLICATE_REQUEST_MISMATCH','该请求标识对应的内容已改变，请重新预检。')
            return {**self.get(request_id),'created':False},False
        checked=self.preflight(payload)
        if checked['request_hash']!=payload['confirmed_request_hash']:
            raise DomainError('PREFLIGHT_CHANGED','生成内容已变化，请重新预检并确认。')
        project=self.store.get_project(payload['project_id'])
        refs=[r['reference_id'] for r in checked['reference_snapshot']]
        batch_id=self.store.new_id('batch');stamp=now_iso();ids=[]
        prepared_jobs=[]
        for seed in payload['candidate_seeds']:
            job_id=self.store.new_id('job')
            path=self.directories.resolve_output(checked['output_directory']['id'],project['id'],job_id,project['name'],payload['params']['format'])
            prepared_jobs.append((job_id,seed,path))
        db=self.store._connect()
        try:
            db.execute('BEGIN IMMEDIATE')
            # The second check closes concurrent-submit races before any paid work.
            existing=db.execute('SELECT request_hash FROM generation_requests WHERE client_request_id=?',(request_id,)).fetchone()
            if existing:
                db.rollback()
                if existing['request_hash']!=digest:
                    raise DomainError('DUPLICATE_REQUEST_MISMATCH','该请求标识对应的内容已改变。')
                return {**self.get(request_id),'created':False},False
            revision=db.execute('SELECT revision FROM projects WHERE id=?',(project['id'],)).fetchone()[0]
            if revision!=payload['expected_project_revision']:
                raise DomainError('REVISION_CONFLICT','草稿已发生变化，请重新预检。')
            if refs:
                consent=db.execute('SELECT * FROM upload_consents WHERE id=?',(payload.get('consent_id'),)).fetchone()
                if not consent or consent['project_id']!=project['id'] or sorted(refs)!=json.loads(consent['reference_ids_json']):
                    raise DomainError('CONSENT_REQUIRED','请确认本次上传的具体参考音频。')
                if consent['expires_at']<stamp or consent['consumed_by_request_id']:
                    raise DomainError('CONSENT_EXPIRED','本次上传确认已过期或已使用，请重新确认。')
                db.execute('UPDATE upload_consents SET consumed_by_request_id=? WHERE id=?',(request_id,consent['id']))
            for index,(job_id,seed,path) in enumerate(prepared_jobs):
                ids.append(job_id)
                row={'id':job_id,'batch_id':batch_id,'variant_index':index,'project_id':project['id'],
                    'project_name':project['name'],'display_name':project['name']+(f' · 候选 {index+1}' if len(payload['candidate_seeds'])>1 else ''),
                    'mode':payload['mode'],'prompt':payload['prompt'],'compiled_prompt':checked['compiled_prompt'],
                    'params':{**payload['params'],'seed':seed},'reference_snapshot':checked['reference_snapshot'],
                    'output_directory_id':checked['output_directory']['id'],'output_path_snapshot':str(path),
                    'status':'queued','created_at':stamp,'updated_at':stamp}
                db.execute(f'INSERT INTO jobs ({JOB_COLUMNS}) VALUES ({",".join("?"*26)})',job_row(row))
                for ref_id in refs:
                    if not db.execute('SELECT 1 FROM "references" WHERE id=? AND deleted_at IS NULL',(ref_id,)).fetchone():
                        raise DomainError('REFERENCE_EXPIRED','参考音色已被移除，请重新选择。')
                    db.execute('INSERT INTO reference_leases VALUES (?,?,?,?,?)',(job_id,ref_id,None,stamp,stamp))
            db.execute('INSERT INTO generation_requests VALUES (?,?,?,?,?,?,?,?)',
                (request_id,digest,batch_id,project['id'],revision,json.dumps(ids),stamp,stamp))
            db.commit()
        finally: db.close()
        for job_id in ids: self.manager.enqueue(job_id)
        return {**self.get(request_id),'created':True},True
