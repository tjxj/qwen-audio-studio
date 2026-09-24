from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, ConfigDict, Field, StrictInt

from app.errors import DomainError
from app.models import CreationMode, GenerationParams, ReferenceBinding

router=APIRouter()

class GenerationPayload(BaseModel):
    model_config=ConfigDict(extra='forbid')
    project_id:str
    expected_project_revision:int=Field(ge=1)
    mode:CreationMode
    prompt:str=Field(min_length=1,max_length=3000)
    params:GenerationParams=Field(default_factory=GenerationParams)
    reference_bindings:list[ReferenceBinding]=Field(default_factory=list,max_length=3)
    output_directory_id:str|None=None
    candidate_seeds:list[StrictInt]=Field(default_factory=lambda:[42],min_length=1,max_length=3)

class Submission(GenerationPayload):
    client_request_id:str=Field(min_length=1,max_length=100,pattern=r'^[A-Za-z0-9_-]+$')
    confirmed_request_hash:str=Field(min_length=64,max_length=64)
    consent_id:str|None=None

@router.post('/api/generation-preflight')
def preflight(payload:GenerationPayload,request:Request):
    return request.app.state.generation.preflight(payload.model_dump(mode='json'))

@router.post('/api/generation-requests')
def submit(payload:Submission,request:Request,response:Response):
    status=request.app.state.credential_store.status()
    if not status.api_key_configured or not status.workspace_configured:
        raise DomainError('CREDENTIALS_REQUIRED','请先在设置中配置 API Key 和业务空间 ID。')
    result,created=request.app.state.generation.submit(payload.model_dump(mode='json'))
    response.status_code=201 if created else 200
    return result

@router.get('/api/generation-requests/{request_id}')
def get(request_id:str,request:Request):
    return request.app.state.generation.get(request_id)
