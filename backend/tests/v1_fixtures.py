from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.models import GenerationParams


V1_PARAMS = GenerationParams(format="mp3", sample_rate=48000, channels=2).model_dump(
    mode="json"
)


def write_json(path: Path, payload: Any) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return path


def v1_project(**changes: Any) -> dict[str, Any]:
    record: dict[str, Any] = {
        "id": "proj_weather",
        "name": "雨夜陪伴",
        "mode": "podcast",
        "prompt": "【对白：旁白】今晚的风把雨带到了窗前。",
        "params": dict(V1_PARAMS),
        "created_at": "2026-09-20T01:00:00+00:00",
        "updated_at": "2026-09-20T09:00:00+00:00",
        "archived": False,
        "final_job_id": "job_ok",
    }
    record.update(changes)
    return record


def v1_job(**changes: Any) -> dict[str, Any]:
    record: dict[str, Any] = {
        "id": "job_ok",
        "project_id": "proj_weather",
        "project_name": "雨夜陪伴",
        "mode": "podcast",
        "prompt": "【对白：旁白】今晚的风把雨带到了窗前。",
        "params": dict(V1_PARAMS),
        "references": [],
        "status": "success",
        "created_at": "2026-09-20T02:00:00+00:00",
        "updated_at": "2026-09-20T02:01:00+00:00",
        "elapsed_seconds": 6.5,
        "output_asset_id": "asset_ok",
        "error": None,
        "report": {"ffprobe": "pass", "ffmpeg": "pass", "duration_seconds": 12.0},
    }
    record.update(changes)
    return record


def build_v1_data_root(root: Path) -> Path:
    """Lay out a v1 data directory: one project, three jobs, one registered asset."""
    audio = root / "outputs" / "job_ok" / "雨夜陪伴-job_ok.mp3"
    audio.parent.mkdir(parents=True, exist_ok=True)
    audio.write_bytes(b"ID3fake-audio-bytes")

    write_json(root / "projects" / "proj_weather.json", v1_project())
    write_json(root / "jobs" / "job_ok.json", v1_job())
    write_json(
        root / "jobs" / "job_running.json",
        v1_job(
            id="job_running",
            status="running",
            output_asset_id=None,
            report=None,
            elapsed_seconds=None,
        ),
    )
    write_json(
        root / "jobs" / "job_bad.json",
        v1_job(
            id="job_bad",
            status="failed",
            output_asset_id=None,
            report=None,
            error="sk-abcdefghij0123456789 leaked in provider message",
        ),
    )
    write_json(
        root / "assets.json",
        {
            "asset_ok": {
                "path": str(audio.resolve()),
                "mime_type": "audio/mpeg",
            }
        },
    )
    return root


def snapshot_sources(root: Path) -> dict[str, str]:
    """Digest of every v1 source file, used to prove migration never rewrites them.

    Migration output (``backups/``, the SQLite files) is deliberately excluded.
    """
    files: dict[str, str] = {}
    for path in sorted(root.rglob("*.json")):
        if path.parent.name == "backups" or "backups" in path.relative_to(root).parts:
            continue
        files[str(path.relative_to(root))] = path.read_bytes().hex()
    return files
