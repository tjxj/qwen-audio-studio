import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {
  ApiError,
  createProject,
  duplicateProject,
  getProject,
  saveProject,
  type ProjectPatch
} from "../../api";
import {
  DEFAULT_PARAMS,
  type DraftFields,
  type Project,
  type SaveState
} from "../../types";

export const AUTOSAVE_DELAY_MS = 800;
export const RECOVERY_KEY_PREFIX = "qwen-studio.draft";

export function recoveryKey(projectId: string | null) {
  return `${RECOVERY_KEY_PREFIX}.${projectId || "new"}`;
}

function defaultFields(fallback?: Partial<DraftFields>): DraftFields {
  return {
    name: "未命名声音场景",
    mode: "podcast",
    prompt: "",
    params: DEFAULT_PARAMS,
    referenceBindings: [],
    outputDirectoryId: null,
    templateApplication: null,
    ...fallback
  };
}

function fieldsOf(project: Project): DraftFields {
  return {
    name: project.name,
    mode: project.mode,
    prompt: project.prompt,
    params: project.params,
    referenceBindings: project.referenceBindings,
    outputDirectoryId: project.outputDirectoryId,
    templateApplication: project.templateApplication
  };
}

function readRecovery(projectId: string | null): DraftFields | null {
  try {
    const raw = window.localStorage.getItem(recoveryKey(projectId));
    return raw ? (JSON.parse(raw) as DraftFields) : null;
  } catch {
    return null;
  }
}

/** Recovery copies hold editable text and parameters only: never credentials. */
function writeRecovery(projectId: string | null, fields: DraftFields) {
  try {
    window.localStorage.setItem(recoveryKey(projectId), JSON.stringify(fields));
  } catch {
    /* Private mode or quota: the server copy still wins on reload. */
  }
}

function clearRecovery(projectId: string | null) {
  try {
    window.localStorage.removeItem(recoveryKey(projectId));
  } catch {
    /* ignore */
  }
}

export interface UseProjectDraftOptions {
  projectId: string | null;
  loaded?: Project;
  fallback?: Partial<DraftFields>;
  onProjectCreated?: (projectId: string) => void;
}

export interface ProjectDraftController {
  fields: DraftFields;
  revision: number;
  projectId: string | null;
  state: SaveState;
  message: string;
  conflict: {serverRevision: number} | null;
  recovered: DraftFields | null;
  change: (patch: Partial<DraftFields>) => void;
  saveNow: () => Promise<boolean>;
  resolveConflictByReload: () => Promise<void>;
  resolveConflictByCopy: () => Promise<string | null>;
  applyRecovered: () => void;
  dismissRecovered: () => void;
}

export function useProjectDraft({
  projectId,
  loaded,
  fallback,
  onProjectCreated
}: UseProjectDraftOptions): ProjectDraftController {
  const initial = loaded ? fieldsOf(loaded) : defaultFields(fallback);
  const [fields, setFields] = useState<DraftFields>(initial);
  const [revision, setRevision] = useState(loaded?.revision ?? 0);
  const [activeId, setActiveId] = useState<string | null>(
    loaded?.id ?? projectId ?? null
  );
  const [state, setState] = useState<SaveState>("clean");
  const [message, setMessage] = useState("");
  const [conflict, setConflict] = useState<{serverRevision: number} | null>(null);
  const [recovered, setRecovered] = useState<DraftFields | null>(null);

  const fieldsRef = useRef(fields);
  const revisionRef = useRef(revision);
  const idRef = useRef<string | null>(loaded?.id ?? projectId ?? null);
  const timerRef = useRef<number | null>(null);
  const runningRef = useRef(false);
  const queuedRef = useRef(false);
  const lastResultRef = useRef(true);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const key = loaded ? loaded.id : projectId;
    if (!loaded && projectId) return;
    const copy = key ? readRecovery(key) : readRecovery(null);
    if (!copy) return;
    if (loaded && JSON.stringify(copy) === JSON.stringify(fieldsOf(loaded))) return;
    setRecovered(copy);
  }, [loaded, projectId]);

  const settle = useCallback(
    (next: SaveState, text = "") => {
      if (!mountedRef.current) return;
      setState(next);
      setMessage(text);
    },
    []
  );

  const push = useCallback(async (): Promise<boolean> => {
    if (runningRef.current) {
      queuedRef.current = true;
      return lastResultRef.current;
    }
    runningRef.current = true;
    let ok = true;
    do {
      queuedRef.current = false;
      const payload: ProjectPatch = {...fieldsRef.current};
      const activeId = idRef.current;
      settle("saving");
      try {
        if (!activeId) {
          const created = await createProject(payload);
          idRef.current = created.id;
          if (mountedRef.current) setActiveId(created.id);
          revisionRef.current = created.revision;
          if (mountedRef.current) setRevision(created.revision);
          onProjectCreated?.(created.id);
        } else if (revisionRef.current) {
          const saved = await saveProject(
            activeId,
            revisionRef.current,
            payload
          );
          revisionRef.current = saved.revision;
          if (mountedRef.current) setRevision(saved.revision);
        } else {
          const current = await getProject(activeId);
          revisionRef.current = current.revision;
          if (mountedRef.current) setRevision(current.revision);
          queuedRef.current = true;
          continue;
        }
        clearRecovery(activeId);
        clearRecovery(idRef.current);
        ok = true;
        if (mountedRef.current) setConflict(null);
        settle("saved");
      } catch (reason) {
        ok = false;
        const failure = reason instanceof ApiError ? reason : null;
        writeRecovery(idRef.current, fieldsRef.current);
        if (failure?.code === "REVISION_CONFLICT") {
          const serverRevision = Number(
            failure.details?.current_revision ?? revisionRef.current + 1
          );
          if (mountedRef.current) setConflict({serverRevision});
          settle(
            "conflict",
            "这个项目已在别的标签页修改。本地内容还没有覆盖服务器版本。"
          );
        } else {
          settle(
            "failed",
            failure?.message || "保存失败，本地副本已保留，可稍后重试。"
          );
        }
      }
      lastResultRef.current = ok;
    } while (queuedRef.current);
    runningRef.current = false;
    return ok;
  }, [onProjectCreated, settle]);

  const schedule = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void push();
    }, AUTOSAVE_DELAY_MS);
  }, [push]);

  const change = useCallback(
    (patch: Partial<DraftFields>) => {
      fieldsRef.current = {...fieldsRef.current, ...patch};
      setFields(fieldsRef.current);
      writeRecovery(idRef.current, fieldsRef.current);
      if (runningRef.current) {
        queuedRef.current = true;
        setState("saving");
      } else {
        setState("dirty");
        schedule();
      }
    },
    [schedule]
  );

  const saveNow = useCallback(async () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    return push();
  }, [push]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveNow();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saveNow]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    []
  );

  const resolveConflictByReload = useCallback(async () => {
    if (!idRef.current) return;
    const fresh = await getProject(idRef.current);
    fieldsRef.current = fieldsOf(fresh);
    revisionRef.current = fresh.revision;
    clearRecovery(fresh.id);
    setFields(fieldsRef.current);
    setRevision(fresh.revision);
    setConflict(null);
    setRecovered(null);
    settle("clean");
  }, [settle]);

  const resolveConflictByCopy = useCallback(async () => {
    const name = `${fieldsRef.current.name} 副本`;
    if (!idRef.current) {
      const created = await createProject({...fieldsRef.current, name});
      idRef.current = created.id;
      if (mountedRef.current) setActiveId(created.id);
      revisionRef.current = created.revision;
      onProjectCreated?.(created.id);
    } else {
      const copied = await duplicateProject(idRef.current, name);
      const saved = await saveProject(copied.id, copied.revision, {
        ...fieldsRef.current,
        name
      });
      idRef.current = saved.id;
      if (mountedRef.current) setActiveId(saved.id);
      revisionRef.current = saved.revision;
      onProjectCreated?.(saved.id);
    }
    clearRecovery(idRef.current);
    if (mountedRef.current) {
      setRevision(revisionRef.current);
      setConflict(null);
    }
    settle("saved");
    return idRef.current;
  }, [onProjectCreated, settle]);

  const applyRecovered = useCallback(() => {
    if (!recovered) return;
    fieldsRef.current = recovered;
    setFields(recovered);
    setRecovered(null);
    writeRecovery(idRef.current, recovered);
    setState("dirty");
    schedule();
  }, [recovered, schedule]);

  const dismissRecovered = useCallback(() => {
    clearRecovery(idRef.current);
    setRecovered(null);
  }, []);

  return useMemo(
    () => ({
      fields,
      revision,
      projectId: activeId,
      state,
      message,
      conflict,
      recovered,
      change,
      saveNow,
      resolveConflictByReload,
      resolveConflictByCopy,
      applyRecovered,
      dismissRecovered
    }),
    [
      fields,
      revision,
      activeId,
      state,
      message,
      conflict,
      recovered,
      change,
      saveNow,
      resolveConflictByReload,
      resolveConflictByCopy,
      applyRecovered,
      dismissRecovered
    ]
  );
}
