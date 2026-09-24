import { ApiError, getSession } from "../../api";
import type {
  CreationMode,
  DraftFields,
  GenerationParams,
  ReferenceBinding,
  TemplateApplication,
} from "../../types";

export interface TemplateVariable {
  key: string;
  label: string;
  type: "text" | "number" | "select";
  required?: boolean;
  default: string | number;
  max_length?: number;
  min?: number;
  max?: number;
  options?: string[];
}
export interface StudioTemplate {
  id: string;
  source: "builtin" | "user";
  version: number;
  name: string;
  mode: CreationMode;
  description: string;
  tags: string[];
  role_count: number;
  suggested_duration_seconds: number | null;
  prompt_pattern: string;
  variables: TemplateVariable[];
  favorite: boolean;
  params_preset: Record<string, unknown> | null;
}
export interface TemplatePreview {
  prompt: string;
  compiled_prompt: string;
  compiled_chars: number;
  max_chars: number;
  values: Record<string, string | number>;
  missing_roles: string[];
  can_apply: boolean;
  params_preset: Record<string, unknown> | null;
  params_diff: Record<string, { from?: unknown; to: unknown }>;
}
export interface TemplateChoice {
  prompt: string;
  mode: CreationMode;
  templateApplication: TemplateApplication;
  paramsPreset?: Partial<GenerationParams>;
}
export type EditableTemplate = Pick<
  StudioTemplate,
  | "name"
  | "mode"
  | "description"
  | "tags"
  | "prompt_pattern"
  | "variables"
  | "role_count"
  | "suggested_duration_seconds"
  | "params_preset"
>;
export interface TemplateFilters {
  mode?: CreationMode;
  q?: string;
  favorite?: boolean;
  source?: "builtin" | "user";
  page?: number;
  page_size?: 20 | 50;
}

async function request<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (method !== "GET")
    headers["X-Qwen-Studio-CSRF"] = (await getSession()).csrf_token;
  const response = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    const error = result.error;
    throw new ApiError(error?.message || "模板操作未完成，请检查内容后重试。", {
      status: response.status,
      code: error?.code,
      field: error?.field,
    });
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

export function listTemplates(filters: TemplateFilters = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(filters))
    if (value !== undefined && value !== "") search.set(key, String(value));
  return request<{
    items: StudioTemplate[];
    total: number;
    page: number;
    page_size: number;
  }>(`/api/templates?${search}`);
}
export function getTemplate(id: string) {
  return request<StudioTemplate>(`/api/templates/${encodeURIComponent(id)}`);
}
export function favoriteTemplate(id: string, favorite: boolean) {
  return request<StudioTemplate>(
    `/api/templates/${encodeURIComponent(id)}/favorite`,
    "PUT",
    { favorite },
  );
}
export function createTemplate(payload: EditableTemplate) {
  return request<StudioTemplate>("/api/templates", "POST", payload);
}
export function updateTemplate(id: string, payload: EditableTemplate) {
  return request<StudioTemplate>(
    `/api/templates/${encodeURIComponent(id)}`,
    "PATCH",
    payload,
  );
}
export function deleteTemplate(id: string) {
  return request<void>(`/api/templates/${encodeURIComponent(id)}`, "DELETE");
}
export function previewTemplate(
  id: string,
  values: Record<string, string | number>,
  bindings: ReferenceBinding[] = [],
  applyParams = false,
  params?: GenerationParams,
) {
  return request<TemplatePreview>(
    `/api/templates/${encodeURIComponent(id)}/preview`,
    "POST",
    {
      values,
      reference_bindings: bindings.map((binding) => ({
        reference_id: binding.referenceId,
        alias: binding.alias,
      })),
      apply_params: applyParams,
      current_params: params ? paramsToApi(params) : {},
    },
  );
}

const PARAM_KEYS: Record<string, keyof GenerationParams> = {
  format: "format",
  sample_rate: "sampleRate",
  channels: "channels",
  volume: "volume",
  rate: "rate",
  seed: "seed",
  enable_cbr: "enableCbr",
  bit_rate: "bitRate",
  quality: "quality",
  enable_aigc_tag: "enableAigcTag",
};
export function paramsToApi(params: Partial<GenerationParams>) {
  return Object.fromEntries(
    Object.entries(PARAM_KEYS)
      .filter(([, key]) => params[key] !== undefined)
      .map(([key, local]) => [key, params[local]]),
  );
}
export function choiceFromPreview(
  template: StudioTemplate,
  preview: TemplatePreview,
): TemplateChoice {
  return {
    prompt: preview.prompt,
    mode: template.mode,
    templateApplication: {
      templateId: template.id,
      templateVersion: template.version,
      values: preview.values,
    },
    ...(preview.params_preset
      ? {
          paramsPreset: Object.fromEntries(
            Object.entries(preview.params_preset)
              .filter(([key]) => PARAM_KEYS[key])
              .map(([key, value]) => [PARAM_KEYS[key], value]),
          ),
        }
      : {}),
  };
}
export function applyTemplateToDraft(
  draft: DraftFields,
  choice: TemplateChoice,
): DraftFields {
  return {
    ...draft,
    mode: choice.mode,
    prompt: choice.prompt,
    templateApplication: choice.templateApplication,
    params: choice.paramsPreset
      ? { ...draft.params, ...choice.paramsPreset }
      : draft.params,
  };
}
const PENDING_KEY = "qwen-studio.pending-template.v1";
export function savePendingTemplate(choice: TemplateChoice) {
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(choice));
}
export function consumePendingTemplate(): TemplateChoice | null {
  const raw = sessionStorage.getItem(PENDING_KEY);
  if (!raw) return null;
  sessionStorage.removeItem(PENDING_KEY);
  try {
    const choice = JSON.parse(raw) as TemplateChoice;
    return typeof choice.prompt === "string" &&
      choice.templateApplication?.templateId
      ? choice
      : null;
  } catch {
    return null;
  }
}
