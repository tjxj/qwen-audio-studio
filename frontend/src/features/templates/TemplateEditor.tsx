import { useMemo, useState } from "react";
import type { CreationMode } from "../../types";
import {
  createTemplate,
  updateTemplate,
  type StudioTemplate,
  type TemplateVariable,
  type EditableTemplate,
} from "./templatesApi";
import { TemplateDialog } from "./TemplateDialog";

export const TEMPLATE_MODE_LABELS: Record<CreationMode, string> = {
  podcast: "播客",
  advertisement: "广告",
  audiobook: "有声书",
  drama: "广播剧",
  game: "游戏配音",
  narration: "旁白",
  auto: "自定义",
};
export function TemplateEditor({
  initial,
  duplicate = false,
  onClose,
  onSaved,
}: {
  initial?: StudioTemplate;
  duplicate?: boolean;
  onClose: () => void;
  onSaved: (template: StudioTemplate) => void;
}) {
  const [name, setName] = useState(
    initial ? `${initial.name}${duplicate ? " · 副本" : ""}` : "",
  );
  const [mode, setMode] = useState<CreationMode>(initial?.mode || "podcast");
  const [description, setDescription] = useState(initial?.description || "");
  const [tags, setTags] = useState(initial?.tags.join("、") || "");
  const [prompt, setPrompt] = useState(
    initial?.prompt_pattern ||
      "【角色：旁白（自然、温和）】\n【对白：旁白】欢迎来到{{show}}。",
  );
  const [definitions, setDefinitions] = useState<
    Record<string, TemplateVariable>
  >(() =>
    Object.fromEntries(
      (
        initial?.variables || [
          {
            key: "show",
            label: "节目名称",
            type: "text" as const,
            required: true,
            default: "我的节目",
            max_length: 80,
          },
        ]
      ).map((variable) => [variable.key, variable]),
    ),
  );
  const [roles, setRoles] = useState(initial?.role_count ?? 1);
  const [duration, setDuration] = useState(
    initial?.suggested_duration_seconds
      ? String(initial.suggested_duration_seconds)
      : "",
  );
  const [presetEnabled, setPresetEnabled] = useState(
    Boolean(initial?.params_preset),
  );
  const [preset, setPreset] = useState<Record<string, unknown>>(
    initial?.params_preset || { format: "wav", sample_rate: 48000, rate: 1 },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const variableKeys = useMemo(
    () =>
      Array.from(
        new Set(
          Array.from(
            prompt.matchAll(/\{\{\s*([A-Za-z][A-Za-z0-9_]{0,39})\s*\}\}/g),
            (match) => match[1],
          ),
        ),
      ),
    [prompt],
  );
  function variableFor(key: string): TemplateVariable {
    return (
      definitions[key] || {
        key,
        label: key,
        type: "text",
        required: true,
        default: "",
        max_length: 80,
      }
    );
  }
  function editVariable(key: string, change: Partial<TemplateVariable>) {
    setDefinitions({
      ...definitions,
      [key]: { ...variableFor(key), ...change },
    });
  }
  async function save() {
    setBusy(true);
    setError("");
    const payload: EditableTemplate = {
      name,
      mode,
      description,
      tags: tags
        .split(/[、,，]/)
        .map((x) => x.trim())
        .filter(Boolean),
      prompt_pattern: prompt,
      variables: variableKeys.map(variableFor),
      role_count: roles,
      suggested_duration_seconds: duration ? Number(duration) : null,
      params_preset: presetEnabled ? preset : null,
    };
    try {
      const result =
        initial && !duplicate
          ? await updateTemplate(initial.id, payload)
          : await createTemplate(payload);
      onSaved(result);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "模板保存失败，请重试。",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <TemplateDialog
      title={initial && !duplicate ? "编辑自建模板" : "创建自己的模板"}
      onClose={() => !busy && onClose()}
      wide
    >
      <form
        className="tpl-editor-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="tpl-editor-scroll">
          <div className="tpl-editor-top">
            <label>
              模板名称
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                maxLength={80}
                placeholder="为这个声音场景起个名字"
              />
            </label>
            <label>
              创作模式
              <select
                value={mode}
                onChange={(event) =>
                  setMode(event.target.value as CreationMode)
                }
              >
                {Object.entries(TEMPLATE_MODE_LABELS).map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            一句话介绍
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={300}
              placeholder="说明适合什么场景"
            />
          </label>
          <label>
            脚本模板
            <textarea
              rows={9}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              required
              maxLength={3000}
            />
            <span className="tpl-footnote">
              使用 {"{{变量名}}"}{" "}
              添加可替换内容，变量名使用英文字母。请勿填写凭据或音频数据。
            </span>
          </label>
          {variableKeys.length ? (
            <div className="tpl-editor-variables">
              <h3>可替换变量</h3>
              {variableKeys.map((key) => {
                const variable = variableFor(key);
                return (
                  <div className="tpl-variable-editor" key={key}>
                    <span className="tpl-variable-key">{`{{${key}}}`}</span>
                    <label>
                      显示名称
                      <input
                        value={variable.label}
                        onChange={(event) =>
                          editVariable(key, { label: event.target.value })
                        }
                        maxLength={80}
                      />
                    </label>
                    <label>
                      类型
                      <select
                        value={variable.type}
                        onChange={(event) =>
                          editVariable(key, {
                            type: event.target
                              .value as TemplateVariable["type"],
                            default: event.target.value === "number" ? 1 : "",
                            ...(event.target.value === "select"
                              ? {
                                  options: ["选项一", "选项二"],
                                  default: "选项一",
                                }
                              : {}),
                          })
                        }
                      >
                        <option value="text">文本</option>
                        <option value="number">数字</option>
                        <option value="select">选项</option>
                      </select>
                    </label>
                    <label>
                      默认值
                      <input
                        required
                        value={variable.default}
                        type={variable.type === "number" ? "number" : "text"}
                        maxLength={variable.max_length || 200}
                        onChange={(event) =>
                          editVariable(key, {
                            default:
                              variable.type === "number"
                                ? Number(event.target.value)
                                : event.target.value,
                          })
                        }
                      />
                    </label>
                    {variable.type === "select" ? (
                      <label className="tpl-full-field">
                        可选值（以顿号分隔）
                        <input
                          value={variable.options?.join("、") || ""}
                          onChange={(event) =>
                            editVariable(key, {
                              options: event.target.value
                                .split(/[、,，]/)
                                .filter(Boolean),
                            })
                          }
                        />
                      </label>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}
          <div className="tpl-editor-meta">
            <label>
              角色数
              <select
                value={roles}
                onChange={(event) => setRoles(Number(event.target.value))}
              >
                {[0, 1, 2, 3].map((count) => (
                  <option key={count} value={count}>
                    {count === 0 ? "无人声" : `${count} 人`}
                  </option>
                ))}
              </select>
            </label>
            <label>
              建议时长（秒）
              <input
                type="number"
                min={1}
                max={600}
                value={duration}
                onChange={(event) => setDuration(event.target.value)}
                placeholder="可选"
              />
            </label>
            <label>
              标签
              <input
                value={tags}
                onChange={(event) => setTags(event.target.value)}
                placeholder="旅行、单人"
              />
            </label>
          </div>
          <div className="tpl-editor-preset">
            <label className="tpl-check">
              <input
                type="checkbox"
                checked={presetEnabled}
                onChange={(event) => setPresetEnabled(event.target.checked)}
              />
              附带输出参数预设（使用模板时可选）
            </label>
            {presetEnabled ? (
              <div className="tpl-editor-meta">
                <label>
                  输出格式
                  <select
                    value={String(preset.format || "wav")}
                    onChange={(event) =>
                      setPreset({ ...preset, format: event.target.value })
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
                    value={Number(preset.sample_rate || 48000)}
                    onChange={(event) =>
                      setPreset({
                        ...preset,
                        sample_rate: Number(event.target.value),
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
                <label>
                  语速
                  <input
                    type="number"
                    min={0.5}
                    max={2}
                    step={0.1}
                    value={Number(preset.rate || 1)}
                    onChange={(event) =>
                      setPreset({ ...preset, rate: Number(event.target.value) })
                    }
                  />
                </label>
              </div>
            ) : null}
          </div>
        </div>
        {error ? (
          <p className="tpl-warning" role="alert">
            {error}
          </p>
        ) : null}
        <div className="tpl-dialog-actions">
          <span className="tpl-footnote">保存在本机，随时可编辑</span>
          <button type="button" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button type="submit" className="tpl-primary" disabled={busy}>
            {busy ? "正在保存…" : "保存模板"}
          </button>
        </div>
      </form>
    </TemplateDialog>
  );
}
