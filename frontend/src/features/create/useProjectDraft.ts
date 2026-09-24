import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  createProject,
  duplicateProject,
  getProject,
  saveProject,
  type ProjectPatch,
} from "../../api";
import {
  DEFAULT_PARAMS,
  type DraftFields,
  type Project,
  type SaveState,
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
    ...fallback,
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
    templateApplication: project.templateApplication,
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
  conflict: { serverRevision: number } | null;
  recovered: DraftFields | null;
  change: (patch: Partial<DraftFields>) => void;
  saveNow: () => Promise<boolean>;
  getIdentity: () => { id: string | null; revision: number };
  resolveConflictByReload: () => Promise<void>;
  resolveConflictByCopy: () => Promise<string | null>;
  applyRecovered: () => void;
  dismissRecovered: () => void;
}

export function useProjectDraft({
  projectId,
  loaded,
  fallback,
  onProjectCreated,
}: UseProjectDraftOptions): ProjectDraftController {
  const initial = loaded ? fieldsOf(loaded) : defaultFields(fallback);
  const [fields, setFields] = useState<DraftFields>(initial);
  const [revision, setRevision] = useState(loaded?.revision ?? 0);
  const [activeId, setActiveId] = useState<string | null>(
    loaded?.id ?? projectId ?? null,
  );
  const [state, setState] = useState<SaveState>("clean");
  const [message, setMessage] = useState("");
  const [conflict, setConflict] = useState<{ serverRevision: number } | null>(
    null,
  );
  const [recovered, setRecovered] = useState<DraftFields | null>(null);

  const fieldsRef = useRef(fields);
  const revisionRef = useRef(revision);
  const idRef = useRef<string | null>(loaded?.id ?? projectId ?? null);
  const timerRef = useRef<number | null>(null);
  const runningRef = useRef(false);
  const queuedRef = useRef(false);
  const flightRef = useRef<Promise<boolean> | null>(null);
  const resolutionBarrierRef = useRef<Promise<void> | null>(null);
  const pendingCreatedIdRef = useRef<string | null>(null);
  const onCreatedRef = useRef(onProjectCreated);
  onCreatedRef.current = onProjectCreated;
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
    if (loaded && JSON.stringify(copy) === JSON.stringify(fieldsOf(loaded)))
      return;
    setRecovered(copy);
  }, [loaded, projectId]);

  const settle = useCallback((next: SaveState, text = "") => {
    if (!mountedRef.current) return;
    setState(next);
    setMessage(text);
  }, []);

  const push = useCallback((): Promise<boolean> => {
    if (resolutionBarrierRef.current)
      return resolutionBarrierRef.current.then(() => push());
    // Every caller waits for the same drain, including edits made while awaiting HTTP.
    if (flightRef.current) return flightRef.current;
    runningRef.current = true;
    const drain = async (): Promise<boolean> => {
      do {
        queuedRef.current = false;
        const snapshot = fieldsRef.current;
        const payload: ProjectPatch = { ...snapshot };
        const activeId = idRef.current;
        settle("saving");
        try {
          if (!activeId) {
            const created = await createProject(payload);
            idRef.current = created.id;
            revisionRef.current = created.revision;
            pendingCreatedIdRef.current = created.id;
            if (mountedRef.current) {
              setActiveId(created.id);
              setRevision(created.revision);
            }
          } else if (revisionRef.current) {
            const saved = await saveProject(
              activeId,
              revisionRef.current,
              payload,
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
          if (snapshot === fieldsRef.current) {
            clearRecovery(activeId);
            clearRecovery(idRef.current);
          } else {
            // The response acknowledges only snapshot; newer text stays recoverable.
            writeRecovery(idRef.current, fieldsRef.current);
            queuedRef.current = true;
          }
          if (mountedRef.current) setConflict(null);
        } catch (reason) {
          const failure = reason instanceof ApiError ? reason : null;
          writeRecovery(idRef.current, fieldsRef.current);
          if (failure?.code === "REVISION_CONFLICT") {
            const serverRevision = Number(
              failure.details?.current_revision ?? revisionRef.current + 1,
            );
            if (mountedRef.current) setConflict({ serverRevision });
            settle(
              "conflict",
              "这个项目已在别的标签页修改。本地内容还没有覆盖服务器版本。",
            );
          } else
            settle(
              "failed",
              failure?.message || "保存失败，本地副本已保留，可稍后重试。",
            );
          queuedRef.current = false;
          return false;
        }
      } while (queuedRef.current);
      settle("saved");
      if (pendingCreatedIdRef.current) {
        clearRecovery(null);
        const createdId = pendingCreatedIdRef.current;
        pendingCreatedIdRef.current = null;
        if (mountedRef.current) onCreatedRef.current?.(createdId);
      }
      return true;
    };
    flightRef.current = drain().finally(() => {
      runningRef.current = false;
      flightRef.current = null;
    });
    return flightRef.current;
  }, [settle]);

  const schedule = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void push();
    }, AUTOSAVE_DELAY_MS);
  }, [push]);

  const change = useCallback(
    (patch: Partial<DraftFields>) => {
      fieldsRef.current = { ...fieldsRef.current, ...patch };
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
    [schedule],
  );

  const saveNow = useCallback(async () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    return push();
  }, [push]);

  const getIdentity = useCallback(
    () => ({ id: idRef.current, revision: revisionRef.current }),
    [],
  );

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
    [],
  );

  const resolveConflictByReload = useCallback(async () => {
    if (resolutionBarrierRef.current) return;
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (flightRef.current) await flightRef.current;
    if (!idRef.current) return;
    let release = () => {};
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    resolutionBarrierRef.current = barrier;
    const snapshot = fieldsRef.current;
    try {
      const fresh = await getProject(idRef.current);
      if (snapshot !== fieldsRef.current) {
        if (mountedRef.current) setConflict({ serverRevision: fresh.revision });
        settle(
          "conflict",
          "读取服务器版本期间又有新编辑，已保留本地内容。请重新选择处理方式。",
        );
        return;
      }
      fieldsRef.current = fieldsOf(fresh);
      revisionRef.current = fresh.revision;
      clearRecovery(fresh.id);
      setFields(fieldsRef.current);
      setRevision(fresh.revision);
      setConflict(null);
      setRecovered(null);
      settle("clean");
    } finally {
      if (resolutionBarrierRef.current === barrier)
        resolutionBarrierRef.current = null;
      release();
    }
  }, [settle]);

  const resolveConflictByCopy = useCallback(async () => {
    if (resolutionBarrierRef.current) return null;
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (flightRef.current) await flightRef.current;
    let release = () => {};
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    resolutionBarrierRef.current = barrier;
    const previousId = idRef.current;
    const snapshot = fieldsRef.current;
    const name = `${Array.from(fieldsRef.current.name).slice(0, 117).join("")} 副本`;
    runningRef.current = true;
    settle("saving");
    try {
      const saved = previousId
        ? await (async () => {
            const copied = await duplicateProject(previousId, name);
            return saveProject(copied.id, copied.revision, {
              ...snapshot,
              name,
            });
          })()
        : await createProject({ ...snapshot, name });
      idRef.current = saved.id;
      revisionRef.current = saved.revision;
      const changedWhileCopying = fieldsRef.current !== snapshot;
      fieldsRef.current = { ...fieldsRef.current, name };
      clearRecovery(previousId);
      if (mountedRef.current) {
        setActiveId(saved.id);
        setRevision(saved.revision);
        setFields(fieldsRef.current);
        setConflict(null);
      }
      runningRef.current = false;
      resolutionBarrierRef.current = null;
      release();
      if (changedWhileCopying) {
        writeRecovery(saved.id, fieldsRef.current);
        if (!(await push())) return saved.id;
      } else clearRecovery(saved.id);
      settle("saved");
      if (mountedRef.current) onCreatedRef.current?.(saved.id);
      return saved.id;
    } catch (reason) {
      writeRecovery(idRef.current, fieldsRef.current);
      settle(
        "failed",
        reason instanceof Error
          ? reason.message
          : "副本保存失败，本地内容已保留。",
      );
      return null;
    } finally {
      runningRef.current = false;
      if (resolutionBarrierRef.current === barrier)
        resolutionBarrierRef.current = null;
      release();
    }
  }, [push, settle]);

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
      getIdentity,
      resolveConflictByReload,
      resolveConflictByCopy,
      applyRecovered,
      dismissRecovered,
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
      getIdentity,
      resolveConflictByReload,
      resolveConflictByCopy,
      applyRecovered,
      dismissRecovered,
    ],
  );
}
