import {
  DEFAULT_PARAMS,
  type CreateJobRequest,
  type DraftFields,
  type Job,
  type PreparedReference,
  type Project,
  type ReferenceBinding,
  type TemplateApplication
} from "./types";

export class ApiError extends Error {
  code: string;
  status: number;
  field: string | null;
  details: Record<string, unknown>;

  constructor(
    message: string,
    options: {
      code?: string;
      status?: number;
      field?: string | null;
      details?: Record<string, unknown>;
    } = {}
  ) {
    super(message);
    this.name = "ApiError";
    this.code = options.code || "UNKNOWN";
    this.status = options.status || 0;
    this.field = options.field ?? null;
    this.details = options.details || {};
  }
}

let csrfToken = "";
let sessionRequest: Promise<Awaited<ReturnType<typeof getSession>>> | null = null;

function describeFastApiDetail(detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const first = detail[0] as {loc?: unknown[]; msg?: string} | undefined;
    const field = Array.isArray(first?.loc) ? String(first!.loc!.slice(-1)[0]) : "";
    return field ? `${field} 填写有误：${first?.msg || "请检查后重试"}` : "提交的内容有误，请检查后重试。";
  }
  return "请求失败";
}

async function parse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({detail: response.statusText}));
    const error = body?.error;
    if (error && typeof error === "object") {
      throw new ApiError(error.message || "请求失败", {
        code: error.code,
        status: response.status,
        field: error.field ?? null,
        details: error.details || {}
      });
    }
    throw new ApiError(describeFastApiDetail(body?.detail) || "请求失败", {
      code: response.status === 422 ? "INVALID_PARAMS" : "HTTP_ERROR",
      status: response.status
    });
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

export type ProjectPatch = Partial<DraftFields> & {name?: string; mode?: string};

function toServerDraft(input: ProjectPatch): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (input.name !== undefined) body.name = input.name;
  if (input.mode !== undefined) body.mode = input.mode;
  if (input.prompt !== undefined) body.prompt = input.prompt;
  if (input.params !== undefined) body.params = toServerParams(input.params);
  if (input.referenceBindings !== undefined) {
    body.reference_bindings = input.referenceBindings.map((item) => ({
      reference_id: item.referenceId,
      alias: item.alias
    }));
  }
  if (input.outputDirectoryId !== undefined) {
    body.output_directory_id = input.outputDirectoryId;
  }
  if (input.templateApplication !== undefined) {
    body.template_application = input.templateApplication
      ? {
          template_id: input.templateApplication.templateId,
          template_version: input.templateApplication.templateVersion,
          values: input.templateApplication.values
        }
      : null;
  }
  return body;
}

function toServerParams(params: DraftFields["params"]) {
  return {
    format: params.format,
    sample_rate: params.sampleRate,
    channels: params.channels,
    volume: params.volume,
    rate: params.rate,
    seed: params.seed,
    enable_cbr: params.enableCbr,
    bit_rate: params.bitRate,
    quality: params.quality,
    enable_aigc_tag: params.enableAigcTag
  };
}

export async function createProject(input: ProjectPatch): Promise<Project> {
  await ensureSession();
  return mapProject(
    await parse<Record<string, any>>(
      await fetch("/api/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Qwen-Studio-CSRF": csrfToken
        },
        body: JSON.stringify(toServerDraft(input))
      })
    )
  );
}

export async function getProject(id: string): Promise<Project> {
  const value = await parse<Record<string, any>>(
    await fetch("/api/projects/" + encodeURIComponent(id))
  );
  return mapProject(value);
}

export async function saveProject(
  id: string,
  expectedRevision: number,
  changes: ProjectPatch
): Promise<Project> {
  await ensureSession();
  return mapProject(
    await parse<Record<string, any>>(
      await fetch("/api/projects/" + encodeURIComponent(id), {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-Qwen-Studio-CSRF": csrfToken
        },
        body: JSON.stringify({
          ...toServerDraft(changes),
          expected_revision: expectedRevision
        })
      })
    )
  );
}

export async function duplicateProject(
  id: string,
  name?: string
): Promise<Project> {
  await ensureSession();
  return mapProject(
    await parse<Record<string, any>>(
      await fetch(
        `/api/projects/${encodeURIComponent(id)}/duplicate`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Qwen-Studio-CSRF": csrfToken
          },
          body: JSON.stringify(name ? {name} : {})
        }
      )
    )
  );
}

export async function archiveProject(
  id: string,
  archived: boolean
): Promise<Project> {
  await ensureSession();
  return mapProject(
    await parse<Record<string, any>>(
      await fetch(`/api/projects/${encodeURIComponent(id)}/archive`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Qwen-Studio-CSRF": csrfToken
        },
        body: JSON.stringify({archived})
      })
    )
  );
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

/** Empty fields are omitted: a blank input means "do not change this field". */
export async function patchCredentials(input: {
  apiKey?: string;
  workspaceId?: string;
}): Promise<void> {
  await ensureSession();
  const body: Record<string, string> = {};
  if (input.apiKey?.trim()) body.api_key = input.apiKey.trim();
  if (input.workspaceId?.trim()) body.workspace_id = input.workspaceId.trim();
  if (!Object.keys(body).length) {
    throw new ApiError("请先填写要更新的凭据。", {
      code: "INVALID_PARAMS",
      field: "api_key"
    });
  }
  await parse<void>(
    await fetch("/api/settings/credentials", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-Qwen-Studio-CSRF": csrfToken
      },
      body: JSON.stringify(body)
    })
  );
}

export async function deleteCredentials(
  scope: "all" | "api_key" | "workspace_id" = "all"
): Promise<void> {
  await ensureSession();
  await parse<void>(
    await fetch(
      "/api/settings/credentials?scope=" + encodeURIComponent(scope),
      {
        method: "DELETE",
        headers: {"X-Qwen-Studio-CSRF": csrfToken}
      }
    )
  );
}

export async function clearCredentials() {
  return deleteCredentials("all");
}

export interface SettingsPayload {
  revision: number;
  default_directory_id: string | null;
  default_params: Record<string, unknown>;
  script_font: string;
  script_font_size: number;
  max_workers: number;
}

export async function getSettings(): Promise<SettingsPayload> {
  return parse<SettingsPayload>(await fetch("/api/settings"));
}

export async function patchSettings(
  input: {expected_revision: number} & Record<string, unknown>
): Promise<SettingsPayload> {
  await ensureSession();
  return parse<SettingsPayload>(
    await fetch("/api/settings", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-Qwen-Studio-CSRF": csrfToken
      },
      body: JSON.stringify(input)
    })
  );
}

export interface Diagnostics {
  checked_at: string;
  tools: Record<string, {available: boolean; path: string | null; version: string | null}>;
  credentials: {api_key_configured: boolean; workspace_configured: boolean};
  storage: {data_root_writable: boolean; database_ready: boolean};
  model: {id: string; authorisation_checked: boolean};
  not_checked: string[];
  note: string;
}

export async function getDiagnostics(): Promise<Diagnostics> {
  return parse<Diagnostics>(await fetch("/api/diagnostics"));
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
    prompt: value.prompt ?? "",
    params: mapParams(value.params || {}),
    referenceBindings: (value.reference_bindings || []).map(
      (item: Record<string, unknown>): ReferenceBinding => ({
        referenceId: String(item.reference_id ?? ""),
        alias: String(item.alias ?? "")
      })
    ),
    templateApplication: value.template_application
      ? {
          templateId: String(value.template_application.template_id),
          templateVersion: Number(value.template_application.template_version),
          values: value.template_application.values || {}
        }
      : null,
    outputDirectoryId: value.output_directory_id ?? null,
    revision: Number(value.revision ?? 1),
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

export async function setProjectFinalJob(
  projectId: string,
  jobId: string
): Promise<Project> {
  await ensureSession();
  return mapProject(
    await parse<Record<string, any>>(
      await fetch(`/api/projects/${encodeURIComponent(projectId)}/final-version`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Qwen-Studio-CSRF": csrfToken
        },
        body: JSON.stringify({job_id: jobId})
      })
    )
  );
}
