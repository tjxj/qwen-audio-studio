"""Library queries and recoverable generated-file operations."""
from __future__ import annotations

import json
from pathlib import Path
from threading import RLock

from app.errors import DomainError
from app.services.migrations import JOB_COLUMNS, PROJECT_COLUMNS, now_iso
from app.services.studio_store import _job_dict, _project_dict


def checked_path(path):
    path = Path(path)
    if not path.is_absolute() or path.is_symlink() or path.resolve() != path:
        raise DomainError('ASSET_CHANGED', '文件夹位置发生变化，请恢复原目录后重试。')
    return path


class LibraryService:
    def __init__(self, store):
        self.store = store
        self.operation_lock=RLock()

    def job(self, job_id):
        try:
            job = self.store.get_job(job_id)
        except (KeyError, ValueError) as exc:
            raise DomainError('JOB_NOT_FOUND', '作品不存在。', status=404) from exc
        asset = None
        if job['output_asset_id']:
            try:
                asset = self.store.resolve_asset(job['output_asset_id'])
            except (KeyError, FileNotFoundError, ValueError):
                pass
        report = job['report'] or {}
        project = self.store.get_project(job['project_id'])
        return {**job, 'file_available':asset is not None,
                'can_play':asset is not None and job['status']=='success' and job['params'].get('format') != 'pcm',
                'duration_seconds':report.get('duration_seconds'), 'seed':job['params'].get('seed',42),
                'is_final':project['final_job_id']==job_id,
                'references':[{'id':r['reference_id'], 'consent_token':''} for r in job['reference_snapshot']],
                'error_detail':job['error'],
                'error':job['error'].get('message') if isinstance(job['error'],dict) else job['error']}

    def list(self, view='jobs', filters=None, page=1, page_size=20):
        filters = filters or {}
        projects = view=='projects'
        table = 'projects' if projects else 'jobs'
        clauses = ['deleted_at IS NOT NULL' if view=='trash' else 'deleted_at IS NULL']
        values = []
        if projects:
            clauses.append('archived = 0')
        if filters.get('q'):
            columns = ['name','prompt'] if projects else ['display_name','project_name','prompt']
            clauses.append('(' + ' OR '.join(f'{key} LIKE ? ESCAPE \'\\\'' for key in columns) + ')')
            query = filters['q'].replace('\\','\\\\').replace('%','\\%').replace('_','\\_')
            values.extend(['%'+query+'%']*len(columns))
        for key in ['mode'] + ([] if projects else ['status','project_id','favorite']):
            if filters.get(key) is not None:
                clauses.append(f'{key}=?')
                values.append(filters[key])
        for key, operator in [('from','>='),('to','<')]:
            if filters.get(key):
                clauses.append(f'created_at {operator} ?')
                values.append(filters[key])
        where = ' AND '.join(clauses)
        columns = PROJECT_COLUMNS if projects else JOB_COLUMNS
        with self.store._connect() as db:
            total = db.execute(f'SELECT COUNT(*) FROM {table} WHERE {where}', values).fetchone()[0]
            rows = db.execute(f'SELECT {columns} FROM {table} WHERE {where} ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?',
                [*values,page_size,(page-1)*page_size]).fetchall()
        items = [_project_dict(row) for row in rows] if projects else [self.job(row['id']) for row in rows]
        # Public DTO never exposes a server path from an immutable output snapshot.
        for item in items:
            item.pop('output_path_snapshot',None)
        return {'items':items,'total':total,'page':page,'page_size':page_size}

    def trash(self, job_id, scope):
        with self.operation_lock:
            return self._trash(job_id,scope)

    def _trash(self, job_id, scope):
        job = self.job(job_id)
        if job['deleted_at']:
            return job
        if job['status'] in {'queued','running'}:
            raise DomainError('JOB_IN_USE','排队或生成中的任务不能移入回收站。')
        if scope not in {'record','record_and_files'}:
            raise DomainError('INVALID_PARAMS','请选择回收范围。',status=422)
        moves = []
        operation = self.store.new_id('trash')
        if scope=='record_and_files':
            with self.store._connect() as db:
                assets = db.execute("SELECT * FROM assets WHERE owner_id=? AND kind='generated_audio' AND deleted_at IS NULL",(job_id,)).fetchall()
            for asset in assets:
                if asset['ownership'] not in {'generated','legacy_generated'}:
                    continue
                path = Path(asset['canonical_path'])
                if not path.exists():
                    continue
                if path.is_symlink() or path.resolve()!=path:
                    raise DomainError('ASSET_CHANGED','文件位置发生变化，未移动任何文件。')
                root=path.parent
                if job.get('output_directory_id'):
                    with self.store._connect() as db:
                        location=db.execute('SELECT canonical_path FROM output_directories WHERE id=?',(job['output_directory_id'],)).fetchone()
                    if location and Path(location[0]) in path.parents:
                        root=Path(location[0])
                target = root / '.qwen-studio-trash' / operation / path.name
                checked_path(target)
                moves.append({'asset_id':asset['id'],'source':str(path),'target':str(target)})
                # Sidecars are owned only inside a V2 job's immutable output folder.
                if job.get('output_path_snapshot')==str(path) and path.parent.name==job_id:
                    for name in ['prompt.txt','report.json','report.md']:
                        sidecar=path.parent/name
                        if sidecar.is_file() and not sidecar.is_symlink() and sidecar.resolve()==sidecar:
                            moves.append({'asset_id':None,'source':str(sidecar),'target':str(target.parent/name)})
        stamp = now_iso()
        with self.store._connect() as db:
            db.execute('INSERT INTO file_operations VALUES (?,?,?,?,?,?,?,?)',
                (operation,scope,job_id,'planned',json.dumps(moves),None,stamp,stamp))
        completed=[]
        try:
            for move in moves:
                target=checked_path(move['target']); target.parent.mkdir(parents=True,exist_ok=True)
                checked_path(target)
                checked_path(move['source']).rename(target); completed.append(move)
            with self.store._connect() as db:
                db.execute('BEGIN IMMEDIATE')
                for move in moves:
                    if move['asset_id']:
                        db.execute('UPDATE assets SET canonical_path=?,deleted_at=?,hidden=1 WHERE id=?',
                            (move['target'],stamp,move['asset_id']))
                db.execute('UPDATE jobs SET deleted_at=?,updated_at=? WHERE id=?',(stamp,stamp,job_id))
                db.execute('UPDATE projects SET final_job_id=NULL WHERE final_job_id=?',(job_id,))
                db.execute("UPDATE file_operations SET state='done',updated_at=? WHERE id=?",(stamp,operation))
        except Exception as exc:
            for move in reversed(completed):
                checked_path(move['target']).rename(checked_path(move['source']))
            with self.store._connect() as db:
                db.execute("UPDATE file_operations SET state='failed',error_code='MOVE_FAILED' WHERE id=?",(operation,))
            raise DomainError('MOVE_FAILED','文件未能移入回收站，已保留原记录。',retryable=True) from exc
        return {**self.job(job_id),'trash_scope':scope}

    def restore(self, job_id):
        with self.operation_lock:
            return self._restore(job_id)

    def _restore(self, job_id):
        job = self.job(job_id)
        if not job['deleted_at']:
            return job
        with self.store._connect() as db:
            operation=db.execute("SELECT * FROM file_operations WHERE job_id=? AND state='done' ORDER BY created_at DESC LIMIT 1",(job_id,)).fetchone()
        moves = json.loads(operation['moves_json']) if operation else []
        for move in moves:
            original=checked_path(move['source'])
            checked_path(move['target'])
            target=original if not original.exists() else original.with_stem(original.stem+'-恢复-'+self.store.new_id('r')[-6:])
            move['restore_target']=str(target)
        if operation:
            with self.store._connect() as db:
                db.execute("UPDATE file_operations SET state='restoring',moves_json=?,updated_at=? WHERE id=?",(json.dumps(moves),now_iso(),operation['id']))
        restored=[]
        try:
            for move in moves:
                original=Path(move['source']); source=Path(move['target'])
                if not source.is_file() or source.is_symlink() or source.resolve()!=source:
                    raise OSError('trashed file unavailable')
                target=checked_path(move['restore_target'])
                if target.exists():
                    raise OSError('restore target changed')
                target.parent.mkdir(parents=True,exist_ok=True)
                checked_path(target)
                source.rename(target)
                restored.append((move,target))
            with self.store._connect() as db:
                db.execute('BEGIN IMMEDIATE')
                for move,target in restored:
                    if move['asset_id']:
                        db.execute('UPDATE assets SET canonical_path=?,deleted_at=NULL,hidden=0 WHERE id=?',(str(target),move['asset_id']))
                db.execute('UPDATE jobs SET deleted_at=NULL,updated_at=? WHERE id=?',(now_iso(),job_id))
                if operation:
                    db.execute("UPDATE file_operations SET state='restored',updated_at=? WHERE id=?",(now_iso(),operation['id']))
        except Exception as exc:
            for move,target in reversed(restored):
                target.rename(move['target'])
            if operation:
                with self.store._connect() as db:
                    db.execute("UPDATE file_operations SET state='done',error_code='RESTORE_FAILED' WHERE id=?",(operation['id'],))
            raise DomainError('RESTORE_FAILED','文件恢复失败，请确认原磁盘可用后重试。',retryable=True) from exc
        return self.job(job_id)

    def recover_operations(self):
        # A crash before the transaction commit leaves planned moves. Restore them.
        with self.store._connect() as db:
            pending=db.execute("SELECT * FROM file_operations WHERE state IN ('planned','restoring')").fetchall()
        for op in pending:
            try:
                for move in reversed(json.loads(op['moves_json'])):
                    source,target=Path(move['source']),Path(move['target'])
                    if op['state']=='restoring':
                        source,target=target,Path(move.get('restore_target',move['source']))
                    checked_path(target)
                    checked_path(source)
                    if target.exists() and source.exists():
                        raise OSError('recovery conflict')
                    if target.exists() and not source.exists():
                        target.rename(source)
                with self.store._connect() as db:
                    db.execute("UPDATE file_operations SET state=? WHERE id=?",('done' if op['state']=='restoring' else 'recovered',op['id']))
            except (OSError, DomainError):
                # Keep the journal retryable when an external disk is disconnected.
                pass
