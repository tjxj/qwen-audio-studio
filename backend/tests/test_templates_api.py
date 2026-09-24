from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.templates import router
from app.errors import install_error_handlers
from app.security import LocalSecurityMiddleware
from app.services.studio_store import StudioStore
from app.services.templates import TemplateService


class TemplateApiTests(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        store = StudioStore(Path(temporary.name))
        store.initialize()
        app = FastAPI()
        app.state.csrf_token = 'template-test-csrf'
        app.state.template_service = TemplateService(store)
        app.state.template_service.initialize()
        install_error_handlers(app)
        app.include_router(router)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def test_catalog_pagination_query_and_readonly_contract(self):
        response = self.client.get('/api/templates?page_size=50')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(response.json()['items']), 42)
        filtered = self.client.get('/api/templates?mode=podcast&page_size=20').json()
        self.assertEqual(filtered['total'], 6)
        self.assertEqual(self.client.patch('/api/templates/coffee-ad', json={'name': '改名'}).status_code, 409)
        self.assertEqual(self.client.delete('/api/templates/coffee-ad').status_code, 409)

    def test_preview_rejects_oversized_unexpected_and_bad_values_without_echoing_them(self):
        response = self.client.post('/api/templates/coffee-ad/preview', json={'values': {'unknown': 'payload-private'}})
        self.assertEqual(response.status_code, 422)
        self.assertNotIn('payload-private', response.text)
        self.assertEqual(self.client.post('/api/templates/coffee-ad/preview', json={'values': {}, 'execute': True}).status_code, 422)
        valid = self.client.post('/api/templates/coffee-ad/preview', json={'values': {'brand': '小岛咖啡'}})
        self.assertEqual(valid.status_code, 200)
        self.assertIn('小岛咖啡', valid.json()['prompt'])

    def test_user_create_update_and_delete_roundtrip(self):
        created = self.client.post('/api/templates', json={'name': '个人片头', 'mode': 'podcast', 'prompt_pattern': '【对白：旁白】欢迎来到我们的新节目。'})
        self.assertEqual(created.status_code, 201)
        path = '/api/templates/' + created.json()['id']
        self.assertTrue(self.client.put(path + '/favorite', json={'favorite': True}).json()['favorite'])
        self.assertEqual(self.client.patch(path, json={'name': '更新片头'}).json()['name'], '更新片头')
        self.assertEqual(self.client.get('/api/templates?source=user&favorite=true').json()['total'], 1)
        self.assertEqual(self.client.delete(path).status_code, 204)
        self.assertEqual(self.client.get(path).status_code, 404)


if __name__ == '__main__':
    unittest.main()
