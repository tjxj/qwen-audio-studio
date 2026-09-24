import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  createProject,
  getProject,
  getSession,
  getSettings,
  hasConfiguredCredentials,
  listProjects,
  mapParams,
  request,
  type SettingsPayload,
} from "../../api";
import type { CreateJobRequest, Project } from "../../types";
import CreateWorkbench, { type GenerationPreview } from "./CreateWorkbench";
import { useProjectDraft } from "./useProjectDraft";
import { inspirationTemplates } from "./templates";

export default function CreatePage() {
  const navigate = useNavigate(),
    [search] = useSearchParams(),
    requestedId = search.get("project");
  const [loaded, setLoaded] = useState<Project | undefined>(),
    [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [credentials, setCredentials] = useState(false);
  const [settings, setSettings] = useState<SettingsPayload | null>(null);
  useEffect(() => {
    let active = true;
    setReady(false);
    setError("");
    Promise.all([
      requestedId
        ? getProject(requestedId)
        : listProjects().then((items) => items.find((p) => !p.archived)),
      getSession(),
      getSettings(),
    ])
      .then(([project, session, preferences]) => {
        if (active) {
          setLoaded(project);
          setSettings(preferences);
          setCredentials(hasConfiguredCredentials(session.credentials));
          setReady(true);
        }
      })
      .catch((e) => {
        if (active) {
          setError(e.message);
          setReady(true);
        }
      });
    return () => {
      active = false;
    };
  }, [requestedId]);
  if (!ready) return <div className="loading-state">正在打开创作台…</div>;
  if (error)
    return (
      <div className="loading-state error">
        {error}
        <button onClick={() => location.reload()}>重新加载</button>
      </div>
    );
  if (!settings)
    return (
      <div className="loading-state error">
        默认设置未能载入，请重新打开创作台。
      </div>
    );
  return (
    <DraftEditor
      key={loaded?.id || "new"}
      loaded={loaded}
      settings={settings}
      credentials={credentials}
      onNew={async () => {
        const fresh = await getSettings();
        const next = await createProject({
          name: "未命名声音场景",
          mode: "podcast",
          prompt: "",
          params: mapParams(fresh.default_params),
          outputDirectoryId: fresh.default_directory_id,
        });
        navigate("/?project=" + next.id);
      }}
      onResult={(id) => navigate("/results/" + id)}
    />
  );
}
function DraftEditor({
  loaded,
  settings,
  credentials,
  onNew,
  onResult,
}: {
  loaded?: Project;
  settings: SettingsPayload;
  credentials: boolean;
  onNew: () => Promise<void>;
  onResult: (id: string) => void;
}) {
  const draft = useProjectDraft({
    projectId: loaded?.id || null,
    loaded,
    fallback: {
      prompt: inspirationTemplates[0].prompt,
      params: mapParams(settings.default_params),
      outputDirectoryId: settings.default_directory_id,
    },
    onProjectCreated: (id) => {
      const url = new URL(location.href);
      url.searchParams.set("project", id);
      window.history.replaceState(window.history.state, "", url);
    },
  });
  const pending = useRef<{
    payload: Record<string, unknown>;
    hash: string;
    requestId: string;
    consent?: string;
  } | null>(null);
  const [error, setError] = useState("");
  const preflight = async (
    input: CreateJobRequest,
  ): Promise<GenerationPreview> => {
    if (!(await draft.saveNow()))
      throw new Error("草稿尚未保存成功，请先处理保存提示。");
    const identity = draft.getIdentity();
    const payload = {
      project_id: identity.id,
      expected_project_revision: identity.revision,
      prompt: input.prompt,
      mode: input.mode,
      params: input.params,
      reference_bindings: input.reference_bindings || [],
      output_directory_id: input.output_directory_id,
      candidate_seeds: input.candidate_seeds || [input.params.seed],
    };
    const preview = await request<GenerationPreview & { request_hash: string }>(
      "/api/generation-preflight",
      "POST",
      payload,
    );
    pending.current = {
      payload,
      hash: preview.request_hash,
      requestId: crypto.randomUUID(),
    };
    return preview;
  };
  const submit = async (): Promise<{ id: string }> => {
    const current = pending.current;
    if (!current) throw new Error("请重新预检后生成。");
    const bindings = current.payload.reference_bindings as {
      reference_id: string;
    }[];
    if (bindings.length && !current.consent) {
      const consent = await request<{ consent_id: string }>(
        "/api/reference-consents",
        "POST",
        {
          project_id: current.payload.project_id,
          reference_ids: bindings.map((b) => b.reference_id),
          confirmed: true,
        },
      );
      current.consent = consent.consent_id;
    }
    const body = {
      ...current.payload,
      client_request_id: current.requestId,
      confirmed_request_hash: current.hash,
      ...(current.consent ? { consent_id: current.consent } : {}),
    };
    sessionStorage.setItem("qwen-studio.pending-generation", current.requestId);
    try {
      const result = await request<{ job_ids: string[] }>(
        "/api/generation-requests",
        "POST",
        body,
      );
      sessionStorage.removeItem("qwen-studio.pending-generation");
      return { id: result.job_ids[0] };
    } catch (e) {
      try {
        const recovered = await request<{ job_ids: string[] }>(
          "/api/generation-requests/" + encodeURIComponent(current.requestId),
        );
        if (recovered.job_ids.length) {
          sessionStorage.removeItem("qwen-studio.pending-generation");
          return { id: recovered.job_ids[0] };
        }
      } catch {
        /* keep ID: retrying this same confirmation reuses it */
      }
      throw e;
    }
  };
  useEffect(() => {
    const id = sessionStorage.getItem("qwen-studio.pending-generation");
    if (id)
      request<{ job_ids: string[] }>(
        "/api/generation-requests/" + encodeURIComponent(id),
      )
        .then((r) => {
          if (r.job_ids.length) {
            sessionStorage.removeItem("qwen-studio.pending-generation");
            onResult(r.job_ids[0]);
          }
        })
        .catch(() => {});
  }, []);
  const newDraft = async () => {
    setError("");
    try {
      if (!(await draft.saveNow()))
        throw new Error("请先保存当前内容，再开始新草稿。");
      await onNew();
    } catch (e) {
      setError(e instanceof Error ? e.message : "新草稿创建失败");
    }
  };
  return (
    <>
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
      <CreateWorkbench
        credentialsReady={credentials}
        draft={draft}
        initialProject={loaded}
        onNewProject={() => void newDraft()}
        onPreflight={preflight}
        onSubmit={submit}
        onJobCreated={onResult}
      />
    </>
  );
}
