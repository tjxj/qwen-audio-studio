import tempfile
import threading
import unittest
from pathlib import Path

from app.models import JobCreate
from app.services.jobs import JobManager
from app.services.storage import AssetRegistry, JobStore


class JobManagerTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        root = Path(self.temp_dir.name)
        self.store = JobStore(root / "jobs")
        self.assets = AssetRegistry(root / "assets.json")

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_successful_job_persists_result(self):
        def worker(job):
            return {
                "output_asset_id": "asset-1",
                "elapsed_seconds": 1.25,
                "report": {"ffprobe": "pass", "ffmpeg": "pass"},
            }

        manager = JobManager(self.store, worker, max_workers=1)
        job = manager.submit(
            JobCreate(
                project_id="project-1",
                project_name="测试",
                mode="narration",
                prompt="你好",
            )
        )
        manager.wait(job.id, timeout=5)

        saved = self.store.get(job.id)
        self.assertEqual(saved.status, "success")
        self.assertEqual(saved.output_asset_id, "asset-1")
        self.assertEqual(saved.report["ffprobe"], "pass")
        manager.shutdown()

    def test_queued_job_can_be_cancelled(self):
        started = threading.Event()
        release = threading.Event()

        def worker(job):
            started.set()
            release.wait(3)
            return {}

        manager = JobManager(self.store, worker, max_workers=1)
        first = manager.submit(
            JobCreate(
                project_id="one",
                project_name="一",
                mode="narration",
                prompt="一",
            )
        )
        started.wait(1)
        second = manager.submit(
            JobCreate(
                project_id="two",
                project_name="二",
                mode="narration",
                prompt="二",
            )
        )

        cancelled = manager.cancel(second.id)
        release.set()
        manager.wait(first.id, timeout=5)

        self.assertEqual(cancelled.status, "cancelled")
        manager.shutdown()


if __name__ == "__main__":
    unittest.main()
