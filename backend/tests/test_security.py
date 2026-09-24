import tempfile
import unittest

from fastapi.testclient import TestClient

from app.config import AppConfig
from app.main import create_app
from app.services.keychain import FakeCredentialStore


class SecurityMiddlewareTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        config = AppConfig.from_environment(
            {"QWEN_STUDIO_DATA_ROOT": self.temp_dir.name}
        )
        self.client = TestClient(
            create_app(
                config=config,
                credential_store=FakeCredentialStore(),
                csrf_token="csrf-test",
            )
        )

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_rejects_non_local_host(self):
        response = self.client.get(
            "/api/health", headers={"host": "attacker.example"}
        )
        self.assertEqual(response.status_code, 400)

    def test_adds_security_headers(self):
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        self.assertIn("default-src 'self'", response.headers["content-security-policy"])
        self.assertEqual(response.headers["x-content-type-options"], "nosniff")

    def test_cross_origin_mutation_rejected_even_with_valid_csrf(self):
        response=self.client.post('/api/projects',headers={'Origin':'https://attacker.example','X-Qwen-Studio-CSRF':'csrf-test'},
            json={'name':'不应创建','mode':'narration'})
        self.assertEqual(response.status_code,403)
        self.assertEqual(self.client.get('/api/projects').json(),[])


if __name__ == "__main__":
    unittest.main()
