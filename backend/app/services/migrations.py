"""One-shot migration of the v1 JSON data directory into the V2 SQLite store.

Version 1 recorded that metadata lived in ``projects/``, ``jobs/`` and
``assets.json``; version 2 creates ``002_studio.sql`` and imports those files.
The import builds a temporary database and only publishes it with an atomic
rename, so a crash leaves the previous state untouched.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import shutil
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterable, Optional

from app.models import GenerationParams, ProjectCreate
from app.services.storage import require_safe_id, sanitize_error


MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / "migrations"
SCHEMA_VERSION_V1 = 1
SCHEMA_VERSION_V2 = 2
SAFE_NAME = re.compile(r"^[A-Za-z0-9_.-]+$")
Progress = Optional[Callable[[str], None]]


class MigrationError(RuntimeError):
    def __init__(self, issues: list[str]) -> None:
        super().__init__(
            "v1 数据无法安全迁移，请先备份后修复：" + "；".join(issues)
        )
        self.issues = issues


@dataclass
class MigrationReport:
    imported: bool = False
    backup_id: str = ""
    projects: int = 0
    jobs: int = 0
    assets: int = 0
    issues: list[str] = field(default_factory=list)


class StudioSchema:
    """Owns connection pragmas and DDL so store and migration stay identical."""

    @staticmethod
    def apply_pragmas(connection: sqlite3.Connection) -> None:
        connection.isolation_level = None
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 5000")

    @staticmethod
    def apply_wal(connection: sqlite3.Connection) -> None:
        connection.execute("PRAGMA journal_mode = WAL")

    @staticmethod
    def ddl() -> str:
        return (MIGRATIONS_DIR / "002_studio.sql").read_text(encoding="utf-8")

    @staticmethod
    def create(connection: sqlite3.Connection) -> None:
        StudioSchema.apply_pragmas(connection)
        connection.executescript(StudioSchema.ddl())


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def canonical_params(raw: Any) -> dict[str, Any]:
    return GenerationParams.model_validate(raw or {}).model_dump(mode="json")


def project_row(payload: dict[str, Any]) -> tuple:
    body = {
        "name": payload["name"],
        "mode": payload["mode"],
        "prompt": payload.get("prompt", ""),
        "params": payload.get("params") or {},
    }
    create = ProjectCreate.model_validate(body)
    revision = payload.get("revision") or 1
    return (
        payload["id"],
        create.name,
        create.mode,
        create.prompt,
        json.dumps(canonical_params(payload.get("params")), ensure_ascii=False),
        json.dumps(payload.get("reference_bindings") or [], ensure_ascii=False),
        (
            json.dumps(payload["template_application"], ensure_ascii=False)
            if payload.get("template_application") is not None
            else None
        ),
        payload.get("output_directory_id"),
        int(revision),
        1 if payload.get("archived") else 0,
        payload.get("deleted_at"),
        payload.get("final_job_id"),
        payload.get("created_at") or now_iso(),
        payload.get("updated_at") or now_iso(),
    )


PROJECT_COLUMNS = (
    "id, name, mode, prompt, params_json, reference_bindings_json, "
    "template_application_json, output_directory_id, revision, archived, "
    "deleted_at, final_job_id, created_at, updated_at"
)

JOB_COLUMNS = (
    "id, batch_id, variant_index, project_id, project_name, display_name, note, "
    "mode, prompt, compiled_prompt, params_json, reference_snapshot_json, "
    "output_directory_id, output_path_snapshot, status, stage, attempt, "
    "output_asset_id, report_json, error_json, elapsed_seconds, parent_job_id, "
    "favorite, deleted_at, created_at, updated_at"
)

ASSET_COLUMNS = (
    "id, owner_type, owner_id, kind, canonical_path, mime_type, bytes, sha256, "
    "ownership, hidden, deleted_at, created_at, updated_at"
)


def strip_reference_tokens(references: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Legacy consent tokens never become live upload authorisation."""
    snapshot: list[dict[str, Any]] = []
    for item in references:
        snapshot.append(
            {
                "reference_id": item.get("id") or item.get("reference_id"),
                "name": item.get("name") or item.get("id") or "未命名音色",
                "requires_reconfirmation": True,
            }
        )
    return snapshot


def job_row(payload: dict[str, Any]) -> tuple:
    status = payload.get("status") or "interrupted"
    elapsed = payload.get("elapsed_seconds")
    error = payload.get("error")
    return (
        payload["id"],
        payload.get("batch_id"),
        payload.get("variant_index"),
        payload["project_id"],
        payload.get("project_name") or payload.get("display_name") or "未命名项目",
        payload.get("display_name")
        or payload.get("project_name")
        or "未命名任务",
        payload.get("note") or "",
        payload.get("mode") or "auto",
        payload.get("prompt") or "",
        payload.get("compiled_prompt") or payload.get("prompt") or "",
        json.dumps(canonical_params(payload.get("params")), ensure_ascii=False),
        json.dumps(
            payload.get("reference_snapshot")
            or strip_reference_tokens(payload.get("references") or []),
            ensure_ascii=False,
        ),
        payload.get("output_directory_id"),
        payload.get("output_path_snapshot"),
        status,
        payload.get("stage"),
        int(payload.get("attempt") or 1),
        payload.get("output_asset_id"),
        (
            json.dumps(payload["report"], ensure_ascii=False)
            if payload.get("report") is not None
            else None
        ),
        (
            json.dumps(
                {
                    "code": payload.get("error_code") or "LEGACY_FAILURE",
                    "message": sanitize_error(str(error)),
                    "retryable": True,
                },
                ensure_ascii=False,
            )
            if error
            else None
        ),
        float(elapsed) if elapsed is not None else None,
        payload.get("parent_job_id"),
        1 if payload.get("favorite") else 0,
        payload.get("deleted_at"),
        payload.get("created_at") or now_iso(),
        payload.get("updated_at") or now_iso(),
    )


def asset_row(
    asset_id: str,
    record: dict[str, Any],
    *,
    owner_id: str = "",
    ownership: str = "legacy_generated",
    kind: str = "generated_audio",
) -> tuple:
    timestamp = now_iso()
    return (
        asset_id,
        "job" if owner_id else "unowned",
        owner_id,
        kind,
        record["path"],
        record.get("mime_type") or "application/octet-stream",
        int(record.get("bytes") or _size_on_disk(record["path"])),
        record.get("sha256") or "",
        ownership,
        1 if record.get("hidden") else 0,
        record.get("deleted_at"),
        timestamp,
        timestamp,
    )


def _size_on_disk(path: str) -> int:
    try:
        return Path(path).stat().st_size
    except OSError:
        return 0


def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _digest(data_root: Path) -> str:
    digest = hashlib.sha256()
    for path in _source_files(data_root):
        digest.update(path.relative_to(data_root).as_posix().encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
    return digest.hexdigest()


def _source_files(data_root: Path) -> list[Path]:
    files = sorted((data_root / "projects").glob("*.json"))
    files += sorted((data_root / "jobs").glob("*.json"))
    if (data_root / "assets.json").is_file():
        files.append(data_root / "assets.json")
    return files


def _scan_v1(data_root: Path) -> tuple[list[dict], list[dict], dict[str, dict], list[str]]:
    projects: list[dict] = []
    jobs: list[dict] = []
    issues: list[str] = []

    for path in sorted((data_root / "projects").glob("*.json")):
        record = _read_json(path)
        if not isinstance(record, dict):
            issues.append(f"{path.name} 无法解析为 JSON 对象")
            continue
        if _safe_id(record.get("id")) != path.stem:
            issues.append(f"{path.name} 的 id 与文件名不一致或缺失")
            continue
        try:
            canonical_params(record.get("params"))
            ProjectCreate.model_validate(
                {
                    "name": record.get("name") or record["id"],
                    "mode": record.get("mode") or "auto",
                    "prompt": record.get("prompt") or "",
                    "params": record.get("params") or {},
                }
            )
        except Exception as exc:
            issues.append(f"{path.name} 字段校验失败：{type(exc).__name__}")
            continue
        projects.append(record)

    for path in sorted((data_root / "jobs").glob("*.json")):
        record = _read_json(path)
        if not isinstance(record, dict):
            issues.append(f"{path.name} 无法解析为 JSON 对象")
            continue
        job_id = _safe_id(record.get("id"))
        if job_id != path.stem or not job_id:
            issues.append(f"{path.name} 的 id 与文件名不一致或缺失")
            continue
        known = {project["id"] for project in projects}
        if record.get("project_id") not in known:
            issues.append(f"{path.name} 引用了不存在的项目 {record.get('project_id')!r}")
            continue
        jobs.append(record)

    assets_raw = _read_json(data_root / "assets.json") if (data_root / "assets.json").is_file() else {}
    if (data_root / "assets.json").is_file() and not isinstance(assets_raw, dict):
        issues.append("assets.json 无法解析为对象")
        assets_raw = {}
    assets: dict[str, dict] = {
        str(key): value
        for key, value in (assets_raw or {}).items()
        if isinstance(value, dict) and value.get("path")
    }
    for key, value in (assets_raw or {}).items():
        if not isinstance(value, dict) or not value.get("path"):
            issues.append(f"assets.json 中 {key} 缺少路径")
    return projects, jobs, assets, issues


def _safe_id(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    try:
        return require_safe_id(value)
    except ValueError:
        return ""


def _backup_sources(data_root: Path, digest: str) -> str:
    backup_id = f"{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}-{secrets.token_hex(4)}"
    target = data_root / "backups" / backup_id
    target.mkdir(parents=True, exist_ok=False)
    manifest: dict[str, Any] = {"digest": digest, "files": {}}
    for path in _source_files(data_root):
        relative = path.relative_to(data_root)
        destination = target / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, destination)
        manifest["files"][relative.as_posix()] = hashlib.sha256(
            path.read_bytes()
        ).hexdigest()
    (target / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return backup_id


def _project_owners(jobs: list[dict]) -> dict[str, str]:
    owners: dict[str, str] = {}
    for job in jobs:
        if job.get("output_asset_id"):
            owners.setdefault(job["output_asset_id"], job["id"])
    return owners


class _DataRootLock:
    """Refuses a second migration over the same directory."""

    def __init__(self, data_root: Path) -> None:
        self.path = data_root / "studio.lock"
        self.handle: Any = None

    def __enter__(self) -> "_DataRootLock":
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.handle = self.path.open("a+")
        if os.name == "posix":
            import fcntl

            try:
                fcntl.flock(self.handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError as exc:
                self.handle.close()
                self.handle = None
                raise MigrationError(["数据目录正被另一个实例占用"]) from exc
        return self

    def __exit__(self, *_: object) -> None:
        if self.handle is not None:
            self.handle.close()
            self.handle = None


def _report_from(connection: sqlite3.Connection) -> MigrationReport:
    def count(table: str) -> int:
        return int(connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])

    backup_id = connection.execute(
        "SELECT backup_id FROM schema_migrations WHERE version = ?",
        (SCHEMA_VERSION_V2,),
    ).fetchone()
    return MigrationReport(
        imported=False,
        backup_id=backup_id[0] if backup_id and backup_id[0] else "",
        projects=count("projects"),
        jobs=count("jobs"),
        assets=count("assets"),
    )


def migrate_v1_to_sqlite(data_root: Path, progress: Progress = None) -> MigrationReport:
    data_root = Path(data_root)
    final_db = data_root / "studio.sqlite3"
    if final_db.exists():
        connection = sqlite3.connect(final_db)
        try:
            StudioSchema.apply_pragmas(connection)
            return _report_from(connection)
        finally:
            connection.close()

    def advance(phase: str) -> None:
        if progress is not None:
            progress(phase)

    advance("scan")
    projects, jobs, assets, issues = _scan_v1(data_root)
    if issues:
        raise MigrationError(sorted(set(issues)))

    has_v1_sources = bool(projects or jobs or assets or (data_root / "assets.json").is_file())
    digest = _digest(data_root) if has_v1_sources else "empty"
    advance("backup")
    backup_id = _backup_sources(data_root, digest) if has_v1_sources else ""

    temp_db = data_root / "studio.sqlite3.part"
    if temp_db.exists():
        temp_db.unlink()
    with _DataRootLock(data_root):
        connection = sqlite3.connect(temp_db)
        try:
            StudioSchema.create(connection)
            connection.execute("BEGIN")
            stamp = now_iso()
            connection.execute(
                "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
                (SCHEMA_VERSION_V1, stamp),
            )
            _ensure_settings(connection)
            for record in projects:
                connection.execute(
                    f"INSERT INTO projects ({PROJECT_COLUMNS}) VALUES ("
                    + ",".join("?" * 14)
                    + ")",
                    project_row(record),
                )
            advance("jobs")
            owners = _project_owners(jobs)
            for record in jobs:
                payload = dict(record)
                if payload.get("status") in {"queued", "running"}:
                    payload["status"] = "interrupted"
                    payload["error"] = (
                        payload.get("error")
                        or "本地服务在完成前重启，需要人工确认后重试"
                    )
                payload["output_path_snapshot"] = (
                    assets.get(payload.get("output_asset_id") or "", {}).get("path")
                )
                connection.execute(
                    f"INSERT INTO jobs ({JOB_COLUMNS}) VALUES ("
                    + ",".join("?" * 26)
                    + ")",
                    job_row(payload),
                )
            advance("assets")
            for asset_id, record in assets.items():
                connection.execute(
                    f"INSERT INTO assets ({ASSET_COLUMNS}) VALUES ("
                    + ",".join("?" * 13)
                    + ")",
                    asset_row(asset_id, record, owner_id=owners.get(asset_id, "")),
                )
            connection.execute(
                "INSERT INTO schema_migrations "
                "(version, applied_at, source_digest, backup_id) VALUES (?, ?, ?, ?)",
                (SCHEMA_VERSION_V2, now_iso(), digest, backup_id or None),
            )
            connection.execute("COMMIT")
            connection.execute("PRAGMA foreign_key_check")
        except BaseException:
            connection.rollback()
            connection.close()
            temp_db.unlink(missing_ok=True)
            raise
        else:
            connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            connection.close()
            os.replace(temp_db, final_db)
    advance("finalize")
    return MigrationReport(
        imported=True,
        backup_id=backup_id,
        projects=len(projects),
        jobs=len(jobs),
        assets=len(assets),
    )


def _ensure_settings(connection: sqlite3.Connection) -> None:
    stamp = now_iso()
    connection.execute(
        "INSERT INTO settings (singleton_id, revision, default_params_json, "
        "script_font, script_font_size, max_workers, created_at, updated_at) "
        "VALUES (1, 1, ?, 'serif', 16, 2, ?, ?)",
        (
            json.dumps(canonical_params(None), ensure_ascii=False),
            stamp,
            stamp,
        ),
    )
