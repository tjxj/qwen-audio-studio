import io
import tempfile
import unittest
import wave

from fastapi.testclient import TestClient

from app.config import AppConfig
from app.main import create_app
from app.services.keychain import FakeCredentialStore


def silent_wav_bytes() -> bytes:
    target = io.BytesIO()
    with wave.open(target, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(16000)
        handle.writeframes(b"\x00\x00" * 16000)
    return target.getvalue()


class ReferenceApiTests(unittest.TestCase):
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
        self.headers = {"X-Qwen-Studio-CSRF": "csrf-test"}

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_capabilities_endpoint(self):
        response = self.client.get("/api/capabilities")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["max_reference_count"], 3)
        self.assertEqual(response.json()["sample_rates"][-1], 48000)

    def test_prepare_reference_validates_without_uploading(self):
        response = self.client.post(
            "/api/references/prepare",
            headers=self.headers,
            files={"file": ("voice.wav", silent_wav_bytes(), "audio/wav")},
        )

        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertFalse(body["uploaded"])
        self.assertEqual(body["name"], "voice.wav")
        self.assertTrue(body["consent_token"])
        self.assertAlmostEqual(body["duration_seconds"], 1.0, places=1)
        self.assertEqual(body["sample_rate"], 16000)
        self.assertEqual(body["channels"], 1)

        deleted = self.client.delete(
            f"/api/references/{body['id']}", headers=self.headers
        )
        self.assertEqual(deleted.status_code, 204)
        self.assertFalse(any((self.client.app.state.config.data_root / "cache" / "references").iterdir()))

    def test_rejects_unsupported_reference_extension(self):
        response = self.client.post(
            "/api/references/prepare",
            headers=self.headers,
            files={"file": ("voice.txt", b"hello", "text/plain")},
        )
        self.assertEqual(response.status_code, 422)


if __name__ == "__main__":
    unittest.main()
