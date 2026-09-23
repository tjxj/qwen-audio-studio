import tempfile
import unittest
import wave
from pathlib import Path

from app.config import AppConfig
from app.services.qwen_adapter import QwenAdapter


def write_silent_wav(path: Path, seconds: int = 1):
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(16000)
        handle.writeframes(b"\x00\x00" * 16000 * seconds)


class QwenAdapterTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.config = AppConfig.from_environment(
            {"QWEN_STUDIO_DATA_ROOT": self.temp_dir.name}
        )
        self.adapter = QwenAdapter(self.config.skill_script)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_capabilities_match_official_contract(self):
        caps = self.adapter.capabilities()
        self.assertEqual(caps["model"], "qwen-audio-3.1-tts-next")
        self.assertEqual(caps["formats"], ["wav", "mp3", "pcm"])
        self.assertEqual(caps["sample_rates"], [8000, 16000, 24000, 44100, 48000])
        self.assertEqual(caps["max_reference_count"], 3)
        self.assertEqual(caps["max_prompt_chars"], 3000)
        self.assertEqual(caps["volume"], {"min": 0, "max": 100, "default": 50})
        self.assertEqual(caps["rate"], {"min": 0.5, "max": 2.0, "default": 1.0})

    def test_maps_audiobook_and_game_modes_to_drama_compiler(self):
        prompt = self.adapter.compile_prompt(
            "audiobook", "旁白：夜风吹过天台。", 0
        )
        self.assertIn("广播剧", prompt)
        game = self.adapter.compile_prompt(
            "game", "村长说：“孩子，你来了。”", 0
        )
        self.assertIn("广播剧", game)

    def test_validates_real_wav_reference(self):
        reference = Path(self.temp_dir.name) / "voice.wav"
        write_silent_wav(reference)

        metadata = self.adapter.validate_reference(reference)

        self.assertEqual(metadata["codec"], "pcm_s16le")
        self.assertEqual(metadata["sample_rate"], 16000)
        self.assertEqual(metadata["channels"], 1)
        self.assertAlmostEqual(metadata["duration_seconds"], 1.0, places=1)
        self.assertGreater(metadata["bytes"], 0)

    def test_generated_audio_validation_rejects_parameter_mismatch(self):
        audio = Path(self.temp_dir.name) / "generated.wav"
        write_silent_wav(audio)
        with self.assertRaises(self.adapter.module.ValidationError):
            self.adapter.module.validate_generated_audio(
                audio,
                output_format="wav",
                sample_rate=48000,
                channels=2,
            )


if __name__ == "__main__":
    unittest.main()
