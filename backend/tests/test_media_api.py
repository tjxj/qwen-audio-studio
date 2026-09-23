import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from app.config import AppConfig
from app.main import create_app
from app.services.keychain import FakeCredentialStore


class MediaApiTests(unittest.TestCase):
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
                generation_worker=lambda job: {},
            )
        )

    def tearDown(self):
        self.client.close()
        self.temp_dir.cleanup()

    def test_registered_media_can_be_read(self):
        media = Path(self.temp_dir.name) / "audio.mp3"
        media.write_bytes(b"ID3audio")
        asset = self.client.app.state.studio.register_asset(media, "audio/mpeg")

        response = self.client.get(f"/api/media/{asset['id']}")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, b"ID3audio")

    def test_media_reports_gone_when_the_registered_file_disappears(self) -> None:
        media = Path(self.temp_dir.name) / "moved.mp3"
        media.write_bytes(b"ID3audio")
        asset = self.client.app.state.studio.register_asset(media, "audio/mpeg")
        media.unlink()

        self.assertEqual(self.client.get(f"/api/media/{asset['id']}").status_code, 410)

    def test_media_rejects_unknown_or_traversal_id(self):
        self.assertEqual(self.client.get("/api/media/unknown").status_code, 404)
        self.assertEqual(
            self.client.get("/api/media/..%2F..%2Fetc%2Fpasswd").status_code,
            404,
        )


if __name__ == "__main__":
    unittest.main()
