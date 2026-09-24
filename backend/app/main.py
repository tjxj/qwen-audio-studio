from __future__ import annotations

import secrets
import inspect
import json
import asyncio
import weakref
from contextlib import suppress
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
from app.services.directories import DirectoryService
from app.services.reference_preparation import ReferenceService
from app.services.library import LibraryService
from app.services.generation import GenerationService
from app.api.directories import router as directories_router
from app.api.library import router as library_router
from app.api.generation import router as generation_router
from app.api.templates import router as templates_router
from app.services.templates import TemplateService
from app.services.instance_lock import InstanceLock


APP_VERSION = "2.0.0-dev"


def create_app(
    config: AppConfig | None = None,
    credential_store: CredentialStore | None = None,
    csrf_token: str | None = None,
    generation_worker=None,
    frontend_dist: Path | None = None,
    studio_store: StudioStore | None = None,
) -> FastAPI:
    resolved = config or AppConfig.from_environment()
    ownership = InstanceLock(resolved.data_root)
    try:
        app = _create_app(resolved, credential_store, csrf_token, generation_worker, frontend_dist, studio_store)
        app.state.instance_lock = ownership
        weakref.finalize(app, ownership.release)
        return app
    except BaseException:
        ownership.release()
        raise


def _create_app(
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
        async def maintain_cache():
            while True:
                await asyncio.to_thread(application.state.references.cleanup_expired)
                await asyncio.sleep(300)
        maintenance=asyncio.create_task(maintain_cache())
        try:
            yield
        finally:
            maintenance.cancel()
            with suppress(asyncio.CancelledError):
                await maintenance
            application.state.job_manager.shutdown()
            application.state.reference_registry.cleanup_all()
            application.state.instance_lock.release()

    app = FastAPI(
        title="Qwen Audio Studio",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
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
    app.state.directories = DirectoryService(studio)
    app.state.references = ReferenceService(studio)
    app.state.library = LibraryService(studio)
    app.state.library.recover_operations()
    app.state.preferences = PreferenceService(studio)
    app.state.project_store = studio
    app.state.job_store = SqliteJobStore(studio)

    def default_generation_worker(job):
        credentials = resolved_store.get()
        snapshot=studio.get_job(job.id)
        is_v2=bool(snapshot['batch_id'])
        references = [] if is_v2 else [
            app.state.reference_registry.require_consent(
                item.id, item.consent_token
            )
            for item in job.references
        ]
        output_path=Path(snapshot['output_path_snapshot']) if snapshot['output_path_snapshot'] else None
        if output_path:
            app.state.directories.validate(snapshot['output_directory_id'])
        reference_paths=([app.state.references.path(item['reference_id']) for item in snapshot['reference_snapshot']]
            if is_v2 else [item.path for item in references])
        optional={}
        if 'stage_callback' in inspect.signature(app.state.qwen_adapter.generate).parameters:
            optional={'compiled_prompt':snapshot['compiled_prompt'] or None,
                'stage_callback':lambda stage:studio.update_job(job.id,{'stage':stage})}
        result = app.state.qwen_adapter.generate(
            job,
            output_path.parent if output_path else resolved_config.data_root / "outputs" / job.id,
            credentials,
            reference_paths,
            **optional,
        )
        if output_path:
            source=Path(result['path'])
            if source!=output_path:
                source.rename(output_path)
                result['path']=output_path
            (output_path.parent/'prompt.txt').write_text(snapshot['compiled_prompt'] or job.prompt,encoding='utf-8')
            (output_path.parent/'report.json').write_text(json.dumps(result['report'],ensure_ascii=False,indent=2),encoding='utf-8')
            (output_path.parent/'report.md').write_text('# 音频生成报告\n\n```json\n'+json.dumps(result['report'],ensure_ascii=False,indent=2)+'\n```\n',encoding='utf-8')
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
        max_workers=studio.settings()['max_workers'],
        on_finished=app.state.references.release,
    )
    app.state.generation=GenerationService(studio,app.state.qwen_adapter,app.state.directories,app.state.references,app.state.job_manager)
    app.state.template_service=TemplateService(studio,app.state.generation.compiler.compile)
    app.state.template_service.initialize()

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
    app.include_router(directories_router)
    app.include_router(library_router)
    app.include_router(generation_router)
    app.include_router(templates_router)
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
