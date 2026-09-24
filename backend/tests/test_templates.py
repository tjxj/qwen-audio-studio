from collections import Counter
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from app.errors import DomainError
from app.services.studio_store import StudioStore
from app.services.templates import TemplateService


OLD_IDS = {'rain-podcast', 'tech-podcast', 'tech-ad', 'coffee-ad', 'rooftop-story',
           'forest-audiobook', 'midnight-store', 'airlock-drama', 'village-elder',
           'dungeon-merchant', 'ai-narration', 'nature-narration', 'custom-scene', 'custom-logo'}


class TemplateTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store = StudioStore(Path(self.temp.name))
        self.store.initialize()
        self.service = TemplateService(self.store)
        self.service.initialize()

    def test_exactly_42_original_templates_have_six_per_mode_and_keep_old_ids(self):
        templates = self.service.list_builtin()
        self.assertEqual(len(templates), 42)
        self.assertEqual(set(Counter(item['mode'] for item in templates).values()), {6})
        self.assertTrue(OLD_IDS <= {item['id'] for item in templates})
        self.assertEqual(len({item['prompt_pattern'] for item in templates}), 42)
        for item in templates:
            with self.subTest(template=item['id']):
                values = {v['key']: v['default'] for v in item['variables']}
                preview = self.service.preview(item['id'], values, [])
                self.assertNotIn('{{', preview['prompt'])
                self.assertLessEqual(preview['compiled_chars'], 3000)
                self.assertGreater(len(preview['prompt']), 80)
                self.assertEqual(preview['compiled_chars'], len(preview['compiled_prompt']))
                self.assertEqual(preview['missing_roles'], [])

    def test_preview_rejects_unknown_missing_overlong_and_expression_variables(self):
        for values in [{'extra': 'x'}, {'brand': ''}, {'brand': '字' * 81}]:
            with self.subTest(values=values), self.assertRaises(DomainError) as error:
                self.service.preview('coffee-ad', values, [])
            self.assertEqual(error.exception.status, 422)
        with self.assertRaises(DomainError):
            self.service.create({'name': 'bad', 'mode': 'auto', 'prompt_pattern': '{{ process.run() }}'})

    def test_readonly_builtin_and_persistent_user_edits_favorites_and_soft_delete(self):
        with self.assertRaises(DomainError) as error:
            self.service.update('coffee-ad', {'name': 'changed'})
        self.assertEqual(error.exception.status, 409)
        with self.assertRaises(DomainError):
            self.service.delete('coffee-ad')
        payload = {'name': '旅行开场', 'mode': 'narration', 'description': '山间步行',
                   'prompt_pattern': '【角色：旁白（自然平静）】\n【对白：旁白】今天去{{place}}。',
                   'variables': [{'key': 'place', 'label': '地点', 'type': 'text', 'required': True, 'default': '山谷', 'max_length': 40}],
                   'tags': ['旅行'], 'role_count': 1}
        created = self.service.create(payload)
        self.service.set_favorite(created['id'], True)
        self.service.update(created['id'], {'name': '山谷开场'})
        reloaded = TemplateService(self.store)
        reloaded.initialize()
        result = reloaded.list(q='山间', favorite=True)
        self.assertEqual(result['total'], 1)
        self.assertEqual(result['items'][0]['name'], '山谷开场')
        self.assertEqual(result['items'][0]['version'], 2)
        self.service.delete(created['id'])
        with self.assertRaises(DomainError) as error:
            self.service.get(created['id'])
        self.assertEqual(error.exception.status, 404)
        with self.store._connect() as connection:
            self.assertIsNotNone(connection.execute('SELECT deleted_at FROM templates WHERE id=?', (created['id'],)).fetchone()[0])

    def test_initialization_is_idempotent_and_preserves_favorites(self):
        self.service.set_favorite('coffee-ad', True)
        self.service.initialize()
        self.assertEqual(len(self.service.list_builtin()), 42)
        self.assertTrue(self.service.get('coffee-ad')['favorite'])

    def test_literal_variable_replacement_does_not_evaluate_or_recursively_expand(self):
        result = self.service.preview('coffee-ad', {'brand': '<b>清晨</b>'}, [])
        self.assertIn('<b>清晨</b>', result['prompt'])
        with self.assertRaises(DomainError):
            self.service.preview('coffee-ad', {'brand': '{{unsafe}}'}, [])

    def test_user_template_rejects_credentials_audio_data_and_long_compiled_prompt(self):
        for prompt in ['key=sk-' + 'x' * 32, 'data:audio/wav;base64,AAAA', '字' * 3000]:
            with self.subTest(prompt=prompt[:20]), self.assertRaises(DomainError):
                self.service.create({'name': '安全检查', 'mode': 'auto', 'prompt_pattern': prompt})

    def test_voice_binding_absence_is_explained_and_never_generates(self):
        item = self.service.create({'name': '参考音色', 'mode': 'auto', 'prompt_pattern': '【角色：@voice1】\n【对白：@voice1】你好，欢迎回来。'})
        result = self.service.preview(item['id'], {}, [])
        self.assertEqual(result['missing_roles'], ['@voice1'])
        self.assertFalse(result['can_apply'])

    def test_numeric_and_select_variables_are_validated(self):
        item = self.service.create({'name': '数字枚举', 'mode': 'auto', 'prompt_pattern': '{{count}} 次{{tone}}',
            'variables': [{'key': 'count', 'label': '次数', 'type': 'number', 'default': 3, 'min': 1, 'max': 5},
                          {'key': 'tone', 'label': '风格', 'type': 'select', 'default': '轻快', 'options': ['轻快', '平静']}]})
        self.assertEqual(self.service.preview(item['id'], {}, [])['prompt'], '3 次轻快')
        for values in [{'count': 10}, {'tone': '不合法'}, {'count': 'NaN'}, {'count': True}]:
            with self.assertRaises(DomainError):
                self.service.preview(item['id'], values, [])


if __name__ == '__main__':
    unittest.main()
