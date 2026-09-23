from __future__ import annotations

import secrets
import shutil
import time
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO

from app.services.qwen_adapter import QwenAdapter


ALLOWED_SUFFIXES = {".wav", ".mp3", ".ogg"}


@dataclass(frozen=True)
class ReferenceRecord:
    id: str
    name: str
    path: Path
    consent_token: str
    metadata: dict


class ReferenceRegistry:
    def __init__(self, root: Path, adapter: QwenAdapter):
        self.root = root
        self.adapter = adapter
        self.records: dict[str, ReferenceRecord] = {}
        self.root.mkdir(parents=True, exist_ok=True)
        self.cleanup_orphans()

    def cleanup_orphans(self) -> None:
        for path in self.root.iterdir():
            if path.is_file():
                path.unlink(missing_ok=True)

    def cleanup_stale(self, max_age_seconds: int = 3600) -> None:
        cutoff = time.time() - max_age_seconds
        for reference_id, record in list(self.records.items()):
            try:
                stale = record.path.stat().st_mtime < cutoff
            except FileNotFoundError:
                stale = True
            if stale:
                self.cleanup(reference_id)

    def prepare(self, name: str, source: BinaryIO) -> ReferenceRecord:
        self.cleanup_stale()
        safe_name = Path(name).name
        suffix = Path(safe_name).suffix.lower()
        if suffix not in ALLOWED_SUFFIXES:
            raise ValueError("Reference audio must be WAV, MP3, or OGG Opus")
        reference_id = secrets.token_urlsafe(12)
        path = self.root / f"{reference_id}{suffix}"
        with path.open("wb") as target:
            shutil.copyfileobj(source, target)
        try:
            metadata = self.adapter.validate_reference(path)
        except Exception:
            path.unlink(missing_ok=True)
            raise
        record = ReferenceRecord(
            id=reference_id,
            name=safe_name,
            path=path,
            consent_token=secrets.token_urlsafe(24),
            metadata=metadata,
        )
        self.records[reference_id] = record
        return record

    def require_consent(self, reference_id: str, token: str) -> ReferenceRecord:
        record = self.records.get(reference_id)
        if not record or not secrets.compare_digest(record.consent_token, token):
            raise ValueError("Reference consent is invalid")
        return record

    def cleanup(self, reference_id: str) -> None:
        record = self.records.pop(reference_id, None)
        if record:
            record.path.unlink(missing_ok=True)

    def cleanup_all(self) -> None:
        for reference_id in list(self.records):
            self.cleanup(reference_id)
        self.cleanup_orphans()
