from __future__ import annotations

from concurrent.futures import Future, ThreadPoolExecutor
from threading import RLock
from typing import Callable

from app.models import JobCreate, JobRecord, ReferenceConsent
from app.services.storage import JobStore, sanitize_error
from app.services.studio_store import StudioStore


class SqliteJobStore:
    """JobStore-shaped facade over the V2 tables so jobs have one source of truth.

    Upload consent tokens stay in this process only; persisted rows keep reference
    ids, so a retry after a restart has to re-confirm the upload.
    """

    def __init__(self, store: StudioStore) -> None:
        self.store = store
        self.lock = RLock()
        self._live_references: dict[str, list[ReferenceConsent]] = {}

    def create(self, payload: JobCreate) -> JobRecord:
        row = self.store.create_job(
            {
                "project_id": payload.project_id,
                "project_name": payload.project_name,
                "mode": payload.mode,
                "prompt": payload.prompt,
                "params": payload.params.model_dump(mode="json"),
                "reference_snapshot": [
                    {
                        "reference_id": item.id,
                        "name": item.id,
                        "requires_reconfirmation": False,
                    }
                    for item in payload.references
                ],
                "status": "queued",
            }
        )
        with self.lock:
            self._live_references[row["id"]] = list(payload.references)
        return self._record(row)

    def get(self, job_id: str) -> JobRecord:
        return self._record(self.store.get_job(job_id))

    def update(self, job_id: str, changes: dict) -> JobRecord:
        return self._record(self.store.update_job(job_id, changes))

    def list(self) -> list[JobRecord]:
        return [self._record(row) for row in self.store.list_jobs()]

    def recover_interrupted(self) -> None:
        for row in self.store.list_jobs():
            if row["status"] in {"queued", "running"}:
                self.store.mark_interrupted(row["id"])
        with self.lock:
            self._live_references.clear()

    def _record(self, row: dict) -> JobRecord:
        with self.lock:
            live = self._live_references.get(row["id"])
        references = live or [
            ReferenceConsent(
                id=item.get("reference_id") or "",
                consent_token=item.get("consent_token") or "",
            )
            for item in row["reference_snapshot"]
        ]
        error = row["error"]
        return JobRecord(
            id=row["id"],
            project_id=row["project_id"],
            project_name=row["project_name"],
            mode=row["mode"],
            prompt=row["prompt"],
            params=row["params"],
            references=references,
            status=row["status"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            elapsed_seconds=row["elapsed_seconds"],
            output_asset_id=row["output_asset_id"],
            error=error["message"] if isinstance(error, dict) else error,
            report=row["report"],
        )


class JobManager:
    def __init__(
        self,
        store: "JobStore | SqliteJobStore",
        worker: Callable[[JobRecord], dict],
        max_workers: int = 2,
    ):
        self.store = store
        self.worker = worker
        self.executor = ThreadPoolExecutor(
            max_workers=max_workers, thread_name_prefix="qwen-audio-job"
        )
        self.futures: dict[str, Future] = {}
        self.lock = RLock()
        self.store.recover_interrupted()

    def submit(self, payload: JobCreate) -> JobRecord:
        record = self.store.create(payload)
        with self.lock:
            self.futures[record.id] = self.executor.submit(
                self._run, record.id
            )
        return record

    def _run(self, job_id: str) -> None:
        record = self.store.update(job_id, {"status": "running", "error": None})
        try:
            result = self.worker(record)
            self.store.update(
                job_id,
                {
                    "status": "success",
                    "elapsed_seconds": result.get("elapsed_seconds"),
                    "output_asset_id": result.get("output_asset_id"),
                    "report": result.get("report"),
                },
            )
        except Exception as exc:
            self.store.update(
                job_id,
                {
                    "status": "failed",
                    "error": sanitize_error(str(exc)),
                },
            )

    def cancel(self, job_id: str) -> JobRecord:
        future = self.futures.get(job_id)
        if future and future.cancel():
            return self.store.update(job_id, {"status": "cancelled"})
        record = self.store.get(job_id)
        if record.status == "queued":
            return self.store.update(job_id, {"status": "cancelled"})
        return record

    def retry(self, job_id: str) -> JobRecord:
        old = self.store.get(job_id)
        return self.submit(JobCreate(**old.model_dump(include={
            "project_id", "project_name", "mode", "prompt", "params", "references"
        })))

    def wait(self, job_id: str, timeout: float | None = None) -> JobRecord:
        future = self.futures.get(job_id)
        if future:
            future.result(timeout=timeout)
        return self.store.get(job_id)

    def shutdown(self) -> None:
        self.executor.shutdown(wait=True, cancel_futures=True)
