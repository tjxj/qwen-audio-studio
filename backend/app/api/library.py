import json
from typing import Literal

from fastapi import APIRouter, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field
from app.errors import DomainError

router=APIRouter()

class JobPatch(BaseModel):
    model_config=ConfigDict(extra='forbid')
    display_name: str | None = Field(default=None,min_length=1,max_length=120)
    favorite: bool | None = None
    note: str | None = Field(default=None,max_length=2000)

class TrashPayload(BaseModel):
    scope: Literal['record','record_and_files']='record'

@router.get('/api/library')
def library(request:Request,view:Literal['jobs','projects','trash']='jobs',q:str=Query('',max_length=200),
            mode:str|None=None,status:str|None=None,favorite:bool|None=None,project_id:str|None=None,
            date_from:str|None=Query(None,alias='from'),date_to:str|None=Query(None,alias='to'),
            page:int=Query(1,ge=1),page_size:int=Query(20,ge=20,le=50)):
    if page_size not in {20,50}:
        raise DomainError('INVALID_PARAMS','每页条数只支持 20 或 50。',status=422,field='page_size')
    return request.app.state.library.list(view,{'q':q,'mode':mode,'status':status,'favorite':favorite,
        'project_id':project_id,'from':date_from,'to':date_to},page,page_size)

@router.patch('/api/jobs/{job_id}')
def edit(job_id:str,payload:JobPatch,request:Request):
    request.app.state.library.job(job_id)
    request.app.state.studio.update_job(job_id,payload.model_dump(exclude_none=True))
    return request.app.state.library.job(job_id)

@router.post('/api/jobs/{job_id}/trash')
def trash(job_id:str,payload:TrashPayload,request:Request):
    return request.app.state.library.trash(job_id,payload.scope)

@router.post('/api/jobs/{job_id}/restore')
def restore(job_id:str,request:Request):
    return request.app.state.library.restore(job_id)

@router.get('/api/jobs/{job_id}/export-report')
def report(job_id:str,request:Request,format:Literal['json','md']='json'):
    job=request.app.state.library.job(job_id)
    # Allow-list fields; never export raw provider errors, local paths or consent.
    report=job.get('report') or {}
    safe_report={k:report[k] for k in ['status','model','duration_seconds','sample_rate','channels','format','bytes','sha256','ffprobe','ffmpeg'] if k in report}
    body={k:job[k] for k in ['id','display_name','mode','status','created_at','params','elapsed_seconds']}
    body['report']=safe_report
    text=json.dumps(body,ensure_ascii=False,indent=2)
    if format=='md':
        text='# 音频生成报告\n\n```json\n'+text+'\n```\n'
    return Response(text,media_type='text/markdown' if format=='md' else 'application/json',
        headers={'Content-Disposition':f'attachment; filename="{job_id}-report.{format}"'})
