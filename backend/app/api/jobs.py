from fastapi import APIRouter, HTTPException, Request

from app.models import JobCreate
from pydantic import BaseModel, Field
from app.errors import DomainError

class RetryPayload(BaseModel):
    client_request_id:str=Field(pattern=r'^[A-Za-z0-9_-]{1,100}$')
    acknowledge_new_charge:bool=False
    consent_id:str|None=None


router = APIRouter()


@router.get("/api/jobs")
def list_jobs(request: Request):
    result=[]
    for row in request.app.state.studio.list_jobs():
        job=request.app.state.library.job(row['id'])
        job.pop('output_path_snapshot',None)
        result.append(job)
    return result


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
        job=request.app.state.library.job(job_id)
        job.pop('output_path_snapshot',None)
        return job
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
def retry_job(job_id: str, request: Request, payload:RetryPayload|None=None):
    try:
        snapshot=request.app.state.studio.get_job(job_id)
        if snapshot['batch_id']:
            if not payload or not payload.acknowledge_new_charge:
                raise DomainError('CHARGE_CONFIRMATION_REQUIRED','重新生成会产生新调用，请先确认。')
            if snapshot['status'] in {'queued','running'}:
                raise DomainError('JOB_IN_USE','请等待当前任务结束。')
            project=request.app.state.studio.get_project(snapshot['project_id'])
            retry_payload={'client_request_id':payload.client_request_id,'project_id':snapshot['project_id'],
                'expected_project_revision':project['revision'],'mode':snapshot['mode'],'prompt':snapshot['prompt'],
                'params':snapshot['params'],'reference_bindings':[{'reference_id':r['reference_id'],'alias':r.get('alias','')} for r in snapshot['reference_snapshot']],
                'output_directory_id':snapshot['output_directory_id'],'candidate_seeds':[snapshot['params']['seed']],
                'consent_id':payload.consent_id}
            retry_payload['confirmed_request_hash']=request.app.state.generation.preflight(retry_payload)['request_hash']
            result,created=request.app.state.generation.submit(retry_payload)
            if created:
                for new_id in result['job_ids']:
                    request.app.state.studio.update_job(new_id,{'parent_job_id':job_id})
            return result
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
