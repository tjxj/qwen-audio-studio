"""SQLite-backed metadata store for projects, jobs and assets.

Write paths are short transactions; no cloud call or ffmpeg run happens inside one.
Connections are opened per operation so a request thread and a worker thread never
share a cursor.
"""

from __future__ import annotations

import json
import secrets
import sqlite3
from pathlib import Path
from typing import Any, Optional

from pydantic import ValidationError

from app.models import ProjectCreate, ProjectPatch
from app.services.migrations import (
    ASSET_COLUMNS,
    JOB_COLUMNS,
    PROJECT_COLUMNS,
    StudioSchema,
    asset_row,
    job_row,
    migrate_v1_to_sqlite,
    now_iso,
    project_row,
)
from app.services.storage import require_safe_id, sanitize_error


DATABASE_NAME = "studio.sqlite3"

JOB_UPDATABLE = {
    "attempt",
    "batch_id",
    "compiled_prompt",
    "deleted_at",
    "display_name",
    "elapsed_seconds",
    "error",
    "favorite",
    "note",
    "output_asset_id",
    "output_directory_id",
    "output_path_snapshot",
    "params",
    "parent_job_id",
    "prompt",
    "reference_snapshot",
    "report",
    "stage",
    "status",
    "variant_index",
}


class RevisionConflict(RuntimeError):
    code = "REVISION_CONFLICT"

    def __init__(self, entity_id: str, current_revision: int) -> None:
        super().__init__(
            f"{entity_id} 已被另一处修改，当前 revision 为 {current_revision}"
        )
        self.entity_id = entity_id
        self.current_revision = current_revision


class UnknownField(ValueError):
    code = "INVALID_PARAMS"


def _load(raw: Optional[str], fallback: Any) -> Any:
    if raw in (None, ""):
        return fallback
    return json.loads(raw)


class StudioStore:
    def __init__(self, data_root: Path) -> None:
        self.data_root = Path(data_root)
        self.db_path = self.data_root / DATABASE_NAME

    # ---------------------------------------------------------------- lifecycle

    def initialize(self) -> None:
        self.data_root.mkdir(parents=True, exist_ok=True)
        try:
            self.data_root.chmod(0o700)
        except OSError:
            pass
        if not self.db_path.exists():
            migrate_v1_to_sqlite(self.data_root)

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.db_path)
        StudioSchema.apply_pragmas(connection)
        StudioSchema.apply_wal(connection)
        connection.row_factory = sqlite3.Row
        return connection

    @staticmethod
    def new_id(prefix: str) -> str:
        return f"{prefix}_{secrets.token_urlsafe(12)}"

    # ------------------------------------------------------------------ projects

    def create_project(self, payload: dict[str, Any]) -> dict[str, Any]:
        try:
            create = ProjectCreate.model_validate(payload, from_attributes=False)
        except ValidationError as exc:
            _revalidation_error(exc)
            raise
        stamp = now_iso()
        record = {
            **create.model_dump(mode="python"),
            "id": self.new_id("proj"),
            "revision": 1,
            "archived": False,
            "final_job_id": None,
            "created_at": stamp,
            "updated_at": stamp,
        }
        connection = self._connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute(
                f"INSERT INTO projects ({PROJECT_COLUMNS}) VALUES ("
                + ",".join("?" * 14)
                + ")",
                project_row(record),
            )
            connection.execute("COMMIT")
        finally:
            connection.close()
        return self.get_project(record["id"])

    def get_project(self, project_id: str) -> dict[str, Any]:
        require_safe_id(project_id)
        connection = self._connect()
        try:
            row = connection.execute(
                f"SELECT {PROJECT_COLUMNS} FROM projects WHERE id = ?", (project_id,)
            ).fetchone()
        finally:
            connection.close()
        if row is None:
            raise KeyError(project_id)
        return _project_dict(row)

    def save_project(
        self, project_id: str, expected_revision: int, changes: dict[str, Any]
    ) -> dict[str, Any]:
        require_safe_id(project_id)
        patch = _validated_patch(changes, expected_revision)
        connection = self._connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            current = connection.execute(
                "SELECT revision FROM projects WHERE id = ?", (project_id,)
            ).fetchone()
            if current is None:
                raise KeyError(project_id)
            columns: dict[str, Any] = {"updated_at": now_iso()}
            for key, value in patch.items():
                columns[key] = _project_column_value(key, value)
            assignments = ", ".join(f"{name} = ?" for name in columns)
            result = connection.execute(
                f"UPDATE projects SET {assignments}, revision = revision + 1 "
                "WHERE id = ? AND revision = ?",
                (*columns.values(), project_id, expected_revision),
            )
            if result.rowcount != 1:
                raise RevisionConflict(project_id, int(current["revision"]))
            connection.execute("COMMIT")
        finally:
            connection.close()
        return self.get_project(project_id)

    def set_final_job(self, project_id: str, job_id: str) -> dict[str, Any]:
        require_safe_id(project_id)
        require_safe_id(job_id)
        connection = self._connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            project = connection.execute(
                "SELECT id FROM projects WHERE id = ?", (project_id,)
            ).fetchone()
            if project is None:
                raise KeyError(project_id)
            job = connection.execute(
                "SELECT status, deleted_at, output_asset_id FROM jobs "
                "WHERE id = ? AND project_id = ?",
                (job_id, project_id),
            ).fetchone()
            if job is None:
                raise ValueError("最终版本必须属于该项目")
            if job["status"] != "success" or job["deleted_at"] is not None:
                raise ValueError("只有成功且未删除的任务可以标记为最终版本")
            asset_id = job["output_asset_id"]
            asset = (
                connection.execute(
                    "SELECT canonical_path, deleted_at FROM assets WHERE id = ?",
                    (asset_id,),
                ).fetchone()
                if asset_id
                else None
            )
            if asset is None or asset["deleted_at"] is not None:
                raise ValueError("该任务缺少可用的音频文件")
            if not Path(asset["canonical_path"]).is_file():
                raise ValueError("音频文件已移动或缺失")
            connection.execute(
                "UPDATE projects SET final_job_id = ?, updated_at = ? WHERE id = ?",
                (job_id, now_iso(), project_id),
            )
            connection.execute("COMMIT")
        finally:
            connection.close()
        return self.get_project(project_id)

    def clear_final_job(self, project_id: str) -> None:
        connection = self._connect()
        try:
            connection.execute(
                "UPDATE projects SET final_job_id = NULL, updated_at = ? "
                "WHERE id = ? AND final_job_id IS NOT NULL",
                (now_iso(), project_id),
            )
            connection.execute("COMMIT")
        finally:
            connection.close()

    def list_projects(self, include_archived: bool = True) -> list[dict[str, Any]]:
        sql = f"SELECT {PROJECT_COLUMNS} FROM projects WHERE deleted_at IS NULL"
        if not include_archived:
            sql += " AND archived = 0"
        sql += " ORDER BY updated_at DESC, id DESC"
        connection = self._connect()
        try:
            return [_project_dict(row) for row in connection.execute(sql)]
        finally:
            connection.close()

    def duplicate_project(self, project_id: str, name: Optional[str]) -> dict[str, Any]:
        source = self.get_project(project_id)
        payload = {
            "name": name or f"{source['name']} 副本",
            "mode": source["mode"],
            "prompt": source["prompt"],
            "params": source["params"],
            "reference_bindings": source["reference_bindings"],
            "template_application": source["template_application"],
            "output_directory_id": source["output_directory_id"],
        }
        # Generated jobs, files and the final-version mark stay with the source.
        return self.create_project({k: v for k, v in payload.items() if v is not None})

    def set_archived(self, project_id: str, archived: bool) -> dict[str, Any]:
        connection = self._connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            result = connection.execute(
                "UPDATE projects SET archived = ?, updated_at = ? WHERE id = ? "
                "AND deleted_at IS NULL",
                (1 if archived else 0, now_iso(), project_id),
            )
            if result.rowcount != 1:
                raise KeyError(project_id)
            connection.execute("COMMIT")
        finally:
            connection.close()
        return self.get_project(project_id)

    # ---------------------------------------------------------------------- jobs

    def create_job(self, payload: dict[str, Any]) -> dict[str, Any]:
        job = dict(payload)
        job.setdefault("id", self.new_id("job"))
        job["status"] = job.get("status") or "queued"
        job.setdefault("created_at", now_iso())
        job.setdefault("updated_at", job["created_at"])
        connection = self._connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            owner = connection.execute(
                "SELECT id FROM projects WHERE id = ?", (job["project_id"],)
            ).fetchone()
            if owner is None:
                raise ValueError(f"项目 {job['project_id']} 不存在，请先保存草稿。")
            connection.execute(
                f"INSERT INTO jobs ({JOB_COLUMNS}) VALUES ("
                + ",".join("?" * 26)
                + ")",
                job_row(job),
            )
            connection.execute("COMMIT")
        finally:
            connection.close()
        return self.get_job(job["id"])

    def list_jobs(self) -> list[dict[str, Any]]:
        connection = self._connect()
        try:
            return [
                _job_dict(row)
                for row in connection.execute(
                    f"SELECT {JOB_COLUMNS} FROM jobs WHERE deleted_at IS NULL "
                    "ORDER BY created_at DESC, id DESC"
                )
            ]
        finally:
            connection.close()

    def update_job(self, job_id: str, changes: dict[str, Any]) -> dict[str, Any]:
        require_safe_id(job_id)
        columns: dict[str, Any] = {}
        for key, value in changes.items():
            if key == "error":
                if value is None:
                    columns["error_json"] = None
                    continue
                body = value if isinstance(value, dict) else {
                    "code": "GENERATION_FAILED",
                    "message": sanitize_error(str(value)),
                    "retryable": True,
                }
                columns["error_json"] = json.dumps(body, ensure_ascii=False)
            elif key == "report":
                columns["report_json"] = (
                    None if value is None else json.dumps(value, ensure_ascii=False)
                )
            elif key == "params":
                columns["params_json"] = json.dumps(value, ensure_ascii=False)
            elif key == "reference_snapshot":
                columns["reference_snapshot_json"] = json.dumps(
                    value, ensure_ascii=False
                )
            elif key in JOB_UPDATABLE:
                columns[key] = (1 if value else 0) if key == "favorite" else value
            else:
                raise UnknownField(f"任务字段不可修改：{key}")
        columns["updated_at"] = now_iso()
        assignments = ", ".join(f"{name} = ?" for name in columns)
        connection = self._connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            result = connection.execute(
                f"UPDATE jobs SET {assignments} WHERE id = ?",
                (*columns.values(), job_id),
            )
            if result.rowcount != 1:
                raise KeyError(job_id)
            connection.execute("COMMIT")
        finally:
            connection.close()
        return self.get_job(job_id)

    def mark_interrupted(self, job_id: str) -> None:
        self.update_job(
            job_id,
            {
                "status": "interrupted",
                "stage": None,
                "error": "本地服务在完成前重启，需要人工确认后重试",
            },
        )

    def record_job(
        self, payload: dict[str, Any], asset: Optional[dict[str, Any]] = None
    ) -> dict[str, Any]:
        job = dict(payload)
        job.setdefault("id", self.new_id("job"))
        job.setdefault("created_at", now_iso())
        job.setdefault("updated_at", job["created_at"])
        if not job.get("display_name"):
            job["display_name"] = job.get("project_name") or "未命名任务"
        connection = self._connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute(
                f"INSERT INTO jobs ({JOB_COLUMNS}) VALUES ("
                + ",".join("?" * 26)
                + ")",
                job_row(job),
            )
            if asset is not None:
                body = dict(asset)
                body.setdefault("id", self.new_id("asset"))
                body.setdefault("owner_type", "job")
                body.setdefault("owner_id", job["id"])
                body.setdefault("kind", "generated_audio")
                body.setdefault("ownership", "generated")
                connection.execute(
                    f"INSERT INTO assets ({ASSET_COLUMNS}) VALUES ("
                    + ",".join("?" * 13)
                    + ")",
                    asset_row(
                        body["id"],
                        {
                            "path": body["canonical_path"],
                            "mime_type": body.get("mime_type"),
                            "bytes": body.get("bytes"),
                            "sha256": body.get("sha256"),
                            "hidden": body.get("hidden"),
                            "deleted_at": body.get("deleted_at"),
                        },
                        owner_id=body["owner_id"],
                        ownership=body["ownership"],
                        kind=body["kind"],
                    ),
                )
            connection.execute("COMMIT")
        finally:
            connection.close()
        return self.get_job(job["id"])

    def get_job(self, job_id: str) -> dict[str, Any]:
        require_safe_id(job_id)
        connection = self._connect()
        try:
            row = connection.execute(
                f"SELECT {JOB_COLUMNS} FROM jobs WHERE id = ?", (job_id,)
            ).fetchone()
        finally:
            connection.close()
        if row is None:
            raise KeyError(job_id)
        return _job_dict(row)

    def get_asset(self, asset_id: str) -> dict[str, Any]:
        require_safe_id(asset_id)
        connection = self._connect()
        try:
            row = connection.execute(
                f"SELECT {ASSET_COLUMNS} FROM assets WHERE id = ?", (asset_id,)
            ).fetchone()
        finally:
            connection.close()
        if row is None:
            raise KeyError(asset_id)
        return dict(row)

    def register_asset(
        self,
        path: Path,
        mime_type: str,
        *,
        owner_id: str = "",
        kind: str = "generated_audio",
        ownership: str = "generated",
        sha256: str = "",
    ) -> dict[str, Any]:
        resolved = Path(path).resolve()
        if not resolved.is_file():
            raise ValueError("Asset file does not exist")
        asset_id = self.new_id("asset")
        stamp = now_iso()
        connection = self._connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute(
                f"INSERT INTO assets ({ASSET_COLUMNS}) VALUES ("
                + ",".join("?" * 13)
                + ")",
                asset_row(
                    asset_id,
                    {
                        "path": str(resolved),
                        "mime_type": mime_type,
                        "bytes": resolved.stat().st_size,
                        "sha256": sha256,
                    },
                    owner_id=owner_id,
                    ownership=ownership,
                    kind=kind,
                ),
            )
            connection.execute("COMMIT")
        finally:
            connection.close()
        return self.get_asset(asset_id)

    def resolve_asset(self, asset_id: str) -> dict[str, Any]:
        """Registered assets only; callers never pass through a raw path."""
        asset = self.get_asset(asset_id)
        if asset["deleted_at"] is not None:
            raise FileNotFoundError(asset_id)
        path = Path(asset["canonical_path"])
        if not path.is_file():
            raise FileNotFoundError(asset_id)
        return {**asset, "path": path}

    def save_settings(
        self, expected_revision: int, changes: dict[str, Any]
    ) -> dict[str, Any]:
        columns = dict(changes)
        if "default_params" in columns:
            columns["default_params_json"] = json.dumps(
                columns.pop("default_params"), ensure_ascii=False
            )
        assignments = ", ".join(f"{name} = ?" for name in columns)
        connection = self._connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            current = connection.execute(
                "SELECT revision FROM settings WHERE singleton_id = 1"
            ).fetchone()
            if current is None:
                raise KeyError("settings")
            result = connection.execute(
                f"UPDATE settings SET {assignments}, revision = revision + 1, "
                "updated_at = ? WHERE singleton_id = 1 AND revision = ?",
                (
                    *columns.values(),
                    now_iso(),
                    expected_revision,
                ),
            )
            if result.rowcount != 1:
                raise RevisionConflict("settings", int(current["revision"]))
            connection.execute("COMMIT")
        finally:
            connection.close()
        return self.settings()

    def directory_exists(self, directory_id: str) -> bool:
        connection = self._connect()
        try:
            return (
                connection.execute(
                    "SELECT 1 FROM output_directories WHERE id = ?", (directory_id,)
                ).fetchone()
                is not None
            )
        finally:
            connection.close()

    def settings(self) -> dict[str, Any]:
        connection = self._connect()
        try:
            row = connection.execute(
                "SELECT revision, default_directory_id, default_params_json, "
                "script_font, script_font_size, max_workers FROM settings "
                "WHERE singleton_id = 1"
            ).fetchone()
        finally:
            connection.close()
        if row is None:
            raise KeyError("settings")
        return {
            "revision": row["revision"],
            "default_directory_id": row["default_directory_id"],
            "default_params": _load(row["default_params_json"], {}),
            "script_font": row["script_font"],
            "script_font_size": row["script_font_size"],
            "max_workers": row["max_workers"],
        }


def _validated_patch(changes: dict[str, Any], expected_revision: int) -> dict[str, Any]:
    try:
        patch = ProjectPatch.model_validate(
            {**changes, "expected_revision": expected_revision}
        )
    except ValidationError as exc:
        _revalidation_error(exc)
        raise
    return patch.model_dump(exclude_unset=True, exclude={"expected_revision"})


def _revalidation_error(exc: "ValidationError") -> None:
    extras = sorted(
        str(error["loc"][0])
        for error in exc.errors()
        if error["type"] == "extra_forbidden" and error["loc"]
    )
    if extras:
        raise UnknownField(f"字段不可修改：{', '.join(extras)}") from exc


def _project_column_value(key: str, value: Any) -> Any:
    if key == "params":
        return json.dumps(value, ensure_ascii=False)
    if key in {"reference_bindings", "template_application"}:
        return None if value is None else json.dumps(value, ensure_ascii=False)
    if key == "archived":
        return 1 if value else 0
    return value


def _project_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "mode": row["mode"],
        "prompt": row["prompt"],
        "params": _load(row["params_json"], {}),
        "reference_bindings": _load(row["reference_bindings_json"], []),
        "template_application": _load(row["template_application_json"], None),
        "output_directory_id": row["output_directory_id"],
        "revision": row["revision"],
        "archived": bool(row["archived"]),
        "final_job_id": row["final_job_id"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _job_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "batch_id": row["batch_id"],
        "variant_index": row["variant_index"],
        "project_id": row["project_id"],
        "project_name": row["project_name"],
        "display_name": row["display_name"],
        "note": row["note"],
        "mode": row["mode"],
        "prompt": row["prompt"],
        "compiled_prompt": row["compiled_prompt"],
        "params": _load(row["params_json"], {}),
        "reference_snapshot": _load(row["reference_snapshot_json"], []),
        "output_directory_id": row["output_directory_id"],
        "output_path_snapshot": row["output_path_snapshot"],
        "status": row["status"],
        "stage": row["stage"],
        "attempt": row["attempt"],
        "output_asset_id": row["output_asset_id"],
        "report": _load(row["report_json"], None),
        "error": _load(row["error_json"], None),
        "elapsed_seconds": row["elapsed_seconds"],
        "parent_job_id": row["parent_job_id"],
        "favorite": bool(row["favorite"]),
        "deleted_at": row["deleted_at"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }
