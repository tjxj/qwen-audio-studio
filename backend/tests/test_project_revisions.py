from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from app.services.studio_store import RevisionConflict, StudioStore, UnknownField


def open_store(root: Path) -> StudioStore:
    store = StudioStore(root)
    store.initialize()
    return store


class ProjectRevisionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.store = open_store(self.root)

    def test_create_starts_at_revision_one(self) -> None:
        project = self.store.create_project(
            {"name": "草稿", "mode": "podcast", "prompt": "初稿"}
        )
        self.assertEqual(project["revision"], 1)
        self.assertEqual(project["name"], "草稿")
        self.assertEqual(project["archived"], False)
        self.assertIsNone(project["final_job_id"])
        self.assertEqual(project["reference_bindings"], [])
        self.assertIsNone(project["output_directory_id"])
        self.assertIsNone(project["template_application"])
        self.assertTrue(project["created_at"] and project["updated_at"])

    def test_empty_project_can_be_saved(self) -> None:
        project = self.store.create_project({"name": "空项目", "mode": "auto"})
        self.assertEqual(project["prompt"], "")
        self.assertEqual(project["revision"], 1)

    def test_save_bumps_revision_and_persists(self) -> None:
        project = self.store.create_project(
            {"name": "草稿", "mode": "podcast", "prompt": "初稿"}
        )
        saved = self.store.save_project(
            project["id"], project["revision"], {"prompt": "新稿"}
        )
        self.assertEqual(saved["revision"], project["revision"] + 1)
        self.assertEqual(saved["prompt"], "新稿")

        # A brand new store instance over the same directory must see the write.
        self.assertEqual(StudioStore(self.root).get_project(project["id"])["prompt"], "新稿")

    def test_stale_revision_is_rejected_without_touching_storage(self) -> None:
        project = self.store.create_project(
            {"name": "草稿", "mode": "podcast", "prompt": "初稿"}
        )
        self.store.save_project(project["id"], project["revision"], {"prompt": "新稿"})
        with self.assertRaises(RevisionConflict) as caught:
            self.store.save_project(
                project["id"], project["revision"], {"prompt": "旧标签覆盖"}
            )
        self.assertEqual(caught.exception.code, "REVISION_CONFLICT")
        self.assertEqual(
            self.store.get_project(project["id"])["prompt"], "新稿"
        )
        self.assertEqual(self.store.get_project(project["id"])["revision"], 2)

    def test_conflict_carries_the_current_revision_for_recovery(self) -> None:
        project = self.store.create_project({"name": "草稿", "mode": "podcast"})
        current = self.store.save_project(project["id"], 1, {"name": "第二次"})
        self.store.save_project(project["id"], current["revision"], {"name": "第三次"})
        with self.assertRaises(RevisionConflict) as caught:
            self.store.save_project(project["id"], 1, {"name": "落后的标签页"})
        self.assertEqual(caught.exception.current_revision, 3)

    def test_two_tabs_editing_same_project_only_one_wins(self) -> None:
        project = self.store.create_project(
            {"name": "草稿", "mode": "podcast", "prompt": "初稿"}
        )
        tab_a = {"prompt": "A 的修改"}
        tab_b = {"prompt": "B 的修改"}
        self.store.save_project(project["id"], project["revision"], tab_a)
        with self.assertRaises(RevisionConflict):
            self.store.save_project(project["id"], project["revision"], tab_b)
        self.assertEqual(
            self.store.get_project(project["id"])["prompt"], "A 的修改"
        )

    def test_unknown_fields_are_rejected_instead_of_silently_dropped(self) -> None:
        project = self.store.create_project({"name": "草稿", "mode": "podcast"})
        with self.assertRaises(UnknownField):
            self.store.save_project(project["id"], 1, {"status": "success"})
        # Rejected write must not consume a revision.
        self.assertEqual(self.store.get_project(project["id"])["revision"], 1)

    def test_save_project_validates_params_range(self) -> None:
        project = self.store.create_project({"name": "草稿", "mode": "podcast"})
        with self.assertRaises(ValueError):
            self.store.save_project(project["id"], 1, {"params": {"volume": 400}})

    def test_missing_project_raises_key_error(self) -> None:
        with self.assertRaises(KeyError):
            self.store.get_project("does_not_exist")
        with self.assertRaises(KeyError):
            self.store.save_project("does_not_exist", 1, {"prompt": "x"})

    def test_unsafe_project_id_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            self.store.get_project("../../etc/passwd")

    def test_final_job_must_belong_to_project_and_be_playable(self) -> None:
        from tests.v1_fixtures import v1_job, v1_project, write_json

        root = Path(self.temp.name) / "final"
        store = open_store(root)
        project = store.create_project({"name": "收尾", "mode": "podcast"})
        with self.assertRaises(ValueError):
            store.set_final_job(project["id"], "job_missing")

        audio = root / "outputs" / "job_ok.mp3"
        audio.parent.mkdir(parents=True, exist_ok=True)
        audio.write_bytes(b"fake")
        store.record_job(
            v1_job(id="job_ok", project_id=project["id"], output_asset_id="asset_ok"),
            asset={
                "id": "asset_ok",
                "owner_type": "job",
                "owner_id": "job_ok",
                "kind": "generated_audio",
                "canonical_path": str(audio.resolve()),
                "mime_type": "audio/mpeg",
                "bytes": audio.stat().st_size,
                "sha256": "0" * 64,
                "ownership": "generated",
            },
        )
        self.assertEqual(store.set_final_job(project["id"], "job_ok")["final_job_id"], "job_ok")
        store.record_job(
            v1_job(id="job_failed", project_id=project["id"], status="failed"),
        )
        with self.assertRaises(ValueError):
            store.set_final_job(project["id"], "job_failed")
        foreign = store.create_project({"name": "别的项目", "mode": "podcast"})
        with self.assertRaises(ValueError):
            store.set_final_job(foreign["id"], "job_ok")

    def test_importing_the_module_does_not_touch_the_filesystem(self) -> None:
        import app.services.migrations  # noqa: F401
        import app.services.studio_store  # noqa: F401

        untouched = Path(self.temp.name) / "untouched"
        StudioStore(untouched)
        self.assertFalse(untouched.exists())

    def test_concurrent_instances_serialize_writes(self) -> None:
        from threading import Thread

        project = self.store.create_project(
            {"name": "草稿", "mode": "podcast", "prompt": "0"}
        )
        errors: list[BaseException] = []

        def writer(index: int) -> None:
            store = StudioStore(self.root)
            try:
                current = store.get_project(project["id"])
                for _ in range(5):
                    try:
                        current = store.save_project(
                            project["id"], current["revision"], {"prompt": str(index)}
                        )
                    except RevisionConflict:
                        current = store.get_project(project["id"])
            except BaseException as exc:  # pragma: no cover - surfaced via errors
                errors.append(exc)

        threads = [Thread(target=writer, args=(i,)) for i in range(4)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(errors, [])
        stored = self.store.get_project(project["id"])
        self.assertGreater(stored["revision"], 1)
        self.assertLess(stored["revision"], 22)


if __name__ == "__main__":
    unittest.main()
