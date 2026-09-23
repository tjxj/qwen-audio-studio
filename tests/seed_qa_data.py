#!/usr/bin/env python3
"""Create deterministic local-only UI fixtures; never calls an external API."""

from __future__ import annotations

import argparse
import hashlib
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.models import GenerationParams, JobCreate, ProjectCreate  # noqa: E402
from app.services.storage import AssetRegistry, JobStore, ProjectStore  # noqa: E402


PROMPT = """【角色：旁白（温暖、克制）】
【音效：雨滴落在窗边，远处有轻微车流】
【对白：旁白】每一段声音，都值得被认真设计。
【音乐：极简钢琴与柔和氛围垫底】"""


def create_audio(path: Path, frequency: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", f"sine=frequency={frequency}:duration=8",
            "-f", "lavfi", "-i", "anoisesrc=color=pink:duration=8:amplitude=0.015",
            "-filter_complex", "[0:a][1:a]amix=inputs=2:duration=shortest",
            "-ar", "48000", "-ac", "2", str(path),
        ],
        check=True,
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("data_root", type=Path)
    args = parser.parse_args()
    root = args.data_root.resolve()
    projects = ProjectStore(root / "projects")
    jobs = JobStore(root / "jobs")
    assets = AssetRegistry(root / "assets.json")
    params = GenerationParams(format="wav", sample_rate=48000, channels=2)
    project = projects.create(ProjectCreate(
        name="Qwen Audio Studio · 雨夜声景",
        mode="podcast",
        prompt=PROMPT,
        params=params,
    ))
    created_jobs = []
    for index, (seed, frequency) in enumerate(((42, 330), (87, 440))):
        output = root / "outputs" / f"qa-{index + 1}" / "preview.wav"
        create_audio(output, frequency)
        asset = assets.register(output, "audio/wav")
        digest = hashlib.sha256(output.read_bytes()).hexdigest()
        job = jobs.create(JobCreate(
            project_id=project.id,
            project_name=project.name,
            mode=project.mode,
            prompt=project.prompt,
            params=params.model_copy(update={"seed": seed}),
        ))
        job = jobs.update(job.id, {
            "status": "success",
            "elapsed_seconds": 12.4 + index,
            "output_asset_id": asset.id,
            "report": {
                "ffprobe": "pass",
                "ffmpeg": "pass",
                "request_id": f"qa-local-{index + 1}",
                "duration_seconds": 8.0,
                "sample_rate": 48000,
                "channels": 2,
                "bytes": output.stat().st_size,
                "sha256": digest,
            },
        })
        created_jobs.append(job)
    projects.update(project.id, {"final_job_id": created_jobs[0].id})
    print(created_jobs[0].id)


if __name__ == "__main__":
    main()
