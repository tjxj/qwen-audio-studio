"""Local inspiration library. Variables are plain text, never executable code."""
from __future__ import annotations

import json
import math
import re
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from app.errors import DomainError
from app.models import GenerationParams
from app.services.migrations import now_iso
from app.services.qwen_adapter import QwenAdapter

MODES = {'podcast', 'advertisement', 'audiobook', 'drama', 'game', 'narration', 'auto'}
TOKEN = re.compile(r'\{\{\s*([A-Za-z][A-Za-z0-9_]{0,39})\s*\}\}')
SENSITIVE = re.compile(r'\bsk-[A-Za-z0-9_-]{16,}|data:audio/[^\s]*|\bllm-[a-z0-9]{8,}', re.I)
EDITABLE = {'name', 'mode', 'description', 'tags', 'prompt_pattern', 'variables',
            'role_count', 'suggested_duration_seconds', 'params_preset'}
BUILTIN_PATH = Path(__file__).resolve().parents[2] / 'data' / 'templates.json'


def invalid(message: str, field: str = 'variables') -> DomainError:
    return DomainError('INVALID_TEMPLATE', message, status=422, field=field)


class TemplateService:
    def __init__(self, store, compiler=None):
        self.store = store
        self.compiler = compiler
        self.adapter = QwenAdapter(Path(__file__).resolve().parents[2] / 'vendor' / 'qwen_audio_studio_core.py') if compiler is None else None

    @contextmanager
    def _db(self):
        connection = self.store._connect()
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def initialize(self):
        """Seed by stable ID/version; favorites and user templates are untouched."""
        data = json.loads(BUILTIN_PATH.read_text(encoding='utf-8'))
        with self._db() as connection:
            for template in data:
                self._validate(template)
                previous = connection.execute('SELECT source,version FROM templates WHERE id=?', (template['id'],)).fetchone()
                if previous and (previous['source'] != 'builtin' or previous['version'] >= template['version']):
                    continue
                now = now_iso()
                connection.execute('''INSERT INTO templates
                    (id,source,version,name,mode,description,tags_json,prompt_pattern,variables_json,
                    role_count,suggested_duration_seconds,params_preset_json,created_at,updated_at)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                    ON CONFLICT(id) DO UPDATE SET version=excluded.version,name=excluded.name,
                    mode=excluded.mode,description=excluded.description,tags_json=excluded.tags_json,
                    prompt_pattern=excluded.prompt_pattern,variables_json=excluded.variables_json,
                    role_count=excluded.role_count,suggested_duration_seconds=excluded.suggested_duration_seconds,
                    params_preset_json=excluded.params_preset_json,updated_at=excluded.updated_at''',
                    self._row(template, now))

    @staticmethod
    def _row(item, now):
        return (item['id'], item['source'], item['version'], item['name'], item['mode'], item.get('description', ''),
                json.dumps(item.get('tags', []), ensure_ascii=False), item['prompt_pattern'],
                json.dumps(item.get('variables', []), ensure_ascii=False), item.get('role_count', 1),
                item.get('suggested_duration_seconds'), json.dumps(item['params_preset']) if item.get('params_preset') is not None else None, now, now)

    @staticmethod
    def _dto(row):
        result = dict(row)
        for key in ('tags', 'variables', 'params_preset'):
            raw = result.pop(key + '_json')
            result[key] = json.loads(raw) if raw else None
        result['favorite'] = bool(result.get('favorite', False))
        result.pop('deleted_at', None)
        return result

    def get(self, template_id):
        with self._db() as connection:
            row = connection.execute('''SELECT t.*,f.template_id IS NOT NULL AS favorite FROM templates t
                LEFT JOIN template_favorites f ON f.template_id=t.id WHERE t.id=? AND t.deleted_at IS NULL''', (template_id,)).fetchone()
        if row is None:
            raise DomainError('TEMPLATE_NOT_FOUND', '这个模板已删除或不存在。', status=404)
        return self._dto(row)

    def list_builtin(self):
        return self.list(source='builtin', page_size=50)['items']

    def list(self, *, mode=None, q='', favorite=None, source=None, page=1, page_size=20):
        if mode is not None and mode not in MODES:
            raise invalid('请选择有效的创作模式。', 'mode')
        if source not in (None, 'builtin', 'user') or page < 1 or page_size not in (20, 50) or len(q) > 200:
            raise invalid('模板筛选条件有误。', 'q')
        where, arguments = ['t.deleted_at IS NULL'], []
        for key, value in [('mode', mode), ('source', source)]:
            if value:
                where.append(f't.{key}=?')
                arguments.append(value)
        if favorite is not None:
            where.append('f.template_id IS NOT NULL' if favorite else 'f.template_id IS NULL')
        if q.strip():
            where.append("(t.name LIKE ? ESCAPE '\\' OR t.description LIKE ? ESCAPE '\\' OR t.tags_json LIKE ? ESCAPE '\\')")
            escaped = q.strip().replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
            arguments.extend([f'%{escaped}%'] * 3)
        query = ' FROM templates t LEFT JOIN template_favorites f ON f.template_id=t.id WHERE ' + ' AND '.join(where)
        with self._db() as connection:
            total = connection.execute('SELECT count(*)' + query, arguments).fetchone()[0]
            rows = connection.execute('SELECT t.*,f.template_id IS NOT NULL AS favorite' + query +
                                      " ORDER BY t.source DESC,CASE WHEN t.source='user' THEN t.updated_at END DESC,t.rowid LIMIT ? OFFSET ?",
                                      [*arguments, page_size, (page - 1) * page_size]).fetchall()
        return {'items': [self._dto(row) for row in rows], 'total': total, 'page': page, 'page_size': page_size}

    def _validate(self, item):
        for key, maximum, required in [('name', 80, True), ('description', 300, False), ('prompt_pattern', 3000, True)]:
            value = item.get(key, '')
            if not isinstance(value, str) or len(value) > maximum or (required and not value.strip()):
                raise invalid(f'{key} 必须为有效文本，最多 {maximum} 字。', key)
        if item.get('mode') not in MODES:
            raise invalid('请选择有效的创作模式。', 'mode')
        if SENSITIVE.search(json.dumps(item, ensure_ascii=False)):
            raise invalid('模板中不能保存 API Key、业务空间标识或音频数据，请先移除敏感内容。', 'prompt_pattern')
        tags = item.get('tags', [])
        if not isinstance(tags, list) or len(tags) > 12 or any(not isinstance(tag, str) or len(tag) > 30 for tag in tags):
            raise invalid('最多填写 12 个标签，每个不超过 30 字。', 'tags')
        role_count = item.get('role_count', 1)
        if type(role_count) is not int or not 0 <= role_count <= 3:
            raise invalid('角色数必须为 0—3。', 'role_count')
        duration = item.get('suggested_duration_seconds')
        if duration is not None and (type(duration) is not int or not 1 <= duration <= 600):
            raise invalid('建议时长必须为 1—600 秒。', 'suggested_duration_seconds')
        variables = item.get('variables', [])
        if not isinstance(variables, list) or len(variables) > 20:
            raise invalid('最多设置 20 个变量。')
        keys = set()
        for variable in variables:
            if not isinstance(variable, dict) or not isinstance(variable.get('key'), str) or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{0,39}', variable['key']):
                raise invalid('变量名称使用英文字母开头，仅含字母、数字和下划线。')
            if variable['key'] in keys or variable.get('type') not in ('text', 'number', 'select'):
                raise invalid('变量名称不可重复，类型仅支持文本、数字或选项。')
            if not isinstance(variable.get('label', ''), str) or len(variable.get('label', '')) > 80:
                raise invalid('变量标签最多 80 字。')
            keys.add(variable['key'])
            if variable['type'] == 'text' and (type(variable.get('max_length', 200)) is not int or not 1 <= variable.get('max_length', 200) <= 1000):
                raise invalid('文本变量长度限制为 1—1000 字。')
            if variable['type'] == 'select':
                options = variable.get('options')
                if not isinstance(options, list) or not 1 <= len(options) <= 30 or any(not isinstance(x, str) or not x or len(x) > 100 for x in options):
                    raise invalid('选项变量需要 1—30 个有效文本选项。')
            for bound in ('min', 'max'):
                if bound in variable and (type(variable[bound]) not in (int, float) or not math.isfinite(variable[bound])):
                    raise invalid('数字变量范围必须为有限数字。')
            if variable.get('min', -math.inf) > variable.get('max', math.inf):
                raise invalid('数字变量最小值不能大于最大值。')
        pattern = item['prompt_pattern']
        tokens = set(TOKEN.findall(pattern))
        if tokens != keys or '{{' in TOKEN.sub('', pattern) or '}}' in TOKEN.sub('', pattern):
            raise invalid('正文占位符与变量定义必须一致；仅支持 {{变量名}}。', 'prompt_pattern')
        preset = item.get('params_preset')
        if preset is not None:
            if not isinstance(preset, dict) or set(preset) - set(GenerationParams.model_fields):
                raise invalid('输出参数预设含未知字段。', 'params_preset')
            try:
                GenerationParams(**preset)
            except ValidationError as exc:
                raise invalid('输出参数预设不合法。', 'params_preset') from exc
        prompt, _ = self._expand(item, {})
        self._compile(item['mode'], prompt, [], allow_missing=True)

    def _expand(self, item, values):
        if not isinstance(values, dict):
            raise invalid('变量值必须为一个对象。')
        definitions = {v['key']: v for v in item.get('variables', [])}
        if set(values) - definitions.keys():
            raise invalid('填写了模板中未定义的变量。')
        resolved = {}
        for key, variable in definitions.items():
            value = values.get(key, variable.get('default', ''))
            if variable.get('required') and (value is None or isinstance(value, str) and not value.strip()):
                raise invalid(f'请填写“{variable.get("label", key)}”。', key)
            kind = variable['type']
            if kind == 'number':
                if type(value) not in (int, float) or not math.isfinite(value) or not variable.get('min', -math.inf) <= value <= variable.get('max', math.inf):
                    raise invalid(f'“{variable.get("label", key)}”需要有效范围内的数字。', key)
            elif not isinstance(value, str) or len(value) > variable.get('max_length', 200):
                raise invalid(f'“{variable.get("label", key)}”内容过长或格式不正确。', key)
            if kind == 'select' and value not in variable['options']:
                raise invalid(f'请为“{variable.get("label", key)}”选择有效选项。', key)
            if isinstance(value, str) and ('{{' in value or '}}' in value or SENSITIVE.search(value)):
                raise invalid('变量值不能包含模板表达式或敏感内容。', key)
            resolved[key] = value
        return TOKEN.sub(lambda match: str(resolved[match.group(1)]), item['prompt_pattern']), resolved

    def _compile(self, mode, prompt, bindings, allow_missing=False):
        references = sorted(set(int(x) for x in re.findall(r'@voice(\d+)', prompt)))
        missing = [f'@voice{x}' for x in references if x < 1 or x > len(bindings)]
        if any(x < 1 or x > 3 for x in references) or len(bindings) > 3:
            raise invalid('参考音色仅支持 @voice1—@voice3。', 'prompt_pattern')
        try:
            if self.compiler is not None and not missing:
                result = self.compiler(mode, prompt, bindings)
                return result, missing
            adapter = self.adapter or QwenAdapter(Path(__file__).resolve().parents[2] / 'vendor' / 'qwen_audio_studio_core.py')
            compiled = adapter.compile_prompt(mode, prompt, max(len(bindings), max(references, default=0)))
        except DomainError:
            raise
        except ValueError as exc:
            raise invalid('展开后的内容超过 3000 字，或参考音色编号不正确。', 'prompt_pattern') from exc
        return {'compiled_prompt': compiled, 'compiled_chars': len(compiled), 'max_chars': 3000}, missing

    def preview(self, template_id, values=None, reference_bindings=None, apply_params=False, current_params=None):
        item = self.get(template_id)
        prompt, resolved = self._expand(item, values or {})
        compiled, missing = self._compile(item['mode'], prompt, reference_bindings or [])
        preset = item.get('params_preset') or {}
        current = current_params or {}
        return {'prompt': prompt, **compiled, 'values': resolved, 'missing_roles': missing,
                'can_apply': not missing, 'params_preset': preset if apply_params else None,
                'params_diff': {key: {'from': current.get(key), 'to': value} for key, value in preset.items() if current.get(key) != value}}

    def create(self, payload):
        if set(payload) - EDITABLE:
            raise invalid('模板包含不可编辑字段。')
        item = {'description': '', 'tags': [], 'variables': [], 'role_count': 1, 'params_preset': None, **payload,
                'id': self.store.new_id('template'), 'source': 'user', 'version': 1}
        self._validate(item)
        with self._db() as connection:
            connection.execute('''INSERT INTO templates
                (id,source,version,name,mode,description,tags_json,prompt_pattern,variables_json,
                role_count,suggested_duration_seconds,params_preset_json,created_at,updated_at)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)''', self._row(item, now_iso()))
        return self.get(item['id'])

    def update(self, template_id, changes):
        item = self.get(template_id)
        if item['source'] != 'user':
            raise DomainError('BUILTIN_READ_ONLY', '内置模板保持只读，请先复制为自建模板。')
        if not changes or set(changes) - EDITABLE:
            raise invalid('请填写有效的可编辑字段。')
        item.update(changes)
        self._validate(item)
        with self._db() as connection:
            connection.execute('''UPDATE templates SET name=?,mode=?,description=?,tags_json=?,prompt_pattern=?,
                variables_json=?,role_count=?,suggested_duration_seconds=?,params_preset_json=?,version=version+1,updated_at=? WHERE id=?''',
                (*self._row(item, now_iso())[3:12], now_iso(), template_id))
        return self.get(template_id)

    def delete(self, template_id):
        item = self.get(template_id)
        if item['source'] != 'user':
            raise DomainError('BUILTIN_READ_ONLY', '内置模板不能删除。')
        with self._db() as connection:
            connection.execute('UPDATE templates SET deleted_at=?,updated_at=? WHERE id=?', (now_iso(), now_iso(), template_id))

    def set_favorite(self, template_id, favorite):
        self.get(template_id)
        with self._db() as connection:
            if favorite:
                connection.execute('INSERT OR IGNORE INTO template_favorites(template_id,created_at) VALUES(?,?)', (template_id, now_iso()))
            else:
                connection.execute('DELETE FROM template_favorites WHERE template_id=?', (template_id,))
        return self.get(template_id)
