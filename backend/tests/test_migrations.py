from __future__ import annotations

import sqlite3
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from app.services.migrations import (
    MigrationError,
    StudioSchema,
    migrate_v1_to_sqlite,
)
from app.services.studio_store import StudioStore
from tests.v1_fixtures import build_v1_data_root, snapshot_sources, write_json


class Interjected(Exception):
    pass


def rows(root: Path, sql: str) -> list[tuple]:
    connection = sqlite3.connect(root / "studio.sqlite3")
    try:
        StudioSchema.apply_pragmas(connection)
        return connection.execute(sql).fetchall()
    finally:
        connection.close()


def scalar(root: Path, sql: str) -> Any:
    return rows(root, sql)[0][0]


class MigrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        build_v1_data_root(self.root)
        self.sources = snapshot_sources(self.root)

    def test_initialize_imports_v1_json_once(self) -> None:
        StudioStore(self.root).initialize()

        self.assertEqual(
            rows(self.root, "SELECT id, name, mode FROM projects ORDER BY id"),
            [("proj_weather", "雨夜陪伴", "podcast")],
        )
        self.assertEqual(
            [r[0] for r in rows(self.root, "SELECT id FROM jobs ORDER BY id")],
            ["job_bad", "job_ok", "job_running"],
        )
        self.assertEqual(
            rows(self.root, "SELECT id, ownership, deleted_at FROM assets"),
            [("asset_ok", "legacy_generated", None)],
        )
        self.assertEqual(
            rows(self.root, "SELECT revision, final_job_id FROM projects"),
            [(1, "job_ok")],
        )

    def test_display_name_and_favorite_are_backfilled(self) -> None:
        StudioStore(self.root).initialize()
        self.assertEqual(
            rows(self.root, "SELECT display_name, favorite FROM jobs WHERE id='job_ok'"),
            [("雨夜陪伴", 0)],
        )

    def test_in_flight_jobs_become_interrupted_and_errors_stay_redacted(self) -> None:
        StudioStore(self.root).initialize()
        self.assertEqual(
            rows(self.root, "SELECT status FROM jobs WHERE id='job_running'"),
            [("interrupted",)],
        )
        stored_error = scalar(self.root, "SELECT error_json FROM jobs WHERE id='job_bad'")
        self.assertIsNotNone(stored_error)
        self.assertNotIn("sk-abcdefghij0123456789", stored_error)
        self.assertIn("job_running", "".join(str(value) for value in rows(self.root, "SELECT id FROM jobs")))

    def test_asset_paths_and_timestamps_survive(self) -> None:
        StudioStore(self.root).initialize()
        path = scalar(self.root, "SELECT canonical_path FROM assets")
        created = scalar(self.root, "SELECT created_at FROM jobs WHERE id='job_ok'")
        report = scalar(self.root, "SELECT report_json FROM jobs WHERE id='job_ok'")
        self.assertTrue(Path(path).is_file())
        self.assertIn("outputs", path)
        self.assertEqual(created, "2026-09-20T02:00:00+00:00")
        self.assertIn("ffprobe", report)

    def test_consent_tokens_do_not_become_live_authorisation(self) -> None:
        write_json(
            self.root / "jobs" / "job_ref.json",
            {
                "id": "job_ref",
                "project_id": "proj_weather",
                "project_name": "雨夜陪伴",
                "mode": "podcast",
                "prompt": "带参考的旧任务",
                "params": {},
                "references": [{"id": "ref_old", "consent_token": "tok-secret-8888"}],
                "status": "success",
                "created_at": "2026-09-21T02:00:00+00:00",
                "updated_at": "2026-09-21T02:01:00+00:00",
                "elapsed_seconds": 3.0,
                "output_asset_id": None,
                "error": None,
                "report": None,
            },
        )
        StudioStore(self.root).initialize()

        snapshot = scalar(
            self.root, "SELECT reference_snapshot_json FROM jobs WHERE id='job_ref'"
        )
        self.assertIn("ref_old", snapshot)
        self.assertNotIn("tok-secret-8888", snapshot)
        self.assertEqual(
            rows(self.root, "SELECT COUNT(*) FROM upload_consents")[0][0], 0
        )

    def test_migration_is_idempotent_and_never_rewrites_sources(self) -> None:
        first = migrate_v1_to_sqlite(self.root)
        self.assertTrue(first.imported)
        after_first = snapshot_sources(self.root)

        second = migrate_v1_to_sqlite(self.root)
        self.assertFalse(second.imported)
        self.assertEqual(
            [r[0] for r in rows(self.root, "SELECT id FROM jobs ORDER BY id")],
            ["job_bad", "job_ok", "job_running"],
        )
        self.assertEqual(after_first, self.sources)
        self.assertEqual(snapshot_sources(self.root), self.sources)

    def test_initialize_on_an_existing_database_does_not_reimport(self) -> None:
        StudioStore(self.root).initialize()
        StudioStore(self.root).initialize()
        self.assertEqual(
            rows(self.root, "SELECT COUNT(*) FROM schema_migrations")[0][0], 2
        )

    def test_backup_is_written_and_activation_marker_recorded(self) -> None:
        report = migrate_v1_to_sqlite(self.root)
        backup_dir = self.root / "backups" / report.backup_id
        self.assertTrue((backup_dir / "projects" / "proj_weather.json").is_file())
        self.assertTrue((backup_dir / "jobs" / "job_ok.json").is_file())
        self.assertTrue((backup_dir / "manifest.json").is_file())
        self.assertEqual(
            rows(self.root, "SELECT version FROM schema_migrations ORDER BY version"),
            [(1,), (2,)],
        )
        ((digest,),) = rows(
            self.root,
            "SELECT source_digest FROM schema_migrations WHERE version=2",
        )
        self.assertGreater(len(digest), 0)

    def test_corrupt_source_blocks_activation_without_losing_records(self) -> None:
        (self.root / "jobs" / "job_bad.json").write_text("{not json", encoding="utf-8")
        before = snapshot_sources(self.root)
        with self.assertRaises(MigrationError) as caught:
            migrate_v1_to_sqlite(self.root)
        self.assertIn("job_bad.json", str(caught.exception.issues))
        self.assertFalse((self.root / "studio.sqlite3").exists())
        self.assertEqual(snapshot_sources(self.root), before)

    def test_record_without_id_or_bad_reference_blocks_activation(self) -> None:
        write_json(
            self.root / "jobs" / "job_orphan.json",
            {"project_id": "proj_ghost", "status": "success"},
        )
        with self.assertRaises(MigrationError) as caught:
            migrate_v1_to_sqlite(self.root)
        self.assertTrue(any("job_orphan" in issue for issue in caught.exception.issues))
        self.assertFalse((self.root / "studio.sqlite3").exists())

    def test_interrupted_import_leaves_no_half_activated_database(self) -> None:
        def interrupt(phase: str) -> None:
            if phase == "jobs":
                raise Interjected("模拟断电")

        with self.assertRaises(Interjected):
            migrate_v1_to_sqlite(self.root, progress=interrupt)
        self.assertFalse((self.root / "studio.sqlite3").exists())
        self.assertEqual(
            sorted(p.name for p in (self.root / "backups").glob("*.sqlite3.part")),
            [],
        )

        StudioStore(self.root).initialize()
        self.assertEqual(
            [r[0] for r in rows(self.root, "SELECT id FROM jobs ORDER BY id")],
            ["job_bad", "job_ok", "job_running"],
        )

    def test_missing_audio_file_keeps_record_and_reports_it(self) -> None:
        report = migrate_v1_to_sqlite(self.root)
        for path in self.root.joinpath("outputs").rglob("*.mp3"):
            path.unlink()
        StudioStore(self.root).initialize()
        self.assertEqual(report.assets, 1)
        self.assertEqual(
            scalar(
                self.root,
                "SELECT a.id FROM assets a JOIN jobs j ON j.output_asset_id=a.id"
                " WHERE j.id='job_ok'",
            ),
            "asset_ok",
        )
        self.assertEqual(
            scalar(self.root, "SELECT status FROM jobs WHERE id='job_ok'"), "success"
        )

    def test_v1_directories_are_preserved_as_read_only_source(self) -> None:
        StudioStore(self.root).initialize()
        self.assertTrue((self.root / "projects" / "proj_weather.json").is_file())
        self.assertTrue((self.root / "jobs" / "job_ok.json").is_file())
        self.assertTrue((self.root / "assets.json").is_file())
        self.assertEqual(snapshot_sources(self.root), self.sources)


if __name__ == "__main__":
    unittest.main()
