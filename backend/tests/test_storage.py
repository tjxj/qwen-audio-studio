import tempfile
import unittest
from pathlib import Path

from app.models import JobCreate, ProjectCreate
from app.services.storage import JobStore, ProjectStore


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_project_round_trip_and_archive(self):
        store = ProjectStore(self.root / "projects")
        project = store.create(
            ProjectCreate(name="雨夜播客", mode="podcast", prompt="下雨了")
        )
        updated = store.update(project.id, {"name": "雨夜双人播客"})
        archived = store.archive(project.id)

        self.assertEqual(updated.name, "雨夜双人播客")
        self.assertTrue(archived.archived)
        self.assertEqual(store.get(project.id).id, project.id)

    def test_running_jobs_become_interrupted_on_restart(self):
        store = JobStore(self.root / "jobs")
        job = store.create(
            JobCreate(
                project_id="project-1",
                project_name="测试",
                mode="narration",
                prompt="你好",
            )
        )
        store.update(job.id, {"status": "running"})

        store.recover_interrupted()

        self.assertEqual(store.get(job.id).status, "interrupted")

    def test_ids_cannot_escape_store_directory(self):
        store = ProjectStore(self.root / "projects")
        with self.assertRaises(ValueError):
            store.get("../../etc/passwd")


if __name__ == "__main__":
    unittest.main()
