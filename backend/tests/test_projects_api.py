from __future__ import annotations

import unittest
from tempfile import TemporaryDirectory

from fastapi.testclient import TestClient

from app.config import AppConfig
from app.main import create_app
from app.services.keychain import Credentials, FakeCredentialStore


class ProjectApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.client = TestClient(
            create_app(
                config=AppConfig.from_environment(
                    {"QWEN_STUDIO_DATA_ROOT": self.temp.name}
                ),
                credential_store=FakeCredentialStore(
                    Credentials("test-key", "test-workspace")
                ),
                csrf_token="csrf-test",
                generation_worker=lambda job: {},
            )
        )
        self.headers = {"X-Qwen-Studio-CSRF": "csrf-test"}

    def tearDown(self) -> None:
        self.client.close()

    def create(self, name: str = "雨夜陪伴", **changes) -> dict:
        body = {"name": name, "mode": "podcast", "prompt": "初稿", **changes}
        response = self.client.post("/api/projects", headers=self.headers, json=body)
        self.assertEqual(response.status_code, 201)
        return response.json()

    def patch(self, project_id: str, body: dict):
        return self.client.patch(
            f"/api/projects/{project_id}", headers=self.headers, json=body
        )

    def test_create_returns_a_full_draft_dto(self) -> None:
        draft = self.create()
        self.assertEqual(draft["revision"], 1)
        self.assertEqual(draft["reference_bindings"], [])
        self.assertIsNone(draft["output_directory_id"])
        self.assertIsNone(draft["template_application"])
        self.assertIn("sample_rate", draft["params"])

    def test_empty_prompt_can_still_be_saved_as_a_draft(self) -> None:
        draft = self.create(prompt="")
        self.assertEqual(draft["prompt"], "")
        saved = self.patch(draft["id"], {"expected_revision": 1, "prompt": "后来写的"})
        self.assertEqual(saved.json()["prompt"], "后来写的")

    def test_patch_without_expected_revision_is_rejected(self) -> None:
        draft = self.create()
        response = self.patch(draft["id"], {"prompt": "x"})
        self.assertEqual(response.status_code, 422)

    def test_stale_revision_returns_409_with_the_current_one(self) -> None:
        draft = self.create()
        self.patch(draft["id"], {"expected_revision": 1, "prompt": "标签页 A"})
        conflict = self.patch(draft["id"], {"expected_revision": 1, "prompt": "标签页 B"})
        self.assertEqual(conflict.status_code, 409)
        error = conflict.json()["error"]
        self.assertEqual(error["code"], "REVISION_CONFLICT")
        self.assertEqual(error["field"], "expected_revision")
        self.assertEqual(error["details"]["current_revision"], 2)
        self.assertNotIn("test-key", conflict.text)
        self.assertEqual(
            self.client.get(f"/api/projects/{draft['id']}").json()["prompt"],
            "标签页 A",
        )

    def test_snapshot_fields_cannot_be_patched(self) -> None:
        draft = self.create()
        response = self.patch(
            draft["id"], {"expected_revision": 1, "final_job_id": "job_fake"}
        )
        self.assertIn(response.status_code, (400, 409, 422))
        self.assertIsNone(
            self.client.get(f"/api/projects/{draft['id']}").json()["final_job_id"]
        )

    def test_duplicate_keeps_text_but_not_jobs_or_final_mark(self) -> None:
        draft = self.create()
        copy = self.client.post(
            f"/api/projects/{draft['id']}/duplicate",
            headers=self.headers,
            json={"name": "雨夜陪伴 二稿"},
        )
        self.assertEqual(copy.status_code, 201)
        body = copy.json()
        self.assertNotEqual(body["id"], draft["id"])
        self.assertEqual(body["name"], "雨夜陪伴 二稿")
        self.assertEqual(body["prompt"], draft["prompt"])
        self.assertEqual(body["revision"], 1)
        self.assertIsNone(body["final_job_id"])

    def test_archive_only_changes_visibility(self) -> None:
        draft = self.create()
        archived = self.client.post(
            f"/api/projects/{draft['id']}/archive",
            headers=self.headers,
            json={"archived": True},
        )
        self.assertTrue(archived.json()["archived"])
        listed = self.client.get("/api/projects").json()
        self.assertEqual([item["id"] for item in listed], [draft["id"]])
        restored = self.client.post(
            f"/api/projects/{draft['id']}/archive",
            headers=self.headers,
            json={"archived": False},
        )
        self.assertFalse(restored.json()["archived"])

    def test_final_version_requires_a_playable_job_of_this_project(self) -> None:
        draft = self.create()
        response = self.client.post(
            f"/api/projects/{draft['id']}/final-version",
            headers=self.headers,
            json={"job_id": "job_missing"},
        )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(
            response.json()["error"]["code"], "INVALID_FINAL_VERSION"
        )

    def test_unknown_project_is_404_not_500(self) -> None:
        self.assertEqual(self.client.get("/api/projects/nope").status_code, 404)
        self.assertEqual(
            self.patch("nope", {"expected_revision": 1, "prompt": "x"}).status_code,
            404,
        )

    def test_path_traversal_in_project_id_is_404(self) -> None:
        self.assertEqual(
            self.client.get("/api/projects/..%2F..%2Fetc").status_code, 404
        )

    def test_mutating_without_csrf_stays_403(self) -> None:
        response = self.client.post(
            "/api/projects", json={"name": "x", "mode": "podcast"}
        )
        self.assertEqual(response.status_code, 403)


if __name__ == "__main__":
    unittest.main()
