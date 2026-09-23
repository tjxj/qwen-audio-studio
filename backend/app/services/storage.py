from __future__ import annotations

import json
import re
import secrets
from pathlib import Path
from threading import RLock
from typing import Generic, Type, TypeVar

from app.models import JobCreate, JobRecord, ProjectCreate, ProjectRecord, utc_now


SAFE_ID = re.compile(r"^[A-Za-z0-9_-]+$")
RecordT = TypeVar("RecordT")

SECRET_PATTERNS = (
    (re.compile(r"sk-[A-Za-z0-9]{12,}"), "<redacted>"),
    (re.compile(r"llm-[A-Za-z0-9-]{8,}"), "<redacted>"),
    (
        re.compile(r"data:audio/[A-Za-z0-9.+-]+;base64,[A-Za-z0-9+/=_-]+"),
        "<redacted audio data>",
    ),
)


def require_safe_id(value: str) -> str:
    if not SAFE_ID.fullmatch(value):
        raise ValueError("Invalid identifier")
    return value


def sanitize_error(value: str) -> str:
    for pattern, replacement in SECRET_PATTERNS:
        value = pattern.sub(replacement, value)
    return value[-2000:]


class JsonRecordStore(Generic[RecordT]):
    def __init__(self, root: Path, model: Type[RecordT]):
        self.root = root
        self.model = model
        self.lock = RLock()
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, record_id: str) -> Path:
        return self.root / f"{require_safe_id(record_id)}.json"

    def _write(self, record) -> None:
        path = self._path(record.id)
        temp = path.with_suffix(".json.part")
        temp.write_text(
            json.dumps(record.model_dump(mode="json"), ensure_ascii=False, indent=2)
            + "\n",
            encoding="utf-8",
        )
        temp.replace(path)

    def get(self, record_id: str):
        path = self._path(record_id)
        if not path.is_file():
            raise KeyError(record_id)
        return self.model.model_validate_json(path.read_text(encoding="utf-8"))

    def list(self):
        records = [
            self.model.model_validate_json(path.read_text(encoding="utf-8"))
            for path in self.root.glob("*.json")
        ]
        return sorted(records, key=lambda item: item.updated_at, reverse=True)


class ProjectStore(JsonRecordStore[ProjectRecord]):
    def __init__(self, root: Path):
        super().__init__(root, ProjectRecord)

    def create(self, payload: ProjectCreate) -> ProjectRecord:
        now = utc_now()
        record = ProjectRecord(
            id=secrets.token_urlsafe(12),
            created_at=now,
            updated_at=now,
            **payload.model_dump(),
        )
        with self.lock:
            self._write(record)
        return record

    def update(self, project_id: str, changes: dict) -> ProjectRecord:
        with self.lock:
            record = self.get(project_id)
            allowed = {"name", "mode", "prompt", "params", "final_job_id"}
            clean = {key: value for key, value in changes.items() if key in allowed}
            record = record.model_copy(
                update={**clean, "updated_at": utc_now()}
            )
            self._write(record)
            return record

    def archive(self, project_id: str) -> ProjectRecord:
        with self.lock:
            record = self.get(project_id).model_copy(
                update={"archived": True, "updated_at": utc_now()}
            )
            self._write(record)
            return record


class JobStore(JsonRecordStore[JobRecord]):
    def __init__(self, root: Path):
        super().__init__(root, JobRecord)

    def create(self, payload: JobCreate) -> JobRecord:
        now = utc_now()
        record = JobRecord(
            id=secrets.token_urlsafe(12),
            status="queued",
            created_at=now,
            updated_at=now,
            **payload.model_dump(),
        )
        with self.lock:
            self._write(record)
        return record

    def update(self, job_id: str, changes: dict) -> JobRecord:
        with self.lock:
            record = self.get(job_id).model_copy(
                update={**changes, "updated_at": utc_now()}
            )
            self._write(record)
            return record

    def recover_interrupted(self) -> None:
        with self.lock:
            for record in self.list():
                if record.status in {"queued", "running"}:
                    self.update(
                        record.id,
                        {
                            "status": "interrupted",
                            "error": "Local service restarted before completion",
                        },
                    )


class AssetRecord:
    def __init__(self, asset_id: str, path: Path, mime_type: str):
        self.id = asset_id
        self.path = path
        self.mime_type = mime_type


class AssetRegistry:
    def __init__(self, registry_path: Path):
        self.registry_path = registry_path
        self.lock = RLock()
        self.registry_path.parent.mkdir(parents=True, exist_ok=True)
        if self.registry_path.is_file():
            self.records = json.loads(
                self.registry_path.read_text(encoding="utf-8")
            )
        else:
            self.records: dict[str, dict[str, str]] = {}

    def _save(self) -> None:
        temp = self.registry_path.with_suffix(".json.part")
        temp.write_text(
            json.dumps(self.records, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        temp.replace(self.registry_path)

    def register(self, path: Path, mime_type: str) -> AssetRecord:
        resolved = path.resolve()
        if not resolved.is_file():
            raise ValueError("Asset file does not exist")
        asset_id = secrets.token_urlsafe(12)
        with self.lock:
            self.records[asset_id] = {
                "path": str(resolved),
                "mime_type": mime_type,
            }
            self._save()
        return AssetRecord(asset_id, resolved, mime_type)

    def get(self, asset_id: str) -> AssetRecord:
        require_safe_id(asset_id)
        item = self.records.get(asset_id)
        if not item:
            raise KeyError(asset_id)
        path = Path(item["path"]).resolve()
        if not path.is_file():
            raise KeyError(asset_id)
        return AssetRecord(asset_id, path, item["mime_type"])
