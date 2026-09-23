"""Local environment checks.

This endpoint never contacts the provider: it reports what can be verified on this
machine, and states plainly which things it could not verify.
"""

from __future__ import annotations

import shutil
import subprocess

from fastapi import APIRouter, Request

from app.services.migrations import now_iso


router = APIRouter()
TOOLS = ("ffmpeg", "ffprobe")


def _probe(name: str) -> dict:
    path = shutil.which(name)
    if not path:
        return {"available": False, "path": None, "version": None}
    try:
        completed = subprocess.run(
            [path, "-version"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return {"available": True, "path": path, "version": None}
    first_line = (completed.stdout or "").splitlines()
    return {
        "available": completed.returncode == 0,
        "path": path,
        "version": first_line[0].strip() if first_line else None,
    }


@router.get("/api/diagnostics")
def diagnostics(request: Request):
    config = request.app.state.config
    studio = request.app.state.studio
    data_root = config.data_root
    data_writable = _writable(data_root)
    try:
        database_ready = studio.db_path.is_file()
    except OSError:
        database_ready = False
    tools = {name: _probe(name) for name in TOOLS}
    return {
        "checked_at": now_iso(),
        "tools": tools,
        "credentials": request.app.state.credential_store.status().model_dump(),
        "storage": {
            "data_root_writable": data_writable,
            "database_ready": database_ready,
        },
        "model": {
            "id": "qwen-audio-3.1-tts-next",
            "authorisation_checked": False,
        },
        "not_checked": [
            "百炼账号是否已开通该模型",
            "API Key 是否具有调用权限",
            "账户余额与计费状态"
        ],
        "note": "本地检查只确认依赖与配置；生成时文本会发送至阿里云百炼。",
    }


def _writable(path) -> bool:
    try:
        path.mkdir(parents=True, exist_ok=True)
        probe = path / ".qwen-studio-write-check"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
        return True
    except OSError:
        return False
