"""Unified error envelope shared by every API route.

``details`` carries only safe, structured context: never a credential, an absolute
personal path, an audio data URI or a raw provider response.
"""

from __future__ import annotations

from typing import Any, Optional

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse


class DomainError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        status: int = 409,
        field: Optional[str] = None,
        retryable: bool = False,
        details: Optional[dict[str, Any]] = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.field = field
        self.retryable = retryable
        self.details = details or {}


def error_body(
    code: str,
    message: str,
    *,
    field: Optional[str] = None,
    retryable: bool = False,
    details: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    return {
        "error": {
            "code": code,
            "message": message,
            "field": field,
            "retryable": retryable,
            "details": details or {},
        }
    }


class CodedErrorHandler:
    pass


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(DomainError)
    def handle_domain_error(_: Request, exc: DomainError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status,
            content=error_body(
                exc.code,
                exc.message,
                field=exc.field,
                retryable=exc.retryable,
                details=exc.details,
            ),
        )
