"""Persistable UI and storage preferences.

Settings never hold credentials: the Keychain stays the only place a secret lives.
"""

from __future__ import annotations

from typing import Any

from pydantic import ValidationError

from app.models import GenerationParams
from app.services.studio_store import StudioStore


SCRIPT_FONTS = {"serif", "sans"}
SCRIPT_FONT_SIZES = {14, 16, 18}
MIN_WORKERS = 1
MAX_WORKERS = 2


class PreferenceError(ValueError):
    def __init__(self, field: str, message: str) -> None:
        super().__init__(message)
        self.field = field
        self.message = message


class PreferenceService:
    def __init__(self, store: StudioStore) -> None:
        self.store = store

    def get(self) -> dict[str, Any]:
        settings = self.store.settings()
        settings["max_workers_allowed"] = [MIN_WORKERS, MAX_WORKERS]
        settings["script_font_options"] = sorted(SCRIPT_FONTS)
        settings["script_font_size_options"] = sorted(SCRIPT_FONT_SIZES)
        return settings

    def update(self, expected_revision: int, changes: dict[str, Any]) -> dict[str, Any]:
        cleaned: dict[str, Any] = {}
        if "default_params" in changes and changes["default_params"] is not None:
            try:
                cleaned["default_params"] = GenerationParams.model_validate(
                    changes["default_params"]
                ).model_dump(mode="json")
            except ValidationError as exc:
                bad = exc.errors()
                field = str(bad[0]["loc"][0]) if bad and bad[0]["loc"] else "default_params"
                raise PreferenceError(field, "输出参数组合不在支持范围内。") from exc
        if "script_font" in changes:
            font = changes["script_font"]
            if font not in SCRIPT_FONTS:
                raise PreferenceError("script_font", "脚本字体只支持宋体阅读或系统字体。")
            cleaned["script_font"] = font
        if "script_font_size" in changes:
            size = changes["script_font_size"]
            if size not in SCRIPT_FONT_SIZES:
                raise PreferenceError("script_font_size", "字号只能是 14、16 或 18。")
            cleaned["script_font_size"] = int(size)
        if "max_workers" in changes:
            workers = int(changes["max_workers"])
            if workers < MIN_WORKERS or workers > MAX_WORKERS:
                raise PreferenceError(
                    "max_workers", f"并发数只能在 {MIN_WORKERS} 到 {MAX_WORKERS} 之间。"
                )
            cleaned["max_workers"] = workers
        if "default_directory_id" in changes:
            directory_id = changes["default_directory_id"]
            if directory_id is not None and not self.store.directory_exists(
                str(directory_id)
            ):
                raise PreferenceError(
                    "default_directory_id", "所选输出目录已失效，请重新选择。"
                )
            cleaned["default_directory_id"] = directory_id
        if not cleaned:
            return self.get()
        self.store.save_settings(expected_revision, cleaned)
        return self.get()
