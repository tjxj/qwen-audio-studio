from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


CreationMode = Literal[
    "podcast",
    "advertisement",
    "audiobook",
    "drama",
    "game",
    "narration",
    "auto",
]
JobStatus = Literal[
    "queued", "running", "success", "failed", "cancelled", "interrupted"
]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class GenerationParams(BaseModel):
    format: Literal["wav", "mp3", "pcm"] = "wav"
    sample_rate: Literal[8000, 16000, 24000, 44100, 48000] = 48000
    channels: Literal[1, 2] = 2
    volume: int = Field(default=50, ge=0, le=100)
    rate: float = Field(default=1.0, ge=0.5, le=2.0)
    seed: int = 42
    enable_cbr: bool = False
    bit_rate: int = Field(default=128, gt=0, le=510)
    quality: int = Field(default=5, ge=0, le=9)
    enable_aigc_tag: bool = False


class ReferenceConsent(BaseModel):
    id: str
    consent_token: str


class ReferenceBinding(BaseModel):
    reference_id: str
    alias: str = ""


class TemplateApplication(BaseModel):
    template_id: str
    template_version: int = Field(ge=1)
    values: dict[str, str | int | float] = Field(default_factory=dict)


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    mode: CreationMode
    prompt: str = Field(default="", max_length=3000)
    params: GenerationParams = Field(default_factory=GenerationParams)
    reference_bindings: list[ReferenceBinding] = Field(default_factory=list, max_length=3)
    output_directory_id: Optional[str] = None
    template_application: Optional[TemplateApplication] = None


class ProjectRecord(ProjectCreate):
    id: str
    created_at: str
    updated_at: str
    archived: bool = False
    final_job_id: Optional[str] = None


class ProjectDraft(ProjectRecord):
    revision: int = Field(default=1, ge=1)


class ProjectPatch(BaseModel):
    """Whitelisted draft edits; ``expected_revision`` drives optimistic locking."""

    model_config = ConfigDict(extra="forbid")

    expected_revision: int = Field(ge=1)
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    mode: Optional[CreationMode] = None
    prompt: Optional[str] = Field(default=None, max_length=3000)
    params: Optional[GenerationParams] = None
    reference_bindings: Optional[list[ReferenceBinding]] = Field(
        default=None, max_length=3
    )
    output_directory_id: Optional[str] = None
    template_application: Optional[TemplateApplication] = None
    archived: Optional[bool] = None


class ProjectDuplicate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Optional[str] = Field(default=None, min_length=1, max_length=120)


class ProjectArchive(BaseModel):
    model_config = ConfigDict(extra="forbid")

    archived: bool


class ProjectFinalVersion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    job_id: str


class JobCreate(BaseModel):
    project_id: str
    project_name: str = Field(min_length=1, max_length=120)
    mode: CreationMode
    prompt: str = Field(min_length=1, max_length=3000)
    params: GenerationParams = Field(default_factory=GenerationParams)
    references: list[ReferenceConsent] = Field(default_factory=list, max_length=3)


class JobRecord(JobCreate):
    id: str
    status: JobStatus
    created_at: str
    updated_at: str
    elapsed_seconds: Optional[float] = None
    output_asset_id: Optional[str] = None
    error: Optional[str] = None
    report: Optional[dict[str, Any]] = None
