from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, Field, model_validator

from app.errors import DomainError
from app.services.keychain import Credentials, KeychainWriteError
from app.services.preferences import PreferenceError
from app.services.studio_store import RevisionConflict


router = APIRouter()


class CredentialInput(BaseModel):
    api_key: str = Field(min_length=8, max_length=512)
    workspace_id: str = Field(min_length=4, max_length=256)


class CredentialPatch(BaseModel):
    model_config = {"extra": "forbid"}

    api_key: Optional[str] = Field(default=None, max_length=512)
    workspace_id: Optional[str] = Field(default=None, max_length=256)

    @model_validator(mode="after")
    def require_a_value(self) -> "CredentialPatch":
        # Blank means "leave this field alone"; clearing goes through DELETE.
        if not (self.api_key or "").strip() and not (self.workspace_id or "").strip():
            raise ValueError("至少填写一项需要更新的凭据")
        return self


class SettingsPatch(BaseModel):
    model_config = {"extra": "forbid"}

    expected_revision: int = Field(ge=1)
    default_params: Optional[dict] = None
    script_font: Optional[str] = None
    script_font_size: Optional[int] = None
    theme: Optional[str] = None
    max_workers: Optional[int] = None
    default_directory_id: Optional[str] = None


@router.get("/api/settings")
def read_settings(request: Request):
    return request.app.state.preferences.get()


@router.patch("/api/settings")
def patch_settings(payload: SettingsPatch, request: Request):
    changes = payload.model_dump(exclude_unset=True, exclude={"expected_revision"})
    try:
        return request.app.state.preferences.update(payload.expected_revision, changes)
    except PreferenceError as exc:
        raise DomainError(
            "INVALID_PARAMS", exc.message, status=422, field=exc.field
        ) from exc
    except RevisionConflict as exc:
        raise DomainError(
            "REVISION_CONFLICT",
            "设置已在别处修改，请刷新后再保存。",
            status=409,
            field="expected_revision",
            details={"current_revision": exc.current_revision},
        ) from exc


@router.get("/api/settings/credentials")
def read_credential_status(request: Request):
    return request.app.state.credential_store.status().model_dump()


@router.put("/api/settings/credentials", status_code=204)
def save_credentials(payload: CredentialInput, request: Request):
    """Legacy full replacement, kept so older callers keep working."""
    try:
        request.app.state.credential_store.replace(
            Credentials(
                api_key=payload.api_key.strip(),
                workspace_id=payload.workspace_id.strip(),
            )
        )
    except KeychainWriteError as exc:
        raise _keychain_error(exc) from exc
    except Exception as exc:
        raise _keychain_error(exc) from exc
    return Response(status_code=204)


@router.patch("/api/settings/credentials", status_code=204)
def patch_credentials(payload: CredentialPatch, request: Request):
    """Update one field at a time; a half-finished write is rolled back."""
    updates = {
        key: value
        for key, value in (
            ("api_key", payload.api_key),
            ("workspace_id", payload.workspace_id),
        )
        if value is not None and value.strip()
    }
    try:
        request.app.state.credential_store.update(**updates)
    except KeychainWriteError as exc:
        raise _keychain_error(exc) from exc
    except Exception as exc:
        raise _keychain_error(exc) from exc
    return Response(status_code=204)


@router.delete("/api/settings/credentials", status_code=204)
def delete_credentials(request: Request, scope: str = "all"):
    if scope not in {"all", "api_key", "workspace_id"}:
        raise DomainError(
            "INVALID_PARAMS", "未知的凭据范围。", status=422, field="scope"
        )
    try:
        if scope == "all":
            request.app.state.credential_store.clear()
        else:
            request.app.state.credential_store.clear_field(scope)
    except Exception as exc:
        raise _keychain_error(exc) from exc
    return Response(status_code=204)


def _keychain_error(exc: Exception) -> DomainError:
    # The message stays generic: never echo the stored value back to the browser.
    return DomainError(
        "KEYCHAIN_UNAVAILABLE",
        str(exc) or "钥匙串不可用，请解锁后重试。",
        status=503,
        retryable=True,
    )
