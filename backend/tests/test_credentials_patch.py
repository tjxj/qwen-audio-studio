from __future__ import annotations

import unittest
from tempfile import TemporaryDirectory
from unittest.mock import Mock

from fastapi.testclient import TestClient

from app.config import AppConfig
from app.main import create_app
from app.services.keychain import Credentials, FakeCredentialStore


class CredentialPatchTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.keychain = FakeCredentialStore(
            Credentials("test-key-existing", "workspace-existing")
        )
        self.app = create_app(
            config=AppConfig.from_environment(
                {"QWEN_STUDIO_DATA_ROOT": self.temp.name}
            ),
            credential_store=self.keychain,
            csrf_token="csrf-test",
            generation_worker=lambda job: {},
        )
        # Any real provider call would have to go through the adapter.
        self.app.state.qwen_adapter.generate = Mock()
        self.client = TestClient(self.app)
        self.headers = {"X-Qwen-Studio-CSRF": "csrf-test"}

    def tearDown(self) -> None:
        self.app.state.job_manager.shutdown()
        self.app.state.instance_lock.release()
        self.client.close()

    def patch(self, body: dict, keychain=None):
        store = keychain or self.keychain
        previous = self.app.state.credential_store
        self.app.state.credential_store = store
        try:
            return self.client.patch('/api/settings/credentials', headers=self.headers, json=body)
        finally:
            self.app.state.credential_store = previous

    def test_only_the_submitted_field_changes(self) -> None:
        response = self.patch({"workspace_id": "workspace-new"})
        self.assertEqual(response.status_code, 204)
        self.assertEqual(self.keychain.get().api_key, "test-key-existing")
        self.assertEqual(self.keychain.get().workspace_id, "workspace-new")

    def test_api_key_can_be_rotated_without_touching_workspace(self) -> None:
        response = self.patch({"api_key": "test-key-rotated"})
        self.assertEqual(response.status_code, 204)
        self.assertEqual(self.keychain.get().api_key, "test-key-rotated")
        self.assertEqual(self.keychain.get().workspace_id, "workspace-existing")

    def test_no_response_body_or_log_carries_the_stored_value(self) -> None:
        self.patch({"api_key": "test-key-super-secret-1"})
        for url in ("/api/session", "/api/settings/credentials", "/api/diagnostics"):
            self.assertNotIn(
                "test-key-super-secret-1", self.client.get(url).text
            )
        self.assertNotIn(
            "workspace-existing", self.client.get("/api/session").text
        )
        self.assertEqual(self.app.state.qwen_adapter.generate.call_count, 0)

    def test_empty_and_blank_inputs_never_wipe_a_field(self) -> None:
        for body in ({"workspace_id": ""}, {"workspace_id": "   "}, {}, {"api_key": ""}):
            response = self.patch(body)
            self.assertEqual(response.status_code, 422, body)
        self.assertEqual(self.keychain.get().api_key, "test-key-existing")
        self.assertEqual(self.keychain.get().workspace_id, "workspace-existing")

    def test_a_half_finished_write_is_rolled_back(self) -> None:
        failing = FakeCredentialStore(
            Credentials("test-key-existing", "workspace-existing"),
            fail_on_write={2},
        )
        response = self.patch(
            {"api_key": "test-key-new", "workspace_id": "workspace-new"},
            keychain=failing,
        )
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["error"]["code"], "KEYCHAIN_UNAVAILABLE")
        self.assertNotIn("test-key-new", response.text)
        # Both fields are back at their previous values.
        self.assertEqual(
            failing.get(), Credentials("test-key-existing", "workspace-existing")
        )

    def test_clear_scopes_are_individual(self) -> None:
        removed = self.client.request(
            "DELETE", "/api/settings/credentials", params={"scope": "api_key"},
            headers=self.headers,
        )
        self.assertEqual(removed.status_code, 204)
        self.assertFalse(self.keychain.status().api_key_configured)
        self.assertTrue(self.keychain.status().workspace_configured)

        everything = self.client.request(
            "DELETE", "/api/settings/credentials", params={"scope": "all"},
            headers=self.headers,
        )
        self.assertEqual(everything.status_code, 204)
        self.assertEqual(self.keychain.status().model_dump(), {
            "api_key_configured": False, "workspace_configured": False
        })

    def test_unknown_clear_scope_is_rejected(self) -> None:
        response = self.client.request(
            "DELETE", "/api/settings/credentials", params={"scope": "everything"},
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 422)

    def test_legacy_put_still_replaces_both_fields(self) -> None:
        response = self.client.put(
            "/api/settings/credentials",
            headers=self.headers,
            json={"api_key": "test-key-legacy", "workspace_id": "workspace-legacy"},
        )
        self.assertEqual(response.status_code, 204)
        self.assertEqual(
            self.keychain.get(), Credentials("test-key-legacy", "workspace-legacy")
        )

    def test_mutations_require_csrf(self) -> None:
        self.assertEqual(
            self.client.patch("/api/settings/credentials", json={"api_key": "x"}).status_code,
            403,
        )


class DiagnosticsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.app = create_app(
            config=AppConfig.from_environment(
                {"QWEN_STUDIO_DATA_ROOT": self.temp.name}
            ),
            credential_store=FakeCredentialStore(
                Credentials("test-key-existing", "workspace-existing")
            ),
            csrf_token="csrf-test",
        )
        self.app.state.qwen_adapter.generate = Mock()
        self.client = TestClient(self.app)

    def tearDown(self) -> None:
        self.client.close()

    def test_diagnostics_reports_local_facts_without_calling_the_model(self) -> None:
        body = self.client.get("/api/diagnostics").json()
        self.assertEqual(body["credentials"], {
            "api_key_configured": True, "workspace_configured": True
        })
        self.assertTrue(body["storage"]["data_root_writable"])
        self.assertTrue(body["storage"]["database_ready"])
        self.assertEqual({"ffmpeg", "ffprobe"}, set(body["tools"]))
        self.assertFalse(body["model"]["authorisation_checked"])
        self.assertTrue(body["not_checked"])
        self.assertEqual(self.app.state.qwen_adapter.generate.call_count, 0)


if __name__ == "__main__":
    unittest.main()
