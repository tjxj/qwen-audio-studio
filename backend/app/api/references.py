from __future__ import annotations

from fastapi import APIRouter, File, HTTPException, Request, UploadFile


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
    request.app.state.reference_registry.cleanup(reference_id)
