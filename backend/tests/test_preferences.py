from __future__ import annotations

import unittest
from tempfile import TemporaryDirectory

from fastapi.testclient import TestClient

from app.config import AppConfig
from app.main import create_app
from app.services.keychain import FakeCredentialStore


class PreferenceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.client = TestClient(
            create_app(
                config=AppConfig.from_environment(
                    {"QWEN_STUDIO_DATA_ROOT": self.temp.name}
                ),
                credential_store=FakeCredentialStore(),
                csrf_token="csrf-test",
                generation_worker=lambda job: {},
            )
        )
        self.headers = {"X-Qwen-Studio-CSRF": "csrf-test"}

    def tearDown(self) -> None:
        self.client.close()

    def patch(self, body: dict):
        return self.client.patch("/api/settings", headers=self.headers, json=body)

    def test_defaults_are_readable_and_hold_no_secrets(self) -> None:
        body = self.client.get("/api/settings").json()
        self.assertEqual(body["revision"], 1)
        self.assertEqual(body["max_workers"], 2)
        self.assertEqual(body["script_font"], "serif")
        self.assertEqual(body["script_font_size"], 16)
        self.assertEqual(body["theme"], "system")
        self.assertEqual(body["theme_options"], ["light", "dark", "system"])
        self.assertIsNone(body["default_directory_id"])
        self.assertEqual(body["default_params"]["sample_rate"], 48000)
        self.assertNotIn("api_key", body)

    def test_font_and_worker_preferences_round_trip(self) -> None:
        saved = self.patch(
            {
                "expected_revision": 1,
                "script_font": "sans",
                "script_font_size": 18,
                "max_workers": 1,
            }
        )
        self.assertEqual(saved.status_code, 200)
        body = saved.json()
        self.assertEqual(body["script_font"], "sans")
        self.assertEqual(body["script_font_size"], 18)
        self.assertEqual(body["max_workers"], 1)
        self.assertEqual(body["revision"], 2)

    def test_theme_preference_round_trips(self) -> None:
        saved = self.patch({"expected_revision": 1, "theme": "dark"})
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(saved.json()["theme"], "dark")
        self.assertEqual(saved.json()["revision"], 2)
        self.assertEqual(self.client.get("/api/settings").json()["theme"], "dark")

    def test_theme_only_edits_leave_other_preferences_untouched(self) -> None:
        self.patch(
            {
                "expected_revision": 1,
                "script_font": "sans",
                "script_font_size": 18,
                "max_workers": 1,
            }
        )
        saved = self.patch({"expected_revision": 2, "theme": "light"})
        self.assertEqual(saved.status_code, 200)
        body = saved.json()
        self.assertEqual(body["theme"], "light")
        self.assertEqual(body["script_font"], "sans")
        self.assertEqual(body["script_font_size"], 18)
        self.assertEqual(body["max_workers"], 1)
        self.assertEqual(body["revision"], 3)

    def test_default_output_parameters_are_persisted(self) -> None:
        params = self.client.get("/api/settings").json()["default_params"]
        params.update({"format": "mp3", "sample_rate": 24000, "channels": 1})
        saved = self.patch({"expected_revision": 1, "default_params": params})
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(saved.json()["default_params"]["format"], "mp3")
        self.assertEqual(saved.json()["default_params"]["channels"], 1)

    def test_invalid_preferences_are_rejected_with_the_offending_field(self) -> None:
        cases = [
            ({"script_font": "comic"}, "script_font"),
            ({"script_font_size": 13}, "script_font_size"),
            ({"theme": "neo"}, "theme"),
            ({"theme": "auto"}, "theme"),
            ({"max_workers": 5}, "max_workers"),
            ({"max_workers": 0}, "max_workers"),
            ({"default_directory_id": "dir_missing"}, "default_directory_id"),
        ]
        for changes, field in cases:
            with self.subTest(**changes):
                response = self.patch({"expected_revision": 1, **changes})
                self.assertEqual(response.status_code, 422)
                self.assertEqual(response.json()["error"]["field"], field)

    def test_unsupported_parameter_combination_is_rejected(self) -> None:
        params = self.client.get("/api/settings").json()["default_params"]
        params["volume"] = 240
        response = self.patch({"expected_revision": 1, "default_params": params})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["error"]["field"], "volume")

    def test_concurrent_preference_edits_conflict_instead_of_clobbering(self) -> None:
        first = self.patch({"expected_revision": 1, "script_font_size": 14})
        self.assertEqual(first.status_code, 200)
        second = self.patch({"expected_revision": 1, "script_font_size": 18})
        self.assertEqual(second.status_code, 409)
        self.assertEqual(
            second.json()["error"]["code"], "REVISION_CONFLICT"
        )
        self.assertEqual(
            second.json()["error"]["details"]["current_revision"], 2
        )
        self.assertEqual(
            self.client.get("/api/settings").json()["script_font_size"], 14
        )

    def test_no_change_patch_does_not_burn_a_revision(self) -> None:
        response = self.patch({"expected_revision": 1})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["revision"], 1)

    def test_unknown_setting_names_are_refused(self) -> None:
        response = self.patch({"expected_revision": 1, "api_key": "test-key-x"})
        self.assertEqual(response.status_code, 422)
        self.assertNotIn("test-key-x", self.client.get("/api/settings").text)

    def test_mutations_require_csrf(self) -> None:
        self.assertEqual(
            self.client.patch("/api/settings", json={"script_font": "sans"}).status_code,
            403,
        )


if __name__ == "__main__":
    unittest.main()
