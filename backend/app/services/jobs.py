from __future__ import annotations

import re
from concurrent.futures import Future, ThreadPoolExecutor
from threading import RLock
from typing import Callable

from app.models import JobCreate, JobRecord
from app.services.storage import JobStore


def sanitize_error(value: str) -> str:
    value = re.sub(r"sk-[A-Za-z0-9]{12,}", "<redacted>", value)
    value = re.sub(r"llm-[A-Za-z0-9-]{8,}", "<redacted>", value)
    value = re.sub(
        r"data:audio/[A-Za-z0-9.+-]+;base64,[A-Za-z0-9+/=_-]+",
        "<redacted audio data>",
        value,
    )
    return value[-2000:]


class JobManager:
    def __init__(
        self,
        store: JobStore,
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
