from __future__ import annotations

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from pydantic import BaseModel, ConfigDict, Field


router = APIRouter()


@router.post("/api/references/prepare", status_code=201)
def prepare_reference(
    request: Request, file: UploadFile = File(...)
):
    try:
        record = request.app.state.reference_registry.prepare(
            file.filename or "reference", file.file
        )
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {
        "id": record.id,
        "name": record.name,
        "consent_token": record.consent_token,
        "uploaded": False,
        **record.metadata,
    }


@router.delete("/api/references/{reference_id}", status_code=204)
def delete_reference(reference_id: str, request: Request):
    if reference_id in request.app.state.reference_registry.records:
        request.app.state.reference_registry.cleanup(reference_id)
    else:
        request.app.state.references.delete(reference_id)


class TrimPayload(BaseModel):
    model_config=ConfigDict(extra='forbid')
    start_seconds:float=Field(ge=0)
    end_seconds:float=Field(gt=0)
    name:str=Field(default='我的声音',min_length=1,max_length=120)
    persistent:bool=False

class ReferencePatch(BaseModel):
    model_config=ConfigDict(extra='forbid')
    name:str|None=Field(default=None,min_length=1,max_length=120)
    persistent:bool|None=None

class ConsentPayload(BaseModel):
    project_id:str
    reference_ids:list[str]=Field(min_length=1,max_length=3)
    confirmed:bool

@router.post('/api/reference-imports',status_code=201)
def import_audio(request:Request,file:UploadFile=File(...)):
    return request.app.state.references.import_audio(file.filename or 'audio.wav',file.file)

@router.post('/api/reference-imports/{import_id}/prepare',status_code=201)
def trim(import_id:str,payload:TrimPayload,request:Request):
    return request.app.state.references.prepare(import_id,**payload.model_dump())

@router.delete('/api/reference-imports/{import_id}',status_code=204)
def delete_import(import_id:str,request:Request):
    request.app.state.references.delete_import(import_id)

@router.get('/api/references')
def voices(request:Request,persistent:bool=True,q:str=''):
    return request.app.state.references.list(persistent,q)

@router.get('/api/references/{reference_id}')
def get_voice(reference_id:str,request:Request):
    return request.app.state.references.get(reference_id)

@router.patch('/api/references/{reference_id}')
def edit_voice(reference_id:str,payload:ReferencePatch,request:Request):
    return request.app.state.references.update(reference_id,**payload.model_dump(exclude_none=True))

@router.post('/api/reference-consents',status_code=201)
def consent(payload:ConsentPayload,request:Request):
    return request.app.state.references.consent(**payload.model_dump())

@router.get('/api/storage/usage')
def usage(request:Request):
    with request.app.state.studio._connect() as db:
        rows=db.execute('SELECT kind,SUM(bytes) AS total FROM assets WHERE deleted_at IS NULL GROUP BY kind').fetchall()
    sizes={row['kind']:row['total'] for row in rows}
    return {'generated_bytes':sizes.get('generated_audio',0),'reference_bytes':sizes.get('reference',0),
            'cache_bytes':sizes.get('reference_import',0)}

@router.post('/api/storage/cleanup-cache')
def cleanup(request:Request):
    return request.app.state.references.cleanup_expired(all_unused=True)
