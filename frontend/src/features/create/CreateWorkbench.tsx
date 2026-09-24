import { useEffect, useRef, useState } from "react";
import {
  Check,
  MoreHorizontal,
  Plus,
  SlidersHorizontal,
  Undo2,
  X,
  Waves,
} from "lucide-react";
import {
  DEFAULT_PARAMS,
  SAVE_STATE_LABELS,
  type CreateJobRequest,
  type DraftFields,
  type PreparedReference,
  type Project,
} from "../../types";
import { getSettings, request } from "../../api";
import { Modal } from "../../components/Modal";
import { OutputDirectoryPicker } from "../../components/OutputDirectoryPicker";
import { insertTag, type PromptTag } from "./editor";
import { GenerationInspector } from "./GenerationInspector";
import { ModeSelector } from "./ModeSelector";
import { PromptTagToolbar } from "./PromptTagToolbar";
import { inspirationTemplates, modeProfiles } from "./templates";
import type { ProjectDraftController } from "./useProjectDraft";
import { VoiceDrawer, type VoiceReference } from "../voices/VoiceDrawer";
import { TemplatePicker } from "../templates/TemplatePicker";
import {
  applyTemplateToDraft,
  consumePendingTemplate,
  type TemplateChoice,
} from "../templates/templatesApi";
import { toServerParams } from "../../api";

export interface GenerationPreview {
  compiled_prompt: string;
  compiled_chars: number;
  request_hash?: string;
  warnings?: string[];
  reference_snapshot?: Array<{
    reference_id: string;
    name: string;
    duration_seconds: number;
    alias?: string;
  }>;
}
export interface CreateWorkbenchProps {
  credentialsReady: boolean;
  onSubmit: (payload: CreateJobRequest) => Promise<{ id: string }>;
  onJobCreated: (id: string) => void;
  onPreflight?: (payload: CreateJobRequest) => Promise<GenerationPreview>;
  onPrepareReference?: (file: File) => Promise<PreparedReference>;
  onDeleteReference?: (id: string) => Promise<void>;
  onNewProject?: () => void;
  initialReferences?: PreparedReference[];
  initialProject?: Project;
  draft?: ProjectDraftController;
}
const starter = inspirationTemplates[0];
export default function CreateWorkbench({
  credentialsReady,
  onSubmit,
  onJobCreated,
  onPreflight,
  onNewProject,
  initialReferences = [],
  initialProject,
  draft,
}: CreateWorkbenchProps) {
  const [localForm, setLocalForm] = useState<DraftFields>({
    name: initialProject?.name || "未命名声音场景",
    mode: initialProject?.mode || "podcast",
    prompt: initialProject?.prompt ?? starter.prompt,
    params: initialProject?.params || DEFAULT_PARAMS,
    referenceBindings: initialProject?.referenceBindings || [],
    outputDirectoryId: initialProject?.outputDirectoryId ?? null,
    templateApplication: initialProject?.templateApplication ?? null,
  });
  const [templateId, setTemplateId] = useState<string>();
  const undoEdited = useRef(false);
  const form = draft ? draft.fields : localForm;
  const update = (patch: Partial<DraftFields>) => {
    if (draft) draft.change(patch);
    else setLocalForm((current) => ({ ...current, ...patch }));
  };
  const [menu, setMenu] = useState(false),
    [advanced, setAdvanced] = useState(false),
    [mobileSettings, setMobileSettings] = useState(false),
    [voicesOpen, setVoicesOpen] = useState(
      () => new URLSearchParams(location.search).get("panel") === "voices",
    ),
    [templatesOpen, setTemplatesOpen] = useState(false),
    [tab, setTab] = useState<"voice" | "output">("voice");
  const [voices, setVoices] = useState<VoiceReference[]>([]),
    [voiceText, setVoiceText] = useState(""),
    [candidates, setCandidates] = useState(1),
    [submitting, setSubmitting] = useState(false),
    [error, setError] = useState(""),
    [confirmation, setConfirmation] = useState<{
      payload: CreateJobRequest;
      preview: GenerationPreview;
    } | null>(null),
    [undo, setUndo] = useState<DraftFields | null>(null),
    [pendingTemplate, setPendingTemplate] = useState<TemplateChoice | null>(
      null,
    );
  const edited = useRef(!!initialProject?.prompt && !initialProject?.templateApplication),
    editorRef = useRef<HTMLTextAreaElement>(null),
    submitLock = useRef(false);
  useEffect(() => {
    getSettings()
      .then((settings) => {
        document.documentElement.style.setProperty(
          "--script-size",
          settings.script_font_size + "px",
        );
        document.documentElement.style.setProperty(
          "--script-font",
          settings.script_font === "sans"
            ? "var(--font-ui)"
            : "var(--font-serif)",
        );
      })
      .catch(() => {});
    const choice = consumePendingTemplate();
    if (choice) setPendingTemplate(choice);
  }, []);
  const count = Array.from(form.prompt).length,
    remaining = 3000 - count;
  const visibleTemplates = inspirationTemplates
    .filter((t) => t.mode === form.mode)
    .slice(0, 3);
  const profile = modeProfiles[form.mode];
  const applyTag = (tag: PromptTag) => {
    const el = editorRef.current;
    const next = insertTag(
      form.prompt,
      {
        start: el?.selectionStart ?? form.prompt.length,
        end: el?.selectionEnd ?? form.prompt.length,
      },
      tag,
    );
    edited.current = true;
    update({ prompt: next.text, templateApplication: null });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(next.selection.start, next.selection.end);
    });
  };
  const applyChoice = (choice: TemplateChoice) => {
    setUndo({ ...form });
    undoEdited.current = edited.current;
    edited.current = false;
    update(applyTemplateToDraft(form, choice));
    setPendingTemplate(null);
  };
  const changeMode = (mode: DraftFields["mode"]) => {
    const next = inspirationTemplates.find((t) => t.mode === mode);
    update({
      mode,
      ...(!edited.current && next
        ? {
            prompt: next.prompt,
            templateApplication: {
              templateId: next.id,
              templateVersion: 2,
              values: {},
            },
          }
        : {}),
    });
  };
  const payload = (): CreateJobRequest => ({
    project_id: draft?.projectId || initialProject?.id || "local-draft",
    project_name: form.name.trim() || "未命名声音场景",
    mode: form.mode,
    prompt: form.prompt,
    params: toServerParams(form.params),
    references: initialReferences.map((r) => ({
      id: r.id,
      consent_token: r.consent_token,
    })),
    reference_bindings: form.referenceBindings.map((r) => ({
      reference_id: r.referenceId,
      alias: r.alias,
    })),
    candidate_seeds: Array.from(
      { length: candidates },
      (_, i) => form.params.seed + i,
    ),
    output_directory_id: form.outputDirectoryId,
  });
  const requestGeneration = async () => {
    if (submitLock.current) return;
    submitLock.current = true;
    setSubmitting(true);
    setError("");
    try {
      const next = payload();
      const preview = onPreflight
        ? await onPreflight(next)
        : { compiled_prompt: next.prompt, compiled_chars: count };
      setConfirmation({ payload: next, preview });
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成预检失败");
    } finally {
      setSubmitting(false);
      submitLock.current = false;
    }
  };
  const submit = async () => {
    if (!confirmation || submitLock.current) return;
    submitLock.current = true;
    setSubmitting(true);
    setError("");
    try {
      const result = await onSubmit(confirmation.payload);
      setConfirmation(null);
      onJobCreated(result.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成任务提交失败");
    } finally {
      setSubmitting(false);
      submitLock.current = false;
    }
  };
  const bindingsKey = form.referenceBindings
    .map((b) => b.referenceId)
    .join("|");
  useEffect(() => {
    let active = true;
    Promise.all(
      form.referenceBindings.map((b) =>
        request<VoiceReference>(
          "/api/references/" + encodeURIComponent(b.referenceId),
        ).catch(() => null),
      ),
    ).then((items) => {
      if (active)
        setVoices((current) => [
          ...current,
          ...items
            .filter((v): v is VoiceReference => !!v)
            .filter((v) => !current.some((old) => old.id === v.id)),
        ]);
    });
    return () => {
      active = false;
    };
  }, [bindingsKey]);
  const removeVoice = (id: string) => {
    if (/@voice[1-3]/.test(form.prompt)) {
      setError(
        "脚本含固定 @voice 编号。请先调整或移除这些标记，再移除参考音色，避免角色误绑。",
      );
      return;
    }
    update({
      referenceBindings: form.referenceBindings.filter(
        (b) => b.referenceId !== id,
      ),
    });
  };
  const voiceName = (id: string) =>
    voices.find((v) => v.id === id)?.name || "已绑定参考音色";
  const inspector = (
    <>
      <div className="inspector-tabs" role="tablist" aria-label="声音与输出">
        <button
          role="tab"
          aria-selected={tab === "voice"}
          onClick={() => setTab("voice")}
        >
          声音
        </button>
        <button
          role="tab"
          aria-selected={tab === "output"}
          onClick={() => setTab("output")}
        >
          输出
        </button>
      </div>
      {tab === "voice" ? (
        <div className="inspector-section">
          <label>
            描述你想要的声音
            <textarea
              aria-label="声音描述"
              value={voiceText}
              maxLength={200}
              placeholder="例如：温和沉静的讲述者，语速舒缓，像面对面聊天。"
              onChange={(e) => setVoiceText(e.target.value)}
            />
          </label>
          {voiceText.trim() ? (
            <button
              onClick={() => {
                edited.current = true;
                update({
                  templateApplication: null,
                  prompt:
                    "【角色：旁白（" +
                    voiceText.trim() +
                    "）】\n" +
                    form.prompt,
                });
                setVoiceText("");
              }}
            >
              写入脚本的角色描述
            </button>
          ) : null}
          <button
            className="voice-add"
            disabled={form.referenceBindings.length >= 3}
            onClick={() => setVoicesOpen(true)}
          >
            <Plus size={17} /> 添加参考音色{" "}
            <small>{form.referenceBindings.length}/3</small>
          </button>
          <div className="voice-list">
            {form.referenceBindings.map((binding, index) => (
              <div key={binding.referenceId} className="voice-row">
                <div>
                  <strong>{voiceName(binding.referenceId)}</strong>
                  <label className="voice-alias">
                    角色 @voice{index + 1}
                    <input
                      aria-label={"角色别名 " + (index + 1)}
                      placeholder={"角色" + (index + 1)}
                      maxLength={40}
                      value={binding.alias}
                      onChange={(e) =>
                        update({
                          referenceBindings: form.referenceBindings.map((b) =>
                            b.referenceId === binding.referenceId
                              ? { ...b, alias: e.target.value }
                              : b,
                          ),
                        })
                      }
                    />
                  </label>
                </div>
                <button
                  aria-label={"移除参考 " + (index + 1)}
                  onClick={() => removeVoice(binding.referenceId)}
                >
                  <X size={15} />
                </button>
              </div>
            ))}
          </div>
          <p className="hint">
            按文字描述，或使用你有授权的声音。参考片段只在本次生成确认后上传。
          </p>
        </div>
      ) : (
        <div className="inspector-section">
          <label className="range-field">
            <span>
              语速 <b>{form.params.rate.toFixed(1)}×</b>
            </span>
            <input
              aria-label="语速"
              type="range"
              min=".5"
              max="2"
              step=".1"
              value={form.params.rate}
              onChange={(e) =>
                update({
                  params: { ...form.params, rate: Number(e.target.value) },
                })
              }
            />
          </label>
          <label className="range-field">
            <span>
              音量 <b>{form.params.volume}</b>
            </span>
            <input
              aria-label="音量"
              type="range"
              min="0"
              max="100"
              value={form.params.volume}
              onChange={(e) =>
                update({
                  params: { ...form.params, volume: Number(e.target.value) },
                })
              }
            />
          </label>
          <label>
            声道
            <select
              aria-label="声道"
              value={form.params.channels}
              onChange={(e) =>
                update({
                  params: {
                    ...form.params,
                    channels: Number(e.target.value) as 1 | 2,
                  },
                })
              }
            >
              <option value={1}>单声道</option>
              <option value={2}>立体声</option>
            </select>
          </label>
        </div>
      )}
      <div className="common-output">
        <h3>常用输出设置</h3>
        <div className="compact-fields">
          <label>
            输出格式
            <select
              aria-label="输出格式"
              value={form.params.format}
              onChange={(e) =>
                update({
                  params: {
                    ...form.params,
                    format: e.target.value as "wav" | "mp3" | "pcm",
                  },
                })
              }
            >
              <option value="wav">WAV</option>
              <option value="mp3">MP3</option>
              <option value="pcm">PCM</option>
            </select>
          </label>
          <label>
            采样率
            <select
              aria-label="采样率"
              value={form.params.sampleRate}
              onChange={(e) =>
                update({
                  params: {
                    ...form.params,
                    sampleRate: Number(
                      e.target.value,
                    ) as typeof form.params.sampleRate,
                  },
                })
              }
            >
              {[8000, 16000, 24000, 44100, 48000].map((rate) => (
                <option key={rate} value={rate}>
                  {rate / 1000} kHz
                </option>
              ))}
            </select>
          </label>
        </div>
        <button className="advanced-trigger" onClick={() => setAdvanced(true)}>
          <SlidersHorizontal size={15} /> 高级设置
        </button>
        <p className="hint" style={{ marginTop: 10 }}>
          Seed {form.params.seed} ·{" "}
          {form.params.channels === 2 ? "立体声" : "单声道"} ·{" "}
          {form.params.rate.toFixed(1)}×
        </p>
      </div>
    </>
  );
  return (
    <div className="create-workbench">
      <div className="draft-heading">
        <label
          className="draft-name"
          style={{
            flexBasis: Math.min(
              510,
              Math.max(180, Array.from(form.name).length * 28 + 12),
            ),
          }}
        >
          <input
            aria-label="场景名称"
            value={form.name}
            maxLength={120}
            onChange={(e) => update({ name: e.target.value })}
          />
        </label>
        <span className="save-status" data-testid="save-state">
          <Check size={14} />
          {SAVE_STATE_LABELS[draft?.state || "clean"]}
        </span>
        <div className="draft-menu">
          <button
            className="icon-button quiet"
            aria-label="更多草稿操作"
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            <MoreHorizontal size={20} />
          </button>
          {menu ? (
            <div className="popover-menu">
              {onNewProject ? (
                <button
                  onClick={() => {
                    setMenu(false);
                    onNewProject();
                  }}
                >
                  <Plus size={16} />
                  新建空白草稿
                </button>
              ) : null}
              <button
                onClick={() => {
                  setMenu(false);
                  void draft?.saveNow();
                }}
              >
                保存草稿 · ⌘S
              </button>
            </div>
          ) : null}
        </div>
      </div>
      {draft?.conflict ? (
        <div className="inline-error" role="alert">
          {draft.message}
          <button onClick={() => void draft.resolveConflictByReload()}>
            载入最新版本
          </button>
          <button onClick={() => void draft.resolveConflictByCopy()}>
            另存为副本
          </button>
        </div>
      ) : null}
      {draft?.recovered ? (
        <div className="inline-info" role="status">
          发现上次未保存的本地副本。{" "}
          <button onClick={draft.applyRecovered}>恢复本地副本</button>{" "}
          <button onClick={draft.dismissRecovered}>丢弃</button>
        </div>
      ) : null}
      <ModeSelector value={form.mode} onChange={changeMode} />
      <section className="mode-context" aria-live="polite">
        <h2>{profile.title}</h2>
        <p>
          {profile.description}，{profile.detail.split("，")[0]}。
        </p>
      </section>
      <div className="workspace-frame">
        <div className="workbench-grid">
          <section className="prompt-studio">
            <div className="editor-header">
              <h3>创作脚本</h3>
              <PromptTagToolbar onInsert={applyTag} />
              <button
                className="mobile-inspector-trigger icon-button"
                aria-label="声音与输出设置"
                onClick={() => setMobileSettings(true)}
              >
                <SlidersHorizontal size={16} />
              </button>
            </div>
            <div className="editor-canvas">
              <textarea
                ref={editorRef}
                aria-label="场景提示词"
                value={form.prompt}
                placeholder="写下你想听见的场景、角色和对白，或从下方模板开始。"
                spellCheck={false}
                onChange={(e) => {
                  edited.current = true;
                  update({ prompt: e.target.value, templateApplication: null });
                }}
              />
              <span
                className={"char-count" + (remaining < 0 ? " is-error" : "")}
              >
                {count} / 3000
              </span>
            </div>
            <section className="inspiration-section">
              <span className="inspiration-heading">试试这些模板</span>
              <div className="template-rail">
                {visibleTemplates.map((t) => (
                  <button
                    className="template-card"
                    key={t.id}
                    onClick={() => {
                      setTemplateId(t.id);
                      setTemplatesOpen(true);
                    }}
                  >
                    {t.title}
                  </button>
                ))}
              </div>
              <button
                className="quiet template-all"
                onClick={() => setTemplatesOpen(true)}
              >
                查看全部
              </button>
              {undo ? (
                <button
                  className="icon-button quiet"
                  aria-label="撤销应用模板"
                  onClick={() => {
                    update(undo);
                    edited.current = undoEdited.current;
                    setUndo(null);
                  }}
                >
                  <Undo2 size={15} />
                </button>
              ) : null}
            </section>
          </section>
          <aside className="workbench-inspector">{inspector}</aside>
        </div>
        <div className="generation-command-bar">
          <OutputDirectoryPicker
            value={form.outputDirectoryId}
            onChange={(id) => update({ outputDirectoryId: id })}
          />
          {!credentialsReady ? (
            <p className="credential-warning">
              <a href="/settings">配置 API Key 与 Workspace ID</a>
            </p>
          ) : null}
          <div className="candidates">
            <span>生成候选</span>
            <div className="segmented">
              {[1, 2, 3].map((n) => (
                <button
                  key={n}
                  aria-label={n + " 个候选"}
                  aria-pressed={candidates === n}
                  onClick={() => setCandidates(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <button
            className="generate-button"
            disabled={
              !credentialsReady ||
              !form.prompt.trim() ||
              remaining < 0 ||
              submitting
            }
            onClick={() => void requestGeneration()}
          >
            <Waves size={19} />
            {submitting ? "正在处理…" : "生成音频"}
          </button>
        </div>
      </div>
      {error ? (
        <div className="inline-error" role="alert">
          {error}
        </div>
      ) : null}
      {advanced ? (
        <Modal title="高级输出设置" onClose={() => setAdvanced(false)}>
          <GenerationInspector
            value={form.params}
            onChange={(params) => update({ params })}
          />
          <div className="modal-actions">
            <button className="primary" onClick={() => setAdvanced(false)}>
              完成
            </button>
          </div>
        </Modal>
      ) : null}
      {mobileSettings ? (
        <Modal title="声音与输出" onClose={() => setMobileSettings(false)}>
          {inspector}
        </Modal>
      ) : null}
      {voicesOpen ? (
        <VoiceDrawer
          onClose={() => setVoicesOpen(false)}
          onSelect={(voice) => {
            setVoices((items) => [
              ...items.filter((v) => v.id !== voice.id),
              voice,
            ]);
            if (
              !form.referenceBindings.some((b) => b.referenceId === voice.id) &&
              form.referenceBindings.length < 3
            )
              update({
                referenceBindings: [
                  ...form.referenceBindings,
                  {
                    referenceId: voice.id,
                    alias: "角色" + (form.referenceBindings.length + 1),
                  },
                ],
              });
          }}
        />
      ) : null}
      <TemplatePicker
        initialTemplateId={templateId}
        open={templatesOpen}
        onClose={() => setTemplatesOpen(false)}
        mode={form.mode}
        currentPrompt={form.prompt}
        onApply={(choice) => {
          applyChoice(choice);
          setTemplatesOpen(false);
        }}
        referenceBindings={form.referenceBindings}
        currentParams={form.params}
      />
      {pendingTemplate ? (
        <Modal title="应用灵感模板" onClose={() => setPendingTemplate(null)}>
          <p>将替换当前脚本，声音和输出参数默认保留。应用后可以撤销。</p>
          <div className="prompt-preview">{pendingTemplate.prompt}</div>
          <div className="modal-actions">
            <button onClick={() => setPendingTemplate(null)}>
              保留当前内容
            </button>
            <button
              className="primary"
              onClick={() => applyChoice(pendingTemplate)}
            >
              确认应用
            </button>
          </div>
        </Modal>
      ) : null}
      {confirmation ? (
        <Modal
          title={initialReferences.length ? "确认上传参考音频" : "确认生成"}
          onClose={() => {
            if (!submitting) setConfirmation(null);
          }}
        >
          <div className="generation-confirm-summary">
            <p>
              本次生成{" "}
              <strong>
                {confirmation.payload.candidate_seeds?.length || 1} 个候选
              </strong>
              ，将产生对应次数的阿里云模型调用与费用。
            </p>
            <p className="hint">
              Seed：{confirmation.payload.candidate_seeds?.join(" / ")} · 编译后{" "}
              {confirmation.preview.compiled_chars} / 3000 字符
            </p>
            <div className="prompt-preview">
              {confirmation.preview.compiled_prompt}
            </div>
            {form.referenceBindings.length || initialReferences.length ? (
              <div>
                <strong>本次上传至阿里云的参考音频</strong>
                <ul>
                  {form.referenceBindings.map((b) => {
                    const ref =
                      confirmation.preview.reference_snapshot?.find(
                        (r) => r.reference_id === b.referenceId,
                      ) || voices.find((r) => r.id === b.referenceId);
                    return (
                      <li key={b.referenceId}>
                        {ref?.name || voiceName(b.referenceId)} · {b.alias}
                        {ref
                          ? " · " + ref.duration_seconds.toFixed(1) + " 秒"
                          : ""}
                      </li>
                    );
                  })}
                  {initialReferences.map((r) => (
                    <li key={r.id}>
                      {r.name} · {r.duration_seconds} 秒
                    </li>
                  ))}
                </ul>
                <p className="hint">
                  确认即表示你有权使用这些声音，并同意仅用于本次生成。
                </p>
              </div>
            ) : null}
            {error ? (
              <p role="alert" className="error">
                {error}
              </p>
            ) : null}
            <div className="modal-actions">
              <button
                disabled={submitting}
                onClick={() => setConfirmation(null)}
              >
                返回编辑
              </button>
              <button
                className="primary"
                disabled={submitting}
                onClick={() => void submit()}
              >
                {submitting
                  ? "正在提交…"
                  : initialReferences.length
                    ? "确认上传并生成"
                    : "确认并生成"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
