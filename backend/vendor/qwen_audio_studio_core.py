#!/usr/bin/env python3
"""Generate complete audio with Alibaba Cloud qwen-audio-3.1-tts-next."""

from __future__ import annotations

import argparse
import importlib.util
import base64
from datetime import datetime
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Optional


MODEL_ID = "qwen-audio-3.1-tts-next"
ALLOWED_FORMATS = {"wav", "mp3", "pcm"}
ALLOWED_SAMPLE_RATES = {8000, 16000, 24000, 44100, 48000}
REFERENCE_MIME_TYPES = {
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
}
MODE_GUIDANCE = {
    "narration": "创作一段以清晰人声为核心的叙事音频。",
    "advertisement": "创作一段商业广告音频，人声清晰，音效和配乐服务于信息表达。",
    "podcast": "创作一段自然播客，保持说话人一致、声场连续和真实对话节奏。",
    "drama": "创作一段广播剧，保持角色音色一致，按剧情顺序安排台词、环境和动作音效。",
    "auto": "根据以下要求创作完整音频。",
}


class ConfigError(ValueError):
    """Raised when local inputs cannot form a valid API request."""


class ApiError(RuntimeError):
    """Raised when the remote service rejects or cannot complete a request."""


class ValidationError(RuntimeError):
    """Raised when downloaded audio cannot be validated."""


def build_endpoint(workspace_id: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9-]+", workspace_id or ""):
        raise ConfigError("invalid SFM_WORKSPACE_ID")
    return (
        f"https://{workspace_id}.cn-beijing.maas.aliyuncs.com"
        "/api/v1/services/audio/tts/SpeechSynthesizer"
    )


def redact(value: Any, secrets: Iterable[str]) -> Any:
    secret_values = [secret for secret in secrets if secret]
    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            if key == "audio_data":
                result[key] = "<redacted audio data>"
            else:
                result[key] = redact(item, secret_values)
        return result
    if isinstance(value, list):
        return [redact(item, secret_values) for item in value]
    if isinstance(value, tuple):
        return tuple(redact(item, secret_values) for item in value)
    if isinstance(value, str):
        result = re.sub(
            r"(?i)(Authorization\s*:\s*Bearer\s+)[^\s,;]+",
            r"\1<redacted>",
            value,
        )
        result = re.sub(
            r"data:[A-Za-z0-9.+-]+/[A-Za-z0-9.+-]+;base64,"
            r"[A-Za-z0-9+/=_-]+",
            "<redacted audio data>",
            result,
        )
        result = re.sub(
            r'("audio_data"\s*:\s*")[^"]*(")',
            r'\1<redacted audio data>\2',
            result,
        )
        for secret in secret_values:
            result = result.replace(secret, "<redacted>")
        return result
    return value


def _safe_response_body(response, secrets: Iterable[str]) -> str:
    try:
        value = response.json()
    except Exception:
        value = response.text
    safe_value = redact(value, secrets)
    if isinstance(safe_value, str):
        return safe_value
    return json.dumps(safe_value, ensure_ascii=False)


def post_generation(
    session,
    endpoint: str,
    api_key: str,
    payload: Dict[str, Any],
    max_attempts: int = 3,
    sleeper=time.sleep,
    redact_secrets: Iterable[str] = (),
) -> Dict[str, Any]:
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    retryable = {429, 500, 502, 503, 504}
    sensitive_values = [api_key, *redact_secrets]
    for attempt in range(1, max_attempts + 1):
        try:
            response = session.post(
                endpoint,
                headers=headers,
                json=payload,
                timeout=300,
            )
        except Exception as exc:
            if attempt == max_attempts:
                raise ApiError(
                    f"request failed after {max_attempts} attempts: "
                    f"{redact(str(exc), sensitive_values)}"
                ) from exc
            sleeper(2 ** (attempt - 1))
            continue

        if response.status_code == 200:
            try:
                result = response.json()
            except Exception as exc:
                raise ApiError("HTTP 200 response is not valid JSON") from exc
            if not isinstance(result, dict):
                raise ApiError("HTTP 200 response must be a JSON object")
            output = result.get("output")
            audio = output.get("audio") if isinstance(output, dict) else None
            url = audio.get("url") if isinstance(audio, dict) else None
            if not isinstance(url, str) or not url.strip():
                request_id = redact(
                    str(result.get("request_id", "<missing request_id>")),
                    sensitive_values,
                )
                raise ApiError(
                    f"HTTP 200 response missing output.audio.url "
                    f"(request_id={request_id})"
                )
            return result

        safe_text = _safe_response_body(response, sensitive_values)
        if response.status_code not in retryable or attempt == max_attempts:
            raise ApiError(f"HTTP {response.status_code}: {safe_text}")
        sleeper(2 ** (attempt - 1))

    raise ApiError("generation request exhausted retries")


def download_audio(
    session,
    url: str,
    destination: Path,
    max_attempts: int = 3,
    validator=None,
    sleeper=time.sleep,
    redact_secrets: Iterable[str] = (),
) -> Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    part_path = destination.with_name(destination.name + ".part")
    retryable = {429, 500, 502, 503, 504}
    sensitive_values = list(redact_secrets)
    try:
        for attempt in range(1, max_attempts + 1):
            try:
                response = session.get(url, stream=True, timeout=120)
                if response.status_code == 200:
                    with part_path.open("wb") as handle:
                        for chunk in response.iter_content(chunk_size=65536):
                            if chunk:
                                handle.write(chunk)
                    if validator is not None:
                        validator(part_path)
                    part_path.replace(destination)
                    return destination

                safe_text = _safe_response_body(response, sensitive_values)
                if (
                    response.status_code not in retryable
                    or attempt == max_attempts
                ):
                    raise ApiError(
                        f"audio download HTTP {response.status_code}: {safe_text}"
                    )
            except ValidationError:
                raise
            except ApiError:
                raise
            except Exception as exc:
                if attempt == max_attempts:
                    safe_error = redact(str(exc), sensitive_values)
                    raise ApiError(
                        f"audio download failed after {max_attempts} attempts: "
                        f"{safe_error}"
                    ) from exc
            finally:
                if part_path.exists() and not destination.exists():
                    part_path.unlink()
            sleeper(2 ** (attempt - 1))
    finally:
        if part_path.exists():
            part_path.unlink()

    raise ApiError("audio download exhausted retries")


def validate_generation_options(
    prompt: str,
    output_format: str,
    sample_rate: int,
    channels: int,
    volume: int,
    rate: float,
    reference_count: int,
) -> None:
    if not prompt.strip():
        raise ConfigError("text_prompt must not be empty")
    if len(prompt) > 3000:
        raise ConfigError("text_prompt exceeds 3000 characters")
    if output_format not in ALLOWED_FORMATS:
        raise ConfigError("output format must be wav, mp3, or pcm")
    if sample_rate not in ALLOWED_SAMPLE_RATES:
        raise ConfigError("unsupported sample rate")
    if channels not in (1, 2):
        raise ConfigError("channels must be 1 or 2")
    if not 0 <= volume <= 100:
        raise ConfigError("volume must be between 0 and 100")
    if not 0.5 <= rate <= 2.0:
        raise ConfigError("rate must be between 0.5 and 2.0")
    if not 0 <= reference_count <= 3:
        raise ConfigError("reference audio count must be between 0 and 3")


def build_payload(
    prompt: str,
    references: List[Dict[str, str]],
    output_format: str,
    sample_rate: int,
    channels: int,
    volume: int,
    rate: float,
    seed: int,
    enable_cbr: bool,
    bit_rate: int,
    quality: int,
    enable_aigc_tag: bool,
) -> Dict[str, Any]:
    validate_generation_options(
        prompt,
        output_format,
        sample_rate,
        channels,
        volume,
        rate,
        len(references),
    )
    if not 0 <= quality <= 9:
        raise ConfigError("quality must be between 0 and 9")
    if bit_rate <= 0:
        raise ConfigError("bit_rate must be positive")

    return {
        "model": MODEL_ID,
        "input": {
            "text_prompt": prompt,
            "references": references,
            "format": output_format,
            "sample_rate": sample_rate,
            "channels": channels,
            "volume": volume,
            "rate": rate,
            "seed": seed,
            "enable_cbr": enable_cbr,
            "bit_rate": bit_rate,
            "quality": quality,
            "enable_aigc_tag": enable_aigc_tag,
        },
    }


def check_environment(
    environ: Mapping[str, str],
    which=shutil.which,
    requests_available: Optional[bool] = None,
) -> Dict[str, Dict[str, bool]]:
    if requests_available is None:
        requests_available = importlib.util.find_spec("requests") is not None
    return {
        "python": {"ok": sys.version_info >= (3, 9)},
        "requests": {"ok": bool(requests_available)},
        "ffmpeg": {"ok": which("ffmpeg") is not None},
        "ffprobe": {"ok": which("ffprobe") is not None},
        "DASHSCOPE_API_KEY": {
            "configured": bool(environ.get("DASHSCOPE_API_KEY"))
        },
        "SFM_WORKSPACE_ID": {
            "configured": bool(environ.get("SFM_WORKSPACE_ID"))
        },
    }


def validate_voice_references(prompt: str, reference_count: int) -> None:
    for match in re.finditer(r"@voice(\d+)", prompt):
        number = int(match.group(1))
        if number < 1 or number > reference_count:
            raise ConfigError(
                f"{match.group(0)} references missing audio; "
                f"only {reference_count} reference file(s) were provided"
            )


def compile_prompt(mode: str, source_text: str, reference_count: int) -> str:
    if mode not in MODE_GUIDANCE:
        raise ConfigError(f"unsupported mode: {mode}")
    if not source_text.strip():
        raise ConfigError("prompt source must not be empty")
    if not 0 <= reference_count <= 3:
        raise ConfigError("reference audio count must be between 0 and 3")

    parts = [MODE_GUIDANCE[mode], "\n内容与台词：\n", source_text.strip()]
    if reference_count:
        parts.extend(
            [
                "\n参考音色：",
                f"按 @voice1 到 @voice{reference_count} 的编号使用参考音频。",
            ]
        )
    result = "".join(parts)
    validate_voice_references(result, reference_count)
    if len(result) > 3000:
        raise ConfigError("compiled text_prompt exceeds 3000 characters")
    return result


def validate_reference_paths(paths: List[Path]) -> None:
    if len(paths) > 3:
        raise ConfigError("at most 3 reference audio files are supported")
    for path in paths:
        if path.suffix.lower() not in REFERENCE_MIME_TYPES:
            raise ConfigError(
                f"unsupported reference audio format: {path.suffix or '<none>'}"
            )


def run_ffprobe(path: Path) -> Dict[str, Any]:
    completed = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration,format_name:stream=codec_name,sample_rate,channels",
            "-of",
            "json",
            str(path),
        ],
        text=True,
        capture_output=True,
    )
    if completed.returncode != 0:
        raise ConfigError(
            f"ffprobe could not read reference audio {path}: "
            f"{completed.stderr.strip()}"
        )
    try:
        return json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise ConfigError(f"ffprobe returned invalid JSON for {path}") from exc


def inspect_reference_audio(path: Path) -> Dict[str, Any]:
    if not path.is_file():
        raise ConfigError(f"reference audio not found: {path}")
    if path.stat().st_size > 10 * 1024 * 1024:
        raise ConfigError(f"reference audio exceeds 10 MB: {path}")
    if path.suffix.lower() not in REFERENCE_MIME_TYPES:
        raise ConfigError(f"unsupported reference audio format: {path.suffix}")

    metadata = run_ffprobe(path)
    try:
        duration = float(metadata["format"]["duration"])
    except (KeyError, TypeError, ValueError) as exc:
        raise ConfigError(f"reference audio duration unavailable: {path}") from exc
    if duration > 30.0:
        raise ConfigError(f"reference audio exceeds 30 seconds: {path}")
    if duration <= 0:
        raise ConfigError(f"reference audio has no positive duration: {path}")

    codecs = {
        stream.get("codec_name") for stream in metadata.get("streams", [])
    }
    if path.suffix.lower() == ".ogg" and "opus" not in codecs:
        raise ConfigError(f"reference OGG must use OGG Opus: {path}")
    return metadata


def encode_reference(path: Path) -> Dict[str, str]:
    inspect_reference_audio(path)
    mime_type = REFERENCE_MIME_TYPES[path.suffix.lower()]
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return {"audio_data": f"data:{mime_type};base64,{encoded}"}


def probe_audio(
    path: Path,
    output_format: Optional[str] = None,
    sample_rate: int = 48000,
    channels: int = 2,
) -> Dict[str, Any]:
    command = [
        "ffprobe",
        "-v",
        "error",
    ]
    effective_format = output_format or path.suffix.lower().lstrip(".")
    if effective_format == "pcm":
        command.extend(
            ["-f", "s16le", "-ar", str(sample_rate), "-ac", str(channels)]
        )
    command.extend(
        [
            "-show_entries",
            (
                "format=duration,size,format_name:"
                "stream=codec_name,sample_rate,channels"
            ),
            "-of",
            "json",
            str(path),
        ]
    )
    completed = subprocess.run(command, text=True, capture_output=True)
    if completed.returncode != 0:
        raise ValidationError(
            f"ffprobe failed for generated audio: {completed.stderr.strip()}"
        )
    try:
        metadata = json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise ValidationError("ffprobe returned invalid JSON") from exc
    try:
        duration = float(metadata["format"]["duration"])
        size = int(metadata["format"]["size"])
    except (KeyError, TypeError, ValueError) as exc:
        raise ValidationError("ffprobe did not return duration and size") from exc
    if duration <= 0 or size <= 0:
        raise ValidationError("generated audio has no positive duration or size")
    return metadata


def decode_audio(
    path: Path,
    output_format: Optional[str] = None,
    sample_rate: int = 48000,
    channels: int = 2,
) -> None:
    command = ["ffmpeg", "-v", "error"]
    effective_format = output_format or path.suffix.lower().lstrip(".")
    if effective_format == "pcm":
        command.extend(
            ["-f", "s16le", "-ar", str(sample_rate), "-ac", str(channels)]
        )
    command.extend(["-i", str(path), "-f", "null", "-"])
    completed = subprocess.run(command, text=True, capture_output=True)
    if completed.returncode != 0:
        raise ValidationError(
            f"ffmpeg decode failed: {completed.stderr.strip()}"
        )


def validate_generated_audio(
    path: Path,
    output_format: Optional[str] = None,
    sample_rate: int = 48000,
    channels: int = 2,
) -> Dict[str, Any]:
    metadata = probe_audio(path, output_format, sample_rate, channels)
    decode_audio(path, output_format, sample_rate, channels)
    streams = metadata.get("streams", [])
    if not streams:
        raise ValidationError("ffprobe did not return an audio stream")
    try:
        actual_sample_rate = int(streams[0]["sample_rate"])
        actual_channels = int(streams[0]["channels"])
    except (KeyError, TypeError, ValueError) as exc:
        raise ValidationError(
            "ffprobe did not return sample rate and channel count"
        ) from exc
    if actual_sample_rate != sample_rate:
        raise ValidationError(
            f"generated sample rate mismatch: expected {sample_rate}, got {actual_sample_rate}"
        )
    if actual_channels != channels:
        raise ValidationError(
            f"generated channel mismatch: expected {channels}, got {actual_channels}"
        )
    return metadata


def write_report(
    output_dir: Path,
    report: Dict[str, Any],
    secrets: Iterable[str],
) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    safe_report = redact(report, secrets)
    json_path = output_dir / "generation-report.json"
    markdown_path = output_dir / "generation-report.md"
    json_path.write_text(
        json.dumps(safe_report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    request_id = safe_report.get("request_id", "unknown")
    model = safe_report.get("model", MODEL_ID)
    output_file = safe_report.get("output_file", "unknown")
    duration = safe_report.get("duration_seconds", "unknown")
    validation = safe_report.get("validation", {})
    status = safe_report.get("status", "unknown")
    error = safe_report.get("error")
    markdown = (
        "# Qwen Audio Next generation report\n\n"
        f"- Status: `{status}`\n"
        f"- Model: `{model}`\n"
        f"- Request ID: `{request_id}`\n"
        f"- Output file: `{output_file}`\n"
        f"- Duration: `{duration}` seconds\n"
        f"- ffprobe: `{validation.get('ffprobe', 'unknown')}`\n"
        f"- ffmpeg decode: `{validation.get('ffmpeg', 'unknown')}`\n"
    )
    if error:
        markdown += f"- Error: `{error}`\n"
    markdown_path.write_text(markdown, encoding="utf-8")
    return json_path, markdown_path


def _read_source_text(args) -> str:
    if getattr(args, "prompt_file", None):
        return Path(args.prompt_file).read_text(encoding="utf-8")
    return args.prompt


def run_doctor() -> int:
    status = check_environment(os.environ)
    checks = [
        ("Python 3.9+", status["python"]["ok"]),
        ("requests", status["requests"]["ok"]),
        ("ffmpeg", status["ffmpeg"]["ok"]),
        ("ffprobe", status["ffprobe"]["ok"]),
        (
            "DASHSCOPE_API_KEY",
            status["DASHSCOPE_API_KEY"]["configured"],
        ),
        (
            "SFM_WORKSPACE_ID",
            status["SFM_WORKSPACE_ID"]["configured"],
        ),
    ]
    for name, ok in checks:
        print(f"{name}: {'已设置' if ok else '未设置'}")
    return 0 if all(ok for _, ok in checks) else 1


def run_compile(args) -> int:
    source_text = _read_source_text(args)
    prompt = compile_prompt(args.mode, source_text, args.reference_count)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(prompt + "\n", encoding="utf-8")
    print(f"Prompt saved: {output}")
    return 0


def run_generate(args) -> int:
    api_key = os.environ.get("DASHSCOPE_API_KEY", "")
    workspace_id = os.environ.get("SFM_WORKSPACE_ID", "")
    if not api_key:
        raise ConfigError(
            "DASHSCOPE_API_KEY is not configured; read references/setup.md"
        )
    if not workspace_id:
        raise ConfigError(
            "SFM_WORKSPACE_ID is not configured; read references/setup.md"
        )
    if importlib.util.find_spec("requests") is None:
        raise ConfigError("requests is not installed; run: python3 -m pip install requests")
    import requests

    reference_paths = [Path(value) for value in args.reference_audio]
    validate_reference_paths(reference_paths)
    references = [encode_reference(path) for path in reference_paths]
    source_text = _read_source_text(args)
    prompt = compile_prompt(args.mode, source_text, len(reference_paths))
    validate_voice_references(prompt, len(reference_paths))
    payload = build_payload(
        prompt=prompt,
        references=references,
        output_format=args.format,
        sample_rate=args.sample_rate,
        channels=args.channels,
        volume=args.volume,
        rate=args.rate,
        seed=args.seed,
        enable_cbr=args.enable_cbr,
        bit_rate=args.bit_rate,
        quality=args.quality,
        enable_aigc_tag=args.enable_aigc_tag,
    )
    endpoint = build_endpoint(workspace_id)
    session = requests.Session()
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    report = {
        "status": "starting",
        "model": MODEL_ID,
        "request_id": "unavailable",
        "request": payload,
        "validation": {"ffprobe": "not run", "ffmpeg": "not run"},
    }
    sensitive_values = [api_key, workspace_id]
    write_report(output_dir, report, sensitive_values)

    try:
        result = post_generation(
            session,
            endpoint,
            api_key,
            payload,
            redact_secrets=[workspace_id],
        )
        report["request_id"] = result.get("request_id", "unknown")

        output_name = args.output_name or (
            datetime.now().strftime("%Y%m%d-%H%M%S") + f"-{args.mode}"
        )
        if not re.fullmatch(r"[A-Za-z0-9._\-\u4e00-\u9fff]+", output_name):
            raise ConfigError(
                "output name may contain letters, numbers, Chinese, dot, "
                "underscore, and hyphen"
            )
        audio_path = output_dir / f"{output_name}.{args.format}"
        prompt_path = output_dir / f"{output_name}-prompt.txt"
        prompt_path.write_text(prompt + "\n", encoding="utf-8")

        metadata_holder: Dict[str, Any] = {}

        def validator(part_path: Path) -> None:
            metadata_holder.update(
                validate_generated_audio(
                    part_path,
                    output_format=args.format,
                    sample_rate=args.sample_rate,
                    channels=args.channels,
                )
            )

        audio = result["output"]["audio"]
        download_audio(
            session,
            audio["url"],
            audio_path,
            validator=validator,
            redact_secrets=sensitive_values,
        )
        metadata = metadata_holder or validate_generated_audio(
            audio_path,
            output_format=args.format,
            sample_rate=args.sample_rate,
            channels=args.channels,
        )
        duration = float(metadata["format"]["duration"])
        report.update(
            {
                "status": "success",
                "output_file": audio_path.name,
                "prompt_file": prompt_path.name,
                "duration_seconds": duration,
                "response": {
                    "finish_reason": result["output"].get("finish_reason"),
                    "audio": {
                        "id": audio.get("id"),
                        "duration": audio.get("duration"),
                        "expires_at": audio.get("expires_at"),
                    },
                },
                "validation": {"ffprobe": "pass", "ffmpeg": "pass"},
            }
        )
    except (ConfigError, ApiError, ValidationError, OSError) as exc:
        report["status"] = "failed"
        report["error"] = redact(str(exc), sensitive_values)
        write_report(output_dir, report, sensitive_values)
        raise

    write_report(output_dir, report, sensitive_values)
    print(f"Audio saved: {audio_path}")
    print(f"Report saved: {output_dir / 'generation-report.md'}")
    return 0


def _add_prompt_source(parser) -> None:
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--prompt", help="Audio description or script")
    group.add_argument("--prompt-file", help="UTF-8 text or Markdown file")


def parse_args(argv=None):
    parser = argparse.ArgumentParser(
        description="Generate complete audio with qwen-audio-3.1-tts-next."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser(
        "doctor", help="Check local dependencies and credential variables"
    )

    compile_parser = subparsers.add_parser(
        "compile", help="Compile a structured prompt without calling the API"
    )
    _add_prompt_source(compile_parser)
    compile_parser.add_argument(
        "--mode",
        choices=sorted(MODE_GUIDANCE),
        default="auto",
    )
    compile_parser.add_argument("--reference-count", type=int, default=0)
    compile_parser.add_argument("--output", required=True)

    generate_parser = subparsers.add_parser(
        "generate", help="Generate, download, and validate audio"
    )
    _add_prompt_source(generate_parser)
    generate_parser.add_argument(
        "--mode",
        choices=sorted(MODE_GUIDANCE),
        default="auto",
    )
    generate_parser.add_argument(
        "--reference-audio",
        action="append",
        default=[],
        help="Reference WAV, MP3, or OGG Opus; repeat up to three times",
    )
    generate_parser.add_argument(
        "--format", choices=sorted(ALLOWED_FORMATS), default="wav"
    )
    generate_parser.add_argument(
        "--sample-rate",
        type=int,
        choices=sorted(ALLOWED_SAMPLE_RATES),
        default=48000,
    )
    generate_parser.add_argument("--channels", type=int, choices=[1, 2], default=2)
    generate_parser.add_argument("--volume", type=int, default=50)
    generate_parser.add_argument("--rate", type=float, default=1.0)
    generate_parser.add_argument("--seed", type=int, default=42)
    generate_parser.add_argument("--enable-cbr", action="store_true")
    generate_parser.add_argument("--bit-rate", type=int, default=128)
    generate_parser.add_argument("--quality", type=int, default=5)
    generate_parser.add_argument("--enable-aigc-tag", action="store_true")
    generate_parser.add_argument("--output-name")
    generate_parser.add_argument(
        "--output-dir",
        default="Video/音频素材/Qwen-Audio-Next",
    )
    return parser.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)
    try:
        if args.command == "doctor":
            return run_doctor()
        if args.command == "compile":
            return run_compile(args)
        if args.command == "generate":
            return run_generate(args)
        raise ConfigError(f"unsupported command: {args.command}")
    except (ConfigError, ApiError, ValidationError, OSError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
