import {
  DEFAULT_PARAMS,
  type CreateJobRequest,
  type Job,
  type PreparedReference,
  type Project
} from "./types";

let csrfToken = "";
let sessionRequest: Promise<Awaited<ReturnType<typeof getSession>>> | null = null;

async function parse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({detail: response.statusText}));
    throw new Error(body.detail || "请求失败");
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function getSession(): Promise<{
  csrf_token: string;
  credentials: {api_key_configured: boolean; workspace_configured: boolean};
}> {
  const session = await parse<{
    csrf_token: string;
    credentials: {api_key_configured: boolean; workspace_configured: boolean};
  }>(await fetch("/api/session"));
  csrfToken = session.csrf_token;
  return session;
}

async function ensureSession() {
  if (csrfToken) return;
  if (!sessionRequest) {
    sessionRequest = getSession().finally(() => {
      sessionRequest = null;
    });
  }
  await sessionRequest;
}

export function hasConfiguredCredentials(status: {
  api_key_configured: boolean;
  workspace_configured: boolean;
}) {
  return status.api_key_configured && status.workspace_configured;
}

export async function prepareReference(file: File): Promise<PreparedReference> {
  await ensureSession();
  const data = new FormData();
  data.append("file", file);
  return parse(
    await fetch("/api/references/prepare", {
      method: "POST",
      headers: {"X-Qwen-Studio-CSRF": csrfToken},
      body: data
    })
  );
}

export async function deleteReference(id: string): Promise<void> {
  await ensureSession();
  await parse(
    await fetch("/api/references/" + encodeURIComponent(id), {
      method: "DELETE",
      headers: {"X-Qwen-Studio-CSRF": csrfToken}
    })
  );
}

export async function createProject(input: {
  name: string;
  mode: string;
  prompt: string;
  params: unknown;
}) {
  await ensureSession();
  return parse<{id: string}>(
    await fetch("/api/projects", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Qwen-Studio-CSRF": csrfToken
      },
      body: JSON.stringify(input)
    })
  );
}

export async function getProject(id: string): Promise<Project> {
  const value = await parse<Record<string, any>>(await fetch("/api/projects/" + encodeURIComponent(id)));
  return mapProject(value);
}

export async function updateProject(id: string, input: {
  name: string;
  mode: string;
  prompt: string;
  params: unknown;
}): Promise<void> {
  await ensureSession();
  await parse(await fetch("/api/projects/" + encodeURIComponent(id), {
    method: "PATCH",
    headers: {"Content-Type": "application/json", "X-Qwen-Studio-CSRF": csrfToken},
    body: JSON.stringify(input)
  }));
}

export async function createJob(input: CreateJobRequest) {
  await ensureSession();
  return parse<{id: string}>(
    await fetch("/api/jobs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Qwen-Studio-CSRF": csrfToken
      },
      body: JSON.stringify(input)
    })
  );
}

export async function saveCredentials(apiKey: string, workspaceId: string) {
  await ensureSession();
  return parse<void>(
    await fetch("/api/settings/credentials", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Qwen-Studio-CSRF": csrfToken
      },
      body: JSON.stringify({api_key: apiKey, workspace_id: workspaceId})
    })
  );
}

export async function clearCredentials() {
  await ensureSession();
  return parse<void>(
    await fetch("/api/settings/credentials", {
      method: "DELETE",
      headers: {"X-Qwen-Studio-CSRF": csrfToken}
    })
  );
}

function mapParams(value: Record<string, unknown>) {
  return {
    ...DEFAULT_PARAMS,
    format: (value.format as typeof DEFAULT_PARAMS.format) || "wav",
    sampleRate: Number(value.sample_rate ?? 48000) as typeof DEFAULT_PARAMS.sampleRate,
    channels: Number(value.channels ?? 2) as 1 | 2,
    volume: Number(value.volume ?? 50),
    rate: Number(value.rate ?? 1),
    seed: Number(value.seed ?? 42),
    enableCbr: Boolean(value.enable_cbr),
    bitRate: Number(value.bit_rate ?? 128),
    quality: Number(value.quality ?? 5),
    enableAigcTag: Boolean(value.enable_aigc_tag)
  };
}

function mapJob(value: Record<string, any>): Job {
  const report = value.report
    ? {
        ffprobe: value.report.ffprobe,
        ffmpeg: value.report.ffmpeg,
        requestId: value.report.request_id,
        durationSeconds: value.report.duration_seconds,
        sampleRate: value.report.sample_rate,
        channels: value.report.channels,
        bytes: value.report.bytes,
        sha256: value.report.sha256
      }
    : undefined;
  return {
    id: value.id,
    projectId: value.project_id,
    projectName: value.project_name,
    mode: value.mode,
    prompt: value.prompt,
    params: mapParams(value.params || {}),
    status: value.status,
    createdAt: value.created_at,
    updatedAt: value.updated_at,
    elapsedSeconds: value.elapsed_seconds,
    outputAssetId: value.output_asset_id,
    error: value.error,
    report
  };
}

export async function getJob(id: string): Promise<Job> {
  return mapJob(await parse(await fetch("/api/jobs/" + encodeURIComponent(id))));
}

export async function listJobs(): Promise<Job[]> {
  const values = await parse<Array<Record<string, any>>>(await fetch("/api/jobs"));
  return values.map(mapJob);
}

export async function retryJob(id: string): Promise<Job> {
  await ensureSession();
  return mapJob(
    await parse(
      await fetch("/api/jobs/" + encodeURIComponent(id) + "/retry", {
        method: "POST",
        headers: {"X-Qwen-Studio-CSRF": csrfToken}
      })
    )
  );
}

function mapProject(value: Record<string, any>): Project {
  return {
    id: value.id,
    name: value.name,
    mode: value.mode,
    prompt: value.prompt,
    params: mapParams(value.params || {}),
    createdAt: value.created_at,
    updatedAt: value.updated_at,
    archived: Boolean(value.archived),
    finalJobId: value.final_job_id
  };
}

export async function listProjects(): Promise<Project[]> {
  const values = await parse<Array<Record<string, any>>>(await fetch("/api/projects"));
  return values.map(mapProject);
}

export async function setProjectFinalJob(projectId: string, jobId: string): Promise<void> {
  await ensureSession();
  await parse(
    await fetch("/api/projects/" + encodeURIComponent(projectId), {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-Qwen-Studio-CSRF": csrfToken
      },
      body: JSON.stringify({final_job_id: jobId})
    })
  );
}
