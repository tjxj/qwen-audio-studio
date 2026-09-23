from __future__ import annotations

import importlib.util
import hashlib
import time
import sys
from pathlib import Path
from typing import Any

import requests

from app.models import JobRecord
from app.services.keychain import Credentials


MODE_MAP = {
    "podcast": "podcast",
    "advertisement": "advertisement",
    "audiobook": "drama",
    "drama": "drama",
    "game": "drama",
    "narration": "narration",
    "auto": "auto",
}


class QwenAdapter:
    def __init__(self, skill_script: Path):
        if not skill_script.is_file():
            raise RuntimeError(f"Qwen Audio Skill is missing: {skill_script}")
        spec = importlib.util.spec_from_file_location(
            "qwen_audio_studio_core", skill_script
        )
        if not spec or not spec.loader:
            raise RuntimeError("Unable to load Qwen Audio Skill")
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
        self.module = module

    def capabilities(self) -> dict[str, Any]:
        return {
            "model": "qwen-audio-3.1-tts-next",
            "formats": ["wav", "mp3", "pcm"],
            "sample_rates": [8000, 16000, 24000, 44100, 48000],
            "channels": [1, 2],
            "max_reference_count": 3,
            "max_reference_seconds": 30,
            "max_reference_bytes": 10 * 1024 * 1024,
            "max_prompt_chars": 3000,
            "volume": {"min": 0, "max": 100, "default": 50},
            "rate": {"min": 0.5, "max": 2.0, "default": 1.0},
            "modes": list(MODE_MAP),
            "input_languages": ["zh", "en"],
        }

    def compile_prompt(
        self, mode: str, text: str, reference_count: int
    ) -> str:
        try:
            mapped = MODE_MAP[mode]
        except KeyError as exc:
            raise ValueError(f"Unsupported mode: {mode}") from exc
        return self.module.compile_prompt(mapped, text, reference_count)

    def validate_reference(self, path: Path) -> dict[str, Any]:
        metadata = self.module.inspect_reference_audio(path)
        stream = metadata.get("streams", [{}])[0]
        return {
            "duration_seconds": float(metadata["format"]["duration"]),
            "bytes": path.stat().st_size,
            "codec": stream.get("codec_name", "unknown"),
            "sample_rate": int(stream.get("sample_rate", 0) or 0),
            "channels": int(stream.get("channels", 0) or 0),
        }

    def generate(
        self,
        job: JobRecord,
        output_dir: Path,
        credentials: Credentials,
        reference_paths: list[Path],
    ) -> dict[str, Any]:
        started = time.monotonic()
        prompt = self.compile_prompt(
            job.mode, job.prompt, len(reference_paths)
        )
        references = [
            self.module.encode_reference(path) for path in reference_paths
        ]
        params = job.params
        payload = self.module.build_payload(
            prompt=prompt,
            references=references,
            output_format=params.format,
            sample_rate=params.sample_rate,
            channels=params.channels,
            volume=params.volume,
            rate=params.rate,
            seed=params.seed,
            enable_cbr=params.enable_cbr,
            bit_rate=params.bit_rate,
            quality=params.quality,
            enable_aigc_tag=params.enable_aigc_tag,
        )
        endpoint = self.module.build_endpoint(credentials.workspace_id)
        session = requests.Session()
        response = self.module.post_generation(
            session,
            endpoint,
            credentials.api_key,
            payload,
            redact_secrets=[credentials.workspace_id],
        )
        output_dir.mkdir(parents=True, exist_ok=True)
        audio_path = output_dir / f"{job.id}.{params.format}"
        metadata_holder: dict[str, Any] = {}

        def validator(path: Path):
            metadata_holder.update(
                self.module.validate_generated_audio(
                    path,
                    output_format=params.format,
                    sample_rate=params.sample_rate,
                    channels=params.channels,
                )
            )

        self.module.download_audio(
            session,
            response["output"]["audio"]["url"],
            audio_path,
            validator=validator,
            redact_secrets=[credentials.api_key, credentials.workspace_id],
        )
        metadata = metadata_holder or validator(audio_path)
        stream = metadata.get("streams", [{}])[0]
        report = {
            "status": "success",
            "model": "qwen-audio-3.1-tts-next",
            "request_id": response.get("request_id"),
            "duration_seconds": float(metadata["format"]["duration"]),
            "sample_rate": int(stream.get("sample_rate", 0)),
            "channels": int(stream.get("channels", 0)),
            "format": params.format,
            "bytes": audio_path.stat().st_size,
            "sha256": hashlib.sha256(audio_path.read_bytes()).hexdigest(),
            "ffprobe": "pass",
            "ffmpeg": "pass",
        }
        return {
            "path": audio_path,
            "report": report,
            "elapsed_seconds": round(time.monotonic() - started, 3),
        }
