import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Copy, PencilLine, Trash2 } from "lucide-react";
import type { GenerationParams, ReferenceBinding } from "../../types";
import {
  choiceFromPreview,
  previewTemplate,
  type StudioTemplate,
  type TemplateChoice,
} from "./templatesApi";
import { TemplateDialog } from "./TemplateDialog";

const EMPTY_BINDINGS: ReferenceBinding[] = [];
export function TemplatePreviewPanel({
  template,
  currentPrompt = "",
  onApply,
  onEdit,
  onCopy,
  onDelete,
  referenceBindings = EMPTY_BINDINGS,
  currentParams,
}: {
  template: StudioTemplate;
  currentPrompt?: string;
  onApply: (choice: TemplateChoice) => void | Promise<void>;
  onEdit?: () => void;
  onCopy?: () => void;
  onDelete?: () => void;
  referenceBindings?: ReferenceBinding[];
  currentParams?: GenerationParams;
}) {
  const [values, setValues] = useState<Record<string, string | number>>(() =>
    Object.fromEntries(template.variables.map((v) => [v.key, v.default])),
  );
  const [applyParams, setApplyParams] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [debounced, setDebounced] = useState(values);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(values), 180);
    return () => window.clearTimeout(timer);
  }, [values]);
  const pending = values !== debounced;
  const preview = useQuery({
    queryKey: [
      "template-preview",
      template.id,
      template.version,
      debounced,
      referenceBindings,
      applyParams,
      currentParams,
    ],
    queryFn: () =>
      previewTemplate(
        template.id,
        debounced,
        referenceBindings,
        applyParams,
        currentParams,
      ),
    retry: false,
    staleTime: 30_000,
  });
  async function apply() {
    if (
      !preview.data ||
      !preview.data.can_apply ||
      pending ||
      preview.isFetching
    )
      return;
    setBusy(true);
    setError("");
    try {
      await onApply(choiceFromPreview(template, preview.data));
      setConfirm(false);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "应用未完成，请重试。",
      );
    } finally {
      setBusy(false);
    }
  }
  const PARAM_NAMES: Record<string, string> = {
    format: "格式",
    sample_rate: "采样率",
    channels: "声道",
    volume: "音量",
    rate: "语速",
    seed: "Seed",
    enable_cbr: "固定码率",
    bit_rate: "码率",
    quality: "质量",
    enable_aigc_tag: "AIGC 标记",
  };
  return (
    <section className="tpl-preview" aria-label="模板预览">
      <div className="tpl-preview-heading">
        <span className="tpl-eyebrow">编辑变量 · 预览脚本</span>
        <h2>{template.name}</h2>
        <p>{template.description}</p>
      </div>
      <div className="tpl-preview-scroll">
        {template.variables.length > 0 ? (
          <div className="tpl-variable-fields">
            {template.variables.map((variable) => (
              <label key={variable.key}>
                <span>{variable.label || variable.key}</span>
                {variable.type === "select" ? (
                  <select
                    value={values[variable.key]}
                    onChange={(event) =>
                      setValues({
                        ...values,
                        [variable.key]: event.target.value,
                      })
                    }
                  >
                    {variable.options?.map((option) => (
                      <option key={option}>{option}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={variable.type === "number" ? "number" : "text"}
                    value={values[variable.key] ?? ""}
                    maxLength={variable.max_length}
                    min={variable.min}
                    max={variable.max}
                    required={variable.required}
                    onChange={(event) =>
                      setValues({
                        ...values,
                        [variable.key]:
                          variable.type === "number" &&
                          event.target.value !== ""
                            ? Number(event.target.value)
                            : event.target.value,
                      })
                    }
                  />
                )}
              </label>
            ))}
          </div>
        ) : null}
        <div className="tpl-script-header">
          <span>完整脚本</span>
          <span>
            {pending || preview.isFetching
              ? "正在更新…"
              : preview.data
                ? `${preview.data.compiled_chars} / 3000 字（含指令）`
                : "预览待就绪"}
          </span>
        </div>
        <div
          className={`tpl-script ${pending || preview.isFetching ? "tpl-script-pending" : ""}`}
          aria-live="polite"
        >
          {preview.error ? (
            <p role="alert">{preview.error.message}</p>
          ) : preview.data ? (
            preview.data.prompt
          ) : (
            "正在准备完整脚本…"
          )}
        </div>
        {preview.data?.missing_roles.length ? (
          <p className="tpl-warning">
            尚未绑定 {preview.data.missing_roles.join("、")}
            ，请回创作台选择参考音色。
          </p>
        ) : null}
        {template.params_preset &&
        Object.keys(template.params_preset).length > 0 ? (
          <div className="tpl-preset">
            <label className="tpl-check">
              <input
                type="checkbox"
                checked={applyParams}
                onChange={(event) => setApplyParams(event.target.checked)}
              />
              同时应用输出参数预设
            </label>
            <p>
              {Object.entries(preview.data?.params_diff || {})
                .map(
                  ([key, value]) =>
                    `${PARAM_NAMES[key] || key}：${String(value.to)}`,
                )
                .join(" · ")}
            </p>
          </div>
        ) : null}
      </div>
      <footer className="tpl-preview-footer">
        <div className="tpl-template-tools">
          {onCopy ? (
            <button type="button" className="tpl-text-button" onClick={onCopy}>
              <Copy size={14} />
              复制为自建
            </button>
          ) : null}
          {onEdit && template.source === "user" ? (
            <button type="button" className="tpl-text-button" onClick={onEdit}>
              <PencilLine size={14} />
              编辑
            </button>
          ) : null}
          {onDelete && template.source === "user" ? (
            <button
              type="button"
              className="tpl-text-button"
              onClick={onDelete}
            >
              <Trash2 size={14} />
              删除
            </button>
          ) : null}
        </div>
        {error ? (
          <p role="alert" className="tpl-warning">
            {error}
          </p>
        ) : null}
        <button
          className="tpl-primary"
          type="button"
          disabled={
            busy || pending || preview.isFetching || !preview.data?.can_apply
          }
          onClick={() =>
            currentPrompt.trim() && currentPrompt !== preview.data?.prompt
              ? setConfirm(true)
              : void apply()
          }
        >
          {busy ? "正在应用…" : "应用到创作台"}
          <ArrowUpRight size={17} />
        </button>
        <p className="tpl-footnote">保留当前音色与输出设置 · 应用后可撤销</p>
      </footer>
      {confirm ? (
        <TemplateDialog
          title="替换当前文案？"
          onClose={() => !busy && setConfirm(false)}
        >
          <div className="tpl-confirm-content">
            <p>当前脚本已有内容。应用模板会替换文案，音色与输出目录会保留。</p>
            <p>应用后可在创作台撤销这次替换。</p>
          </div>
          <div className="tpl-dialog-actions">
            <button
              type="button"
              onClick={() => setConfirm(false)}
              disabled={busy}
            >
              保留原文
            </button>
            <button
              type="button"
              className="tpl-primary"
              onClick={() => void apply()}
              disabled={busy}
            >
              {busy ? "正在应用…" : "确认替换"}
            </button>
          </div>
        </TemplateDialog>
      ) : null}
    </section>
  );
}

export function TemplatePreviewDialog(
  props: React.ComponentProps<typeof TemplatePreviewPanel> & {
    onClose: () => void;
  },
) {
  return (
    <TemplateDialog title="模板预览" onClose={props.onClose}>
      <TemplatePreviewPanel {...props} />
    </TemplateDialog>
  );
}
