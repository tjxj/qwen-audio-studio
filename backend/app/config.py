from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Optional


SKILL_RELATIVE_PATH = Path(
    ".agent/skills/1-qwen-audio-studio/scripts/qwen_audio_studio.py"
)
BUNDLED_CORE_PATH = Path("backend/vendor/qwen_audio_studio_core.py")


def find_skill_script(start: Path) -> Path:
    bundled = start / BUNDLED_CORE_PATH
    if bundled.is_file():
        return bundled
    for candidate_root in (start, *start.parents):
        candidate = candidate_root / SKILL_RELATIVE_PATH
        if candidate.is_file():
            return candidate
    return start / SKILL_RELATIVE_PATH


@dataclass(frozen=True)
class AppConfig:
    host: str
    port: int
    data_root: Path
    skill_script: Path

    @classmethod
    def from_environment(
        cls, environ: Optional[Mapping[str, str]] = None
    ) -> "AppConfig":
        values = os.environ if environ is None else environ
        app_root = Path(__file__).resolve().parents[2]
        return cls(
            host="127.0.0.1",
            port=int(values.get("QWEN_STUDIO_PORT", "8765")),
            data_root=Path(
                values.get(
                    "QWEN_STUDIO_DATA_ROOT",
                    Path.home()
                    / "Library"
                    / "Application Support"
                    / "Qwen Audio Studio",
                )
            ).expanduser(),
            skill_script=find_skill_script(app_root),
        )
