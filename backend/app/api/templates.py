from typing import Any, Literal

from fastapi import APIRouter, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field, StrictBool

router = APIRouter()


class PreviewPayload(BaseModel):
    model_config = ConfigDict(extra='forbid')
    values: dict[str, Any] = Field(default_factory=dict)
    reference_bindings: list[dict[str, str]] = Field(default_factory=list, max_length=3)
    apply_params: StrictBool = False
    current_params: dict[str, Any] = Field(default_factory=dict)


class FavoritePayload(BaseModel):
    model_config = ConfigDict(extra='forbid')
    favorite: StrictBool


@router.get('/api/templates')
def list_templates(request: Request, mode: str | None = None, q: str = Query('', max_length=200),
                   favorite: bool | None = None, source: Literal['builtin', 'user'] | None = None,
                   page: int = Query(1, ge=1), page_size: int = Query(20, ge=20, le=50)):
    return request.app.state.template_service.list(mode=mode, q=q, favorite=favorite, source=source, page=page, page_size=page_size)


@router.get('/api/templates/{template_id}')
def get_template(template_id: str, request: Request):
    return request.app.state.template_service.get(template_id)


@router.post('/api/templates', status_code=201)
def create_template(payload: dict[str, Any], request: Request):
    return request.app.state.template_service.create(payload)


@router.patch('/api/templates/{template_id}')
def update_template(template_id: str, payload: dict[str, Any], request: Request):
    return request.app.state.template_service.update(template_id, payload)


@router.delete('/api/templates/{template_id}', status_code=204)
def delete_template(template_id: str, request: Request):
    request.app.state.template_service.delete(template_id)
    return Response(status_code=204)


@router.put('/api/templates/{template_id}/favorite')
def favorite_template(template_id: str, payload: FavoritePayload, request: Request):
    return request.app.state.template_service.set_favorite(template_id, payload.favorite)


@router.post('/api/templates/{template_id}/preview')
def preview_template(template_id: str, payload: PreviewPayload, request: Request):
    return request.app.state.template_service.preview(template_id, **payload.model_dump())
