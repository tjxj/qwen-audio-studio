import {useEffect, useState} from "react";
import {useNavigate, useSearchParams} from "react-router-dom";
import {
  createJob,
  createProject,
  deleteReference,
  getProject,
  getSession,
  hasConfiguredCredentials,
  listProjects,
  prepareReference
} from "../../api";
import type {CreateJobRequest, Project} from "../../types";
import CreateWorkbench from "./CreateWorkbench";
import {useProjectDraft} from "./useProjectDraft";

export default function CreatePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedId = searchParams.get("project");
  const [credentialsReady, setCredentialsReady] = useState(false);
  const [loaded, setLoaded] = useState<Project | undefined>();
  const [loadError, setLoadError] = useState("");
  const [pending, setPending] = useState(true);

  useEffect(() => {
    let active = true;
    getSession()
      .then((session) => {
        if (active) setCredentialsReady(hasConfiguredCredentials(session.credentials));
      })
      .catch(() => {
        if (active) setCredentialsReady(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setPending(true);
    setLoadError("");
    setLoaded(undefined);
    if (requestedId) {
      getProject(requestedId)
        .then((value) => {
          if (active) setLoaded(value);
        })
        .catch((reason) => {
          if (active) setLoadError(reason instanceof Error ? reason.message : "项目加载失败");
        })
        .finally(() => {
          if (active) setPending(false);
        });
      return () => {
        active = false;
      };
    }
    // "/" restores the most recent draft that is still open.
    listProjects()
      .then((items) => {
        if (!active) return;
        const recent = items.find((item) => !item.archived);
        if (recent) setLoaded(recent);
      })
      .catch(() => {
        /* No reachable service: the page still opens on a fresh, unsaved draft. */
      })
      .finally(() => {
        if (active) setPending(false);
      });
    return () => {
      active = false;
    };
  }, [requestedId]);

  const draft = useProjectDraft({
    projectId: requestedId,
    loaded,
    onProjectCreated: (id) => navigate(`/?project=${id}`, {replace: true})
  });

  if (pending) return <div className="loading-state">正在打开项目…</div>;
  if (loadError) return <div className="loading-state error">{loadError}</div>;

  const startNew = async () => {
    const created = await createProject({
      name: "未命名声音场景",
      mode: "podcast",
      prompt: ""
    });
    navigate(`/?project=${created.id}`, {replace: true});
  };

  const submit = async (payload: CreateJobRequest) => {
    const saved = await draft.saveNow();
    if (!saved) throw new Error(draft.message || "草稿保存失败，已停止生成。");
    const projectId = draft.projectId;
    if (!projectId) throw new Error("请先保存草稿，再生成。");
    return createJob({...payload, project_id: projectId});
  };

  return (
    <CreateWorkbench
      credentialsReady={credentialsReady}
      draft={draft}
      initialProject={loaded}
      onPrepareReference={prepareReference}
      onDeleteReference={deleteReference}
      onNewProject={() => void startNew()}
      onSubmit={submit}
      onJobCreated={(id) => navigate("/results/" + id)}
    />
  );
}
