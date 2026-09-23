from __future__ import annotations

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, Field

from app.services.keychain import Credentials


router = APIRouter()


class CredentialInput(BaseModel):
    api_key: str = Field(min_length=8, max_length=512)
    workspace_id: str = Field(min_length=4, max_length=256)


@router.put("/api/settings/credentials", status_code=204)
def save_credentials(payload: CredentialInput, request: Request):
    request.app.state.credential_store.set(
        Credentials(
            api_key=payload.api_key.strip(),
            workspace_id=payload.workspace_id.strip(),
        )
    )
    return Response(status_code=204)


@router.delete("/api/settings/credentials", status_code=204)
def clear_credentials(request: Request):
    request.app.state.credential_store.clear()
    return Response(status_code=204)
