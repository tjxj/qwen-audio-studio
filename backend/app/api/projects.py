from fastapi import APIRouter, HTTPException, Request

from app.models import ProjectCreate


router = APIRouter()


@router.get("/api/projects")
def list_projects(request: Request):
    return request.app.state.project_store.list()


@router.post("/api/projects", status_code=201)
def create_project(payload: ProjectCreate, request: Request):
    return request.app.state.project_store.create(payload)


@router.get("/api/projects/{project_id}")
def get_project(project_id: str, request: Request):
    try:
        return request.app.state.project_store.get(project_id)
    except (KeyError, ValueError) as exc:
        raise HTTPException(status_code=404, detail="Project not found") from exc


@router.patch("/api/projects/{project_id}")
def update_project(project_id: str, changes: dict, request: Request):
    try:
        return request.app.state.project_store.update(project_id, changes)
    except (KeyError, ValueError) as exc:
        raise HTTPException(status_code=404, detail="Project not found") from exc


@router.post("/api/projects/{project_id}/archive")
def archive_project(project_id: str, request: Request):
    try:
        return request.app.state.project_store.archive(project_id)
    except (KeyError, ValueError) as exc:
        raise HTTPException(status_code=404, detail="Project not found") from exc
