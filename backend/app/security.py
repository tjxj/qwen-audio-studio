from __future__ import annotations

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from urllib.parse import urlsplit


ALLOWED_HOSTS = {"127.0.0.1", "localhost", "testserver"}
MUTATING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


class LocalSecurityMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, csrf_token: str):
        super().__init__(app)
        self.csrf_token = csrf_token

    async def dispatch(self, request: Request, call_next):
        host = request.headers.get("host", "").split(":", 1)[0].lower()
        if host not in ALLOWED_HOSTS:
            return JSONResponse(
                status_code=400, content={"detail": "Local host required"}
            )
        if request.method in MUTATING_METHODS and request.url.path.startswith('/api/'):
            origin=request.headers.get('origin')
            if origin:
                parsed=urlsplit(origin)
                if parsed.scheme not in {'http','https'} or parsed.netloc.lower()!=request.headers.get('host','').lower():
                    return JSONResponse(status_code=403,content={'error':{'code':'ORIGIN_REJECTED','message':'只允许本机同源操作。','retryable':False}})
        if (
            request.url.path.startswith("/api/")
            and request.method in MUTATING_METHODS
            and request.headers.get("X-Qwen-Studio-CSRF") != self.csrf_token
        ):
            return JSONResponse(
                status_code=403, content={"detail": "Invalid CSRF token"}
            )
        response = await call_next(request)
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; img-src 'self' data:; media-src 'self'; "
            "style-src 'self' 'unsafe-inline'; script-src 'self'; "
            "connect-src 'self'; object-src 'none'; frame-ancestors 'none'"
        )
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Frame-Options"] = "DENY"
        return response
