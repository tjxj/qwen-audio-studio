import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class LauncherTests(unittest.TestCase):
    def test_shell_launchers_are_portable_and_syntax_valid(self):
        names = [
            "安装 Qwen Audio Studio.command",
            "启动 Qwen Audio Studio.command",
            "停止 Qwen Audio Studio.command",
        ]
        for name in names:
            path = ROOT / name
            self.assertTrue(path.is_file(), name)
            content = path.read_text(encoding="utf-8")
            self.assertNotIn("/Users/", content)
            completed = subprocess.run(
                ["/bin/bash", "-n", str(path)],
                capture_output=True,
                text=True,
            )
            self.assertEqual(completed.returncode, 0, completed.stderr)

    def test_app_executable_starts_project_launcher_without_credentials(self):
        source = (ROOT / "launcher" / "QwenAudioStudio.c").read_text(encoding="utf-8")
        self.assertIn("启动 Qwen Audio Studio.command", source)
        self.assertNotIn("DASHSCOPE_API_KEY", source)
        self.assertNotIn("SFM_WORKSPACE_ID", source)

    def test_builder_creates_application_bundle(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "Qwen Audio Studio.app"
            completed = subprocess.run(
                ["/bin/bash", str(ROOT / "launcher" / "build_app.sh"), str(output)],
                capture_output=True,
                text=True,
            )
            self.assertEqual(completed.returncode, 0, completed.stderr)
            executable = output / "Contents" / "MacOS" / "QwenAudioStudio"
            self.assertTrue(executable.is_file())
            self.assertTrue(executable.stat().st_mode & 0o111)
            kind = subprocess.run(["/usr/bin/file", str(executable)], capture_output=True, text=True, check=True)
            self.assertIn("Mach-O", kind.stdout)
            self.assertIn("com.qwenaudio.studio.local", (output / "Contents" / "Info.plist").read_text())

    def test_builder_refuses_non_app_targets(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "unsafe-directory"
            output.mkdir()
            completed = subprocess.run(
                ["/bin/bash", str(ROOT / "launcher" / "build_app.sh"), str(output)],
                capture_output=True,
                text=True,
            )
            self.assertNotEqual(completed.returncode, 0)
            self.assertTrue(output.is_dir())


if __name__ == "__main__":
    unittest.main()
