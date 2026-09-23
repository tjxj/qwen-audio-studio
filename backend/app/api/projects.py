from __future__ import annotations

from fastapi import APIRouter, Request

from app.errors import DomainError
from app.models import (
    ProjectArchive,
    ProjectCreate,
    ProjectDuplicate,
    ProjectFinalVersion,
    ProjectPatch,
)
from app.services.studio_store import RevisionConflict, UnknownField


router = APIRouter()


def _store(request: Request):
    return request.app.state.studio


@router.get("/api/projects")
def list_projects(request: Request):
    return _store(request).list_projects()


@router.post("/api/projects", status_code=201)
def create_project(payload: ProjectCreate, request: Request):
    return _store(request).create_project(payload.model_dump(mode="json"))


@router.get("/api/projects/{project_id}")
def get_project(project_id: str, request: Request):
    try:
        return _store(request).get_project(project_id)
    except (KeyError, ValueError) as exc:
        raise _not_found("Project not found") from exc


@router.patch("/api/projects/{project_id}")
def update_project(project_id: str, payload: ProjectPatch, request: Request):
    changes = payload.model_dump(exclude_unset=True, exclude={"expected_revision"})
    try:
        return _store(request).save_project(
            project_id, payload.expected_revision, changes
        )
    except KeyError as exc:
        raise _not_found("Project not found") from exc
    except RevisionConflict as exc:
        raise DomainError(
            "REVISION_CONFLICT",
            "这个项目已在别处被修改，请先载入最新版本，或另存为副本。",
            status=409,
            field="expected_revision",
            retryable=False,
            details={"current_revision": exc.current_revision},
        ) from exc
    except UnknownField as exc:
        raise _invalid(str(exc), "prompt")


@router.post("/api/projects/{project_id}/duplicate", status_code=201)
def duplicate_project(
    project_id: str, payload: ProjectDuplicate, request: Request
):
    try:
        return _store(request).duplicate_project(project_id, payload.name)
    except KeyError as exc:
        raise _not_found("Project not found") from exc


@router.post("/api/projects/{project_id}/archive")
def archive_project(
    project_id: str, payload: ProjectArchive, request: Request
):
    try:
        return _store(request).set_archived(project_id, payload.archived)
    except KeyError as exc:
        raise _not_found("Project not found") from exc


@router.post("/api/projects/{project_id}/final-version")
def set_final_version(
    project_id: str, payload: ProjectFinalVersion, request: Request
):
    try:
        return _store(request).set_final_job(project_id, payload.job_id)
    except KeyError as exc:
        raise _not_found("Project not found") from exc
    except ValueError as exc:
        raise DomainError(
            "INVALID_FINAL_VERSION",
            str(exc),
            status=422,
            field="job_id",
        ) from exc


def _not_found(detail: str) -> DomainError:
    return DomainError("NOT_FOUND", detail, status=404)


def _invalid(detail: str, field: str) -> DomainError:
    return DomainError("INVALID_PARAMS", detail, status=422, field=field)
