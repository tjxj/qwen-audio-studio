import {useEffect, useState} from "react";
import {useNavigate, useSearchParams} from "react-router-dom";
import {
  createJob,
  createProject,
  deleteReference,
  getProject,
  getSession,
  hasConfiguredCredentials,
  prepareReference,
  updateProject
} from "../../api";
import type {CreateJobRequest, Project} from "../../types";
import CreateWorkbench from "./CreateWorkbench";

export default function CreatePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get("project");
  const [credentialsReady, setCredentialsReady] = useState(false);
  const [project, setProject] = useState<Project | undefined>();
  const [projectError, setProjectError] = useState("");

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
    setProjectError("");
    if (!projectId) {
      setProject(undefined);
      return;
    }
    getProject(projectId)
      .then((value) => { if (active) setProject(value); })
      .catch((reason) => { if (active) setProjectError(reason instanceof Error ? reason.message : "项目加载失败"); });
    return () => { active = false; };
  }, [projectId]);

  const submit = async (payload: CreateJobRequest) => {
    const projectInput = {
      name: payload.project_name,
      mode: payload.mode,
      prompt: payload.prompt,
      params: payload.params
    };
    if (project) {
      await updateProject(project.id, projectInput);
      return createJob({...payload, project_id: project.id});
    }
    const created = await createProject(projectInput);
    return createJob({...payload, project_id: created.id});
  };

  if (projectId && !project && !projectError) return <div className="loading-state">正在打开项目…</div>;
  if (projectError) return <div className="loading-state error">{projectError}</div>;

  return (
    <CreateWorkbench
      credentialsReady={credentialsReady}
      initialProject={project}
      onPrepareReference={prepareReference}
      onDeleteReference={deleteReference}
      onSubmit={submit}
      onJobCreated={(id) => navigate("/results/" + id)}
    />
  );
}
