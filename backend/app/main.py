from __future__ import annotations

import secrets
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api.capabilities import router as capabilities_router
from app.api.diagnostics import router as diagnostics_router
from app.api.jobs import router as jobs_router
from app.api.media import router as media_router
from app.api.projects import router as projects_router
from app.api.references import router as references_router
from app.api.settings import router as settings_router
from app.config import AppConfig
from app.errors import install_error_handlers
from app.security import LocalSecurityMiddleware
from app.services.keychain import CredentialStore, SystemKeychainStore
from app.services.preferences import PreferenceService
from app.services.qwen_adapter import QwenAdapter
from app.services.references import ReferenceRegistry
from app.services.jobs import JobManager, SqliteJobStore
from app.services.studio_store import StudioStore


APP_VERSION = "2.0.0-dev"


def create_app(
    config: AppConfig | None = None,
    credential_store: CredentialStore | None = None,
    csrf_token: str | None = None,
    generation_worker=None,
    frontend_dist: Path | None = None,
    studio_store: StudioStore | None = None,
) -> FastAPI:
    resolved_config = config or AppConfig.from_environment()
    resolved_store = credential_store or SystemKeychainStore()
    resolved_csrf = csrf_token or secrets.token_urlsafe(32)
    @asynccontextmanager
    async def lifespan(application: FastAPI):
        yield
        application.state.job_manager.shutdown()
        application.state.reference_registry.cleanup_all()

    app = FastAPI(
        title="Qwen Audio Studio",
        docs_url=None,
        redoc_url=None,
        lifespan=lifespan,
    )
    app.state.config = resolved_config
    app.state.credential_store = resolved_store
    app.state.csrf_token = resolved_csrf
    app.state.qwen_adapter = QwenAdapter(resolved_config.skill_script)
    app.state.reference_registry = ReferenceRegistry(
        resolved_config.data_root / "cache" / "references",
        app.state.qwen_adapter,
    )
    studio = studio_store or StudioStore(resolved_config.data_root)
    studio.initialize()
    app.state.studio = studio
    app.state.preferences = PreferenceService(studio)
    app.state.project_store = studio
    app.state.job_store = SqliteJobStore(studio)

    def default_generation_worker(job):
        credentials = resolved_store.get()
        references = [
            app.state.reference_registry.require_consent(
                item.id, item.consent_token
            )
            for item in job.references
        ]
        result = app.state.qwen_adapter.generate(
            job,
            resolved_config.data_root / "outputs" / job.id,
            credentials,
            [item.path for item in references],
        )
        mime_type = {
            "wav": "audio/wav",
            "mp3": "audio/mpeg",
            "pcm": "application/octet-stream",
        }[job.params.format]
        asset = studio.register_asset(result["path"], mime_type, owner_id=job.id)
        for item in references:
            app.state.reference_registry.cleanup(item.id)
        return {
            "output_asset_id": asset["id"],
            "elapsed_seconds": result["elapsed_seconds"],
            "report": result["report"],
        }

    app.state.job_manager = JobManager(
        app.state.job_store,
        generation_worker or default_generation_worker,
        max_workers=2,
    )

    app.add_middleware(LocalSecurityMiddleware, csrf_token=resolved_csrf)
    install_error_handlers(app)

    @app.get("/api/health")
    def health():
        return {
            "status": "ok",
            "model": "qwen-audio-3.1-tts-next",
            "host": resolved_config.host,
        }

    @app.get("/api/session")
    def session(request: Request):
        return {
            "csrf_token": request.app.state.csrf_token,
            "app_version": APP_VERSION,
            "credentials": request.app.state.credential_store.status().model_dump(),
        }

    app.include_router(settings_router)
    app.include_router(diagnostics_router)
    app.include_router(capabilities_router)
    app.include_router(references_router)
    app.include_router(projects_router)
    app.include_router(jobs_router)
    app.include_router(media_router)
    resolved_dist = frontend_dist or (
        Path(__file__).resolve().parents[2] / "frontend" / "dist"
    )
    if resolved_dist.is_dir():
        assets = resolved_dist / "assets"
        if assets.is_dir():
            app.mount("/assets", StaticFiles(directory=assets), name="assets")

        @app.get("/{full_path:path}", include_in_schema=False)
        def serve_frontend(full_path: str):
            if full_path.startswith("api/"):
                raise HTTPException(status_code=404)
            candidate = (resolved_dist / full_path).resolve()
            if (
                full_path
                and resolved_dist.resolve() in candidate.parents
                and candidate.is_file()
            ):
                return FileResponse(candidate)
            return FileResponse(resolved_dist / "index.html")
    return app
