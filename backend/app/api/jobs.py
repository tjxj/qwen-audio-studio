from fastapi import APIRouter, HTTPException, Request

from app.models import JobCreate


router = APIRouter()


@router.get("/api/jobs")
def list_jobs(request: Request):
    return request.app.state.job_store.list()


@router.post("/api/jobs", status_code=201)
def create_job(payload: JobCreate, request: Request):
    status = request.app.state.credential_store.status()
    if not status.api_key_configured or not status.workspace_configured:
        raise HTTPException(status_code=409, detail="Credentials are not configured")
    try:
        return request.app.state.job_manager.submit(payload)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/api/jobs/{job_id}")
def get_job(job_id: str, request: Request):
    try:
        return request.app.state.job_store.get(job_id)
    except (KeyError, ValueError) as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc


@router.post("/api/jobs/{job_id}/cancel")
def cancel_job(job_id: str, request: Request):
    try:
        record = request.app.state.job_manager.cancel(job_id)
        if record.status == "cancelled":
            for item in record.references:
                request.app.state.reference_registry.cleanup(item.id)
        return record
    except (KeyError, ValueError) as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc


@router.post("/api/jobs/{job_id}/retry", status_code=201)
def retry_job(job_id: str, request: Request):
    try:
        old = request.app.state.job_store.get(job_id)
        for item in old.references:
            request.app.state.reference_registry.require_consent(
                item.id, item.consent_token
            )
        return request.app.state.job_manager.retry(job_id)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except (KeyError, ValueError) as exc:
        if isinstance(exc, ValueError):
            raise HTTPException(
                status_code=409,
                detail="Reference audio expired; select it again before retrying",
            ) from exc
        raise HTTPException(status_code=404, detail="Job not found") from exc
