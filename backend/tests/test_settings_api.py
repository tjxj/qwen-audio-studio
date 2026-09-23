import tempfile
import unittest

from fastapi.testclient import TestClient

from app.config import AppConfig
from app.main import create_app
from app.services.keychain import FakeCredentialStore


class SettingsApiTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.store = FakeCredentialStore()
        config = AppConfig.from_environment(
            {"QWEN_STUDIO_DATA_ROOT": self.temp_dir.name}
        )
        self.client = TestClient(
            create_app(
                config=config,
                credential_store=self.store,
                csrf_token="csrf-test",
            )
        )

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_session_returns_token_and_boolean_status_only(self):
        response = self.client.get("/api/session")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["csrf_token"], "csrf-test")
        self.assertEqual(
            response.json()["credentials"],
            {
                "api_key_configured": False,
                "workspace_configured": False,
            },
        )

    def test_mutation_rejects_missing_csrf(self):
        response = self.client.put(
            "/api/settings/credentials",
            json={"api_key": "secret-key", "workspace_id": "workspace-secret"},
        )
        self.assertEqual(response.status_code, 403)
        self.assertIsNone(self.store.credentials)

    def test_credentials_can_be_saved_and_cleared_with_csrf(self):
        headers = {"X-Qwen-Studio-CSRF": "csrf-test"}
        saved = self.client.put(
            "/api/settings/credentials",
            headers=headers,
            json={"api_key": "secret-key", "workspace_id": "workspace-secret"},
        )
        self.assertEqual(saved.status_code, 204)
        self.assertEqual(self.store.credentials.api_key, "secret-key")

        cleared = self.client.delete(
            "/api/settings/credentials", headers=headers
        )
        self.assertEqual(cleared.status_code, 204)
        self.assertIsNone(self.store.credentials)


if __name__ == "__main__":
    unittest.main()
