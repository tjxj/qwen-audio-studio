import tempfile
import unittest
import io
import wave
from pathlib import Path

from fastapi.testclient import TestClient

from app.config import AppConfig
from app.main import create_app
from app.services.keychain import Credentials, FakeCredentialStore


class JobApiTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        config = AppConfig.from_environment(
            {"QWEN_STUDIO_DATA_ROOT": self.temp_dir.name}
        )
        self.client = TestClient(
            create_app(
                config=config,
                credential_store=FakeCredentialStore(
                    Credentials("test-key", "test-workspace")
                ),
                csrf_token="csrf-test",
                generation_worker=lambda job: {
                    "elapsed_seconds": 0.1,
                    "report": {"ffprobe": "pass", "ffmpeg": "pass"},
                },
            )
        )
        self.headers = {"X-Qwen-Studio-CSRF": "csrf-test"}

    def tearDown(self):
        self.client.close()
        self.temp_dir.cleanup()

    def test_project_and_job_flow(self):
        project = self.client.post(
            "/api/projects",
            headers=self.headers,
            json={"name": "雨夜播客", "mode": "podcast", "prompt": "你好"},
        )
        self.assertEqual(project.status_code, 201)
        project_id = project.json()["id"]

        job = self.client.post(
            "/api/jobs",
            headers=self.headers,
            json={
                "project_id": project_id,
                "project_name": "雨夜播客",
                "mode": "podcast",
                "prompt": "你好",
            },
        )
        self.assertEqual(job.status_code, 201)
        job_id = job.json()["id"]
        self.client.app.state.job_manager.wait(job_id, timeout=5)

        fetched = self.client.get(f"/api/jobs/{job_id}")
        self.assertEqual(fetched.json()["status"], "success")

    def test_job_creation_requires_credentials(self):
        self.client.app.state.credential_store.clear()
        response = self.client.post(
            "/api/jobs",
            headers=self.headers,
            json={
                "project_id": "project",
                "project_name": "测试",
                "mode": "narration",
                "prompt": "你好",
            },
        )
        self.assertEqual(response.status_code, 409)

    def test_failed_reference_job_can_retry_before_temporary_file_cleanup(self):
        attempts = 0

        def generate(job, output_dir, credentials, reference_paths):
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                raise RuntimeError("simulated provider outage")
            output_dir.mkdir(parents=True, exist_ok=True)
            path = output_dir / f"{job.id}.wav"
            with wave.open(str(path), "wb") as handle:
                handle.setnchannels(1)
                handle.setsampwidth(2)
                handle.setframerate(16000)
                handle.writeframes(b"\x00\x00" * 16000)
            return {"path": path, "elapsed_seconds": 0.1, "report": {"ffprobe": "pass", "ffmpeg": "pass"}}

        with tempfile.TemporaryDirectory() as directory:
            config = AppConfig.from_environment({"QWEN_STUDIO_DATA_ROOT": directory})
            app = create_app(config=config, credential_store=FakeCredentialStore(Credentials("test-key", "test-workspace")), csrf_token="csrf-test")
            app.state.qwen_adapter.generate = generate
            with TestClient(app) as client:
                wav = io.BytesIO()
                with wave.open(wav, "wb") as handle:
                    handle.setnchannels(1)
                    handle.setsampwidth(2)
                    handle.setframerate(16000)
                    handle.writeframes(b"\x00\x00" * 16000)
                prepared = client.post("/api/references/prepare", headers=self.headers, files={"file": ("voice.wav", wav.getvalue(), "audio/wav")}).json()
                payload = {"project_id": "project", "project_name": "参考重试", "mode": "narration", "prompt": "@voice1 你好", "references": [{"id": prepared["id"], "consent_token": prepared["consent_token"]}]}
                created = client.post("/api/jobs", headers=self.headers, json=payload).json()
                app.state.job_manager.wait(created["id"], timeout=5)
                self.assertEqual(app.state.job_store.get(created["id"]).status, "failed")
                self.assertTrue(any((Path(directory) / "cache" / "references").iterdir()))
                retried = client.post(f"/api/jobs/{created['id']}/retry", headers=self.headers)
                self.assertEqual(retried.status_code, 201)
                app.state.job_manager.wait(retried.json()["id"], timeout=5)
                self.assertEqual(app.state.job_store.get(retried.json()["id"]).status, "success")
                self.assertFalse(any((Path(directory) / "cache" / "references").iterdir()))


if __name__ == "__main__":
    unittest.main()
