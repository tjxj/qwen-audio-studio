import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from app.config import AppConfig
from app.main import create_app
from app.services.keychain import FakeCredentialStore


class StaticServingTests(unittest.TestCase):
    def test_production_app_serves_frontend_and_spa_fallback(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            dist = root / "dist"
            dist.mkdir()
            (dist / "index.html").write_text(
                "<html><title>Qwen Audio Studio</title><body>studio-app</body></html>",
                encoding="utf-8",
            )
            config = AppConfig.from_environment(
                {"QWEN_STUDIO_DATA_ROOT": str(root / "data")}
            )
            client = TestClient(
                create_app(
                    config=config,
                    credential_store=FakeCredentialStore(),
                    csrf_token="csrf-test",
                    generation_worker=lambda job: {},
                    frontend_dist=dist,
                )
            )

            self.assertIn("studio-app", client.get("/").text)
            self.assertIn("studio-app", client.get("/projects").text)
            self.assertEqual(client.get("/api/health").json()["status"], "ok")


if __name__ == "__main__":
    unittest.main()
