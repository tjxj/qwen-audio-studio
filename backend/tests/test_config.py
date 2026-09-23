import os
import tempfile
import unittest
from pathlib import Path

from app.config import AppConfig


class AppConfigTests(unittest.TestCase):
    def test_config_is_loopback_only_and_uses_test_data_root(self):
        with tempfile.TemporaryDirectory() as directory:
            config = AppConfig.from_environment(
                {"QWEN_STUDIO_DATA_ROOT": directory}
            )

            self.assertEqual(config.host, "127.0.0.1")
            self.assertEqual(config.port, 8765)
            self.assertEqual(config.data_root, Path(directory))
            self.assertTrue(
                str(config.skill_script).endswith(
                    "backend/vendor/qwen_audio_studio_core.py"
                )
            )


if __name__ == "__main__":
    unittest.main()
