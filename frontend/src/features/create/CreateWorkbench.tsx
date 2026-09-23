import {useMemo, useRef, useState} from "react";
import {BookOpenText, Lightbulb, X} from "lucide-react";
import {
  DEFAULT_PARAMS,
  SAVE_STATE_LABELS,
  type CreateJobRequest,
  type DraftFields,
  type GenerationParams,
  type PreparedReference,
  type Project
} from "../../types";
import {insertTag, type PromptTag} from "./editor";
import {GenerationCommandBar} from "./GenerationCommandBar";
import {GenerationInspector} from "./GenerationInspector";
import {ModeSelector} from "./ModeSelector";
import {PromptTagToolbar} from "./PromptTagToolbar";
import {ReferenceAudioRack} from "./ReferenceAudioRack";
import {inspirationTemplates, modeProfiles} from "./templates";
import type {ProjectDraftController} from "./useProjectDraft";

const initialPrompt = inspirationTemplates[0].prompt;

function toApiParams(params: GenerationParams): CreateJobRequest["params"] {
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

export interface CreateWorkbenchProps {
  credentialsReady: boolean;
  onSubmit: (payload: CreateJobRequest) => Promise<{id: string}>;
  onJobCreated: (id: string) => void;
  onPrepareReference?: (file: File) => Promise<PreparedReference>;
  onDeleteReference?: (id: string) => Promise<void>;
  onNewProject?: () => void;
  initialReferences?: PreparedReference[];
  initialProject?: Project;
  draft?: ProjectDraftController;
}

export default function CreateWorkbench({
  credentialsReady,
  onSubmit,
  onJobCreated,
  onPrepareReference,
  onDeleteReference,
  onNewProject,
  initialReferences = [],
  initialProject,
  draft
}: CreateWorkbenchProps) {
  const [localForm, setLocalForm] = useState<DraftFields>({
    name: initialProject?.name || "未命名声音场景",
    mode: initialProject?.mode || "podcast",
    prompt: initialProject?.prompt || initialPrompt,
    params: initialProject?.params || DEFAULT_PARAMS,
    referenceBindings: initialProject?.referenceBindings || [],
    outputDirectoryId: initialProject?.outputDirectoryId ?? null,
    templateApplication: initialProject?.templateApplication ?? null
  });
  const form = draft ? draft.fields : localForm;
  const update = (patch: Partial<DraftFields>) => {
    if (draft) draft.change(patch);
    else setLocalForm((current) => ({...current, ...patch}));
  };

  const [references, setReferences] = useState(initialReferences);
  const [preparingReference, setPreparingReference] = useState(false);
  const [confirmingReferences, setConfirmingReferences] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const remaining = 3000 - form.prompt.length;
  const visibleTemplates = useMemo(
    () => inspirationTemplates.filter((template) => template.mode === form.mode),
    [form.mode]
  );
  const profile = modeProfiles[form.mode];

  const canGenerate = useMemo(
    () => credentialsReady && form.prompt.trim().length > 0 && remaining >= 0,
    [credentialsReady, form.prompt, remaining]
  );

  const applyTag = (tag: PromptTag) => {
    const textarea = editorRef.current;
    const selection = {
      start: textarea?.selectionStart ?? form.prompt.length,
      end: textarea?.selectionEnd ?? form.prompt.length
    };
    const next = insertTag(form.prompt, selection, tag);
    update({prompt: next.text});
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(next.selection.start, next.selection.end);
    });
  };

  const changeMode = (nextMode: DraftFields["mode"]) => {
    const promptComesFromTemplate = inspirationTemplates.some(
      (template) => template.prompt === form.prompt
    );
    const patch: Partial<DraftFields> = {mode: nextMode};
    if (promptComesFromTemplate) {
      const starter = inspirationTemplates.find(
        (template) => template.mode === nextMode
      );
      if (starter) patch.prompt = starter.prompt;
    }
    update(patch);
  };

  const submit = async () => {
    setSubmitting(true);
    setError("");
    try {
      const result = await onSubmit({
        project_id: draft?.projectId || initialProject?.id || "local-draft",
        project_name: form.name.trim() || "未命名声音场景",
        mode: form.mode,
        prompt: form.prompt,
        params: toApiParams(form.params),
        references: references.map((item) => ({
          id: item.id,
          consent_token: item.consent_token
        }))
      });
      setConfirmingReferences(false);
      onJobCreated(result.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "生成任务提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  const requestGeneration = () => {
    if (references.length > 0) {
      setConfirmingReferences(true);
    } else {
      void submit();
    }
  };

  const addReference = async (file: File) => {
    if (!onPrepareReference) return;
    setPreparingReference(true);
    setError("");
    try {
      const prepared = await onPrepareReference(file);
      setReferences((items) => [...items, prepared].slice(0, 3));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "参考音频检查失败");
    } finally {
      setPreparingReference(false);
    }
  };

  return (
    <div className="create-workbench">
      <div className="draft-heading">
        <label>
          场景名称
          <input
            aria-label="场景名称"
            value={form.name}
            maxLength={120}
            onChange={(event) => update({name: event.target.value})}
          />
        </label>
        <span data-testid="save-state">{SAVE_STATE_LABELS[draft?.state || "clean"]}</span>
        {onNewProject ? (
          <button type="button" onClick={onNewProject}>
            新建项目
          </button>
        ) : null}
        {draft?.projectId ? (
          <span>正在续作 · 新结果会归入同一项目</span>
        ) : (
          <span>编辑后自动保存为本地草稿</span>
        )}
      </div>
      {draft?.conflict ? (
        <div className="inline-error" role="alert">
          <span>{draft.message}</span>
          <button type="button" onClick={() => void draft.resolveConflictByReload()}>
            载入最新版本
          </button>
          <button type="button" onClick={() => void draft.resolveConflictByCopy()}>
            另存为副本
          </button>
        </div>
      ) : null}
      {draft?.recovered ? (
        <div className="inline-error" role="status">
          <span>发现上次未保存的本地副本。</span>
          <button type="button" onClick={draft.applyRecovered}>
            恢复本地副本
          </button>
          <button type="button" onClick={draft.dismissRecovered}>
            丢弃
          </button>
        </div>
      ) : null}
      <ModeSelector value={form.mode} onChange={changeMode} />
      <section className="mode-context" aria-live="polite">
        <div><span>当前工作流</span><h2>{profile.title}</h2></div>
        <strong>{profile.description}</strong>
        <p>{profile.detail}</p>
      </section>
      <div className="workbench-grid">
        <section className="prompt-studio">
          <div className="editor-header">
            <PromptTagToolbar onInsert={applyTag} />
            <span className={remaining < 0 ? "char-count is-error" : "char-count"}>
              {form.prompt.length} / 3000
            </span>
          </div>
          <div className="editor-canvas">
            <div className="line-numbers" aria-hidden="true">
              {Array.from({length: Math.max(14, form.prompt.split("\n").length)}, (_, index) => (
                <span key={index}>{index + 1}</span>
              ))}
            </div>
            <textarea
              ref={editorRef}
              aria-label="场景提示词"
              value={form.prompt}
              spellCheck={false}
              onChange={(event) => update({prompt: event.target.value})}
            />
          </div>
          <section className="inspiration-section">
            <div className="inspiration-heading">
              <div><Lightbulb size={17} /><strong>灵感模板</strong></div>
              <span className="template-count">{visibleTemplates.length} 个模板</span>
            </div>
            <div className="template-rail">
              {visibleTemplates.map((template) => (
                <button
                  type="button"
                  className="template-card"
                  key={template.id}
                  onClick={() => {
                    update({mode: template.mode, prompt: template.prompt});
                  }}
                >
                  <div className="template-art" aria-hidden="true">
                    <BookOpenText size={19} />
                    <i />
                  </div>
                  <div>
                    <strong>{template.title}</strong>
                    <span>{template.subtitle}</span>
                    <small>{template.duration}</small>
                  </div>
                </button>
              ))}
            </div>
          </section>
        </section>
        <aside className="workbench-inspector">
          <ReferenceAudioRack
            references={references}
            onAdd={(file) => void addReference(file)}
            onRemove={(id) => {
              setReferences((items) => items.filter((item) => item.id !== id));
              if (onDeleteReference) void onDeleteReference(id);
            }}
            busy={preparingReference}
          />
          <GenerationInspector
            value={form.params}
            onChange={(params) => update({params})}
          />
        </aside>
      </div>
      {error ? <div className="inline-error" role="alert">{error}</div> : null}
      <GenerationCommandBar
        referenceCount={references.length}
        disabled={!canGenerate}
        busy={submitting}
        credentialsReady={credentialsReady}
        onGenerate={requestGeneration}
      />
      {confirmingReferences ? (
        <div className="modal-backdrop">
          <section className="consent-dialog" role="dialog" aria-label="确认上传参考音频" aria-modal="true">
            <button
              type="button"
              className="modal-close"
              aria-label="关闭"
              onClick={() => setConfirmingReferences(false)}
            >
              <X size={18} />
            </button>
            <h2>确认上传参考音频</h2>
            <p>以下文件将在本次任务中发送至阿里云百炼。生成完成后，本地临时副本会被清理。</p>
            <ul>{references.map((item) => <li key={item.id}>{item.name} · {item.duration_seconds.toFixed(1)}s</li>)}</ul>
            <div className="modal-actions">
              <button type="button" onClick={() => setConfirmingReferences(false)}>取消</button>
              <button type="button" className="primary" onClick={() => void submit()}>确认上传并生成</button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
