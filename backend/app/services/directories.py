"""Native, allow-listed local output locations. No arbitrary path HTTP API."""
from __future__ import annotations

import json
import os
import re
import subprocess
import tempfile
from pathlib import Path

from app.errors import DomainError
from app.services.migrations import now_iso
from app.services.storage import require_safe_id


def native_picker():
    helper = Path(__file__).resolve().parents[3] / 'launcher' / 'DirectoryPicker'
    bundled = helper.parent / 'Qwen Folder Picker.app' / 'Contents' / 'MacOS' / 'DirectoryPicker'
    if bundled.is_file():
        helper = bundled
    if not helper.is_file():
        raise DomainError('DIRECTORY_PICKER_UNAVAILABLE', '文件夹选择器尚未安装，请重新运行安装程序。', status=503)
    try:
        result = subprocess.run([str(helper)], capture_output=True, text=True, timeout=180, check=True)
        body = json.loads(result.stdout)
        return None if body.get('cancelled') else Path(body['path'])
    except (OSError, subprocess.SubprocessError, ValueError, KeyError) as exc:
        raise DomainError('DIRECTORY_PICKER_FAILED', '文件夹选择未完成，请重试。', status=503) from exc


class DirectoryService:
    def __init__(self, store, picker=None):
        self.store = store
        self.picker = picker or native_picker
        root=store.data_root/'outputs'
        root.mkdir(parents=True,exist_ok=True)
        stamp=now_iso()
        with store._connect() as db:
            db.execute('INSERT OR IGNORE INTO output_directories VALUES (?,?,?,?,?,?)',
                ('dir_default',str(root.resolve()),'默认输出目录',stamp,stamp,stamp))

    def get(self, directory_id=None):
        directory_id = directory_id or self.store.settings()['default_directory_id'] or 'dir_default'
        with self.store._connect() as db:
            row = db.execute('SELECT * FROM output_directories WHERE id=?', (directory_id,)).fetchone()
        if row is None:
            raise DomainError('DIRECTORY_NOT_FOUND', '输出目录不存在，请重新选择。', status=404)
        return dict(row)

    def public(self, directory_id=None):
        row = self.get(directory_id)
        path = Path(row['canonical_path'])
        return {'id':row['id'], 'display_name':row['display_name'], 'display_path':str(path),
                'writable':path.is_dir() and os.access(path, os.W_OK)}

    @staticmethod
    def check_path(path):
        if not path.is_dir():
            raise DomainError('OUTPUT_VOLUME_UNAVAILABLE', '输出文件夹不存在或磁盘尚未连接。', status=422, field='output_directory_id')
        # access() alone can report writable on an unavailable/read-only volume.
        try:
            with tempfile.TemporaryFile(dir=path) as check:
                check.write(b'check')
                check.flush()
        except OSError as exc:
            raise DomainError('OUTPUT_NOT_WRITABLE', '无法写入所选文件夹，请检查权限或重新选择。', status=422, field='output_directory_id') from exc

    def choose(self):
        selected = self.picker()
        if selected is None:
            return {'cancelled':True}
        path = Path(selected).resolve(strict=True)
        self.check_path(path)
        stamp = now_iso()
        with self.store._connect() as db:
            db.execute('INSERT OR IGNORE INTO output_directories VALUES (?,?,?,?,?,?)',
                       (self.store.new_id('dir'), str(path), path.name or '输出目录', stamp, stamp, stamp))
            row = db.execute('SELECT id FROM output_directories WHERE canonical_path=?', (str(path),)).fetchone()
        return {'cancelled':False, 'directory':self.public(row['id'])}

    def validate(self, directory_id):
        row = self.get(directory_id)
        path = Path(row['canonical_path'])
        if path.resolve() != path:
            raise DomainError('OUTPUT_VOLUME_UNAVAILABLE', '输出目录位置已发生变化，请重新选择。', status=422)
        self.check_path(path)
        stamp = now_iso()
        with self.store._connect() as db:
            db.execute('UPDATE output_directories SET last_checked_at=? WHERE id=?', (stamp,row['id']))
        return {'writable':True, 'checked_at':stamp}

    def resolve_output(self, directory_id, project_id, job_id, title, output_format):
        require_safe_id(project_id)
        require_safe_id(job_id)
        if output_format not in {'wav','mp3','pcm'}:
            raise DomainError('INVALID_PARAMS', '不支持该输出格式。', status=422)
        root = Path(self.get(directory_id)['canonical_path'])
        self.validate(directory_id)
        safe = re.sub(r'[\x00-\x1f<>:"/\\|?*]+', '-', title).strip(' .-')[:70] or '音频'
        result = root / project_id / job_id / f'{safe}-{job_id[-8:]}.{output_format}'
        if root not in result.resolve().parents:
            raise DomainError('OUTPUT_NOT_WRITABLE', '输出路径无效。', status=422)
        return result

    def reveal(self, directory_id):
        row = self.get(directory_id)
        self.validate(directory_id)
        subprocess.run(['/usr/bin/open', row['canonical_path']], check=True, timeout=10)

    def reveal_asset(self, asset_id):
        asset = self.store.resolve_asset(asset_id)
        subprocess.run(['/usr/bin/open', '-R', str(asset['path'])], check=True, timeout=10)
