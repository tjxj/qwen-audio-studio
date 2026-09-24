import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  ExternalLink,
  KeyRound,
  Loader2,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import {
  ApiError,
  deleteCredentials,
  getDiagnostics,
  getSettings,
  patchCredentials,
  patchSettings,
  type Diagnostics,
  type SettingsPayload,
} from "../../api";
import type { CredentialStatus } from "../../types";
import { applyTheme, normalizeTheme, type ThemePreference } from "../../theme";
import { helpLinks, modelBoundary } from "../../config/helpLinks";
import { StorageSettings } from "./StorageSettings";

type Feedback = { kind: "success" | "error" | "info"; text: string } | null;

type Busy =
  | ""
  | "api-key"
  | "workspace"
  | "appearance"
  | "clear"
  | "diagnostics";

const SCRIPT_FONTS = [
  { value: "serif", label: "宋体阅读（思源宋体）" },
  { value: "sans", label: "系统无衬线" },
];
const FONT_SIZES = [14, 16, 18];
const THEME_OPTIONS: Array<{ value: ThemePreference; label: string }> = [
  { value: "system", label: "跟随系统" },
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
];

function errorText(reason: unknown, fallback: string) {
  if (reason instanceof ApiError) return reason.message;
  return reason instanceof Error ? reason.message : fallback;
}

export default function SettingsPage(props: {
  status: CredentialStatus;
  ready: boolean;
  refreshStatus: () => void | Promise<void>;
}) {
  const { status, ready, refreshStatus } = props;
  const [apiKey, setApiKey] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [revealApiKey, setRevealApiKey] = useState(false);
  const [revealWorkspace, setRevealWorkspace] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [busy, setBusy] = useState<Busy>("");
  const [settings, setSettings] = useState<Awaited<
    ReturnType<typeof getSettings>
  > | null>(null);
  const [font, setFont] = useState("serif");
  const [fontSize, setFontSize] = useState(16);
  const [workers, setWorkers] = useState(2);
  const [theme, setTheme] = useState<ThemePreference>("system");
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [tab, setTab] = useState("connection");
  useEffect(()=>{const sync=(event:Event)=>{const settings=(event as CustomEvent<SettingsPayload>).detail;if(settings?.revision){setSettings(settings);setTheme(normalizeTheme(settings.theme))}};window.addEventListener('qwen-theme-updated',sync);return()=>window.removeEventListener('qwen-theme-updated',sync)},[]);

  useEffect(() => {
    getSettings()
      .then((value) => {
        setSettings(value);
        setFont(value.script_font);
        setFontSize(value.script_font_size);
        setWorkers(value.max_workers);
        setTheme(normalizeTheme(value.theme));
      })
      .catch((reason) =>
        setFeedback({ kind: "error", text: errorText(reason, "读取设置失败") }),
      );
  }, []);

  const saveField = useCallback(
    async (field: "api-key" | "workspace") => {
      setBusy(field);
      setFeedback(null);
      try {
        if (field === "api-key") {
          await patchCredentials({ apiKey });
          setApiKey("");
        } else {
          await patchCredentials({ workspaceId });
          setWorkspaceId("");
        }
        const session = await getSettings().catch(() => null);
        if (session) setSettings(session);
        await refreshStatus();
        setFeedback({ kind: "success", text: "已写入 macOS 钥匙串。" });
      } catch (reason) {
        setFeedback({ kind: "error", text: errorText(reason, "凭据保存失败") });
      } finally {
        setBusy("");
      }
    },
    [apiKey, workspaceId, refreshStatus],
  );

  const saveTheme = useCallback(
    async (next: ThemePreference) => {
      setTheme(next);
      applyTheme(next);
      if (!settings) return;
      try {
        setSettings(
          await patchSettings({
            expected_revision: settings.revision,
            theme: next,
          }),
        );
      } catch (reason) {
        setFeedback({
          kind: "error",
          text: errorText(reason, "主题设置保存失败"),
        });
      }
    },
    [settings],
  );

  const saveAppearance = useCallback(async () => {
    if (!settings) return;
    setBusy("appearance");
    setFeedback(null);
    try {
      const next = await patchSettings({
        expected_revision: settings.revision,
        script_font: font,
        script_font_size: fontSize,
        max_workers: workers,
        theme,
      });
      setSettings(next);
      setFeedback({ kind: "success", text: "外观与并发设置已保存。" });
    } catch (reason) {
      if (reason instanceof ApiError && reason.code === "REVISION_CONFLICT") {
        const fresh = await getSettings().catch(() => null);
        if (fresh) setSettings(fresh);
        setFeedback({
          kind: "error",
          text: "设置已在别处修改，已载入最新版本。",
        });
      } else {
        setFeedback({ kind: "error", text: errorText(reason, "设置保存失败") });
      }
    } finally {
      setBusy("");
    }
  }, [settings, font, fontSize, workers, theme]);

  const clear = useCallback(
    async (scope: "all" | "api_key" | "workspace_id") => {
      setBusy("clear");
      setFeedback(null);
      try {
        await deleteCredentials(scope);
        await refreshStatus();
        setFeedback({ kind: "success", text: "凭据已从钥匙串清除。" });
      } catch (reason) {
        setFeedback({ kind: "error", text: errorText(reason, "清除失败") });
      } finally {
        setBusy("");
        setConfirmClear(false);
      }
    },
    [refreshStatus],
  );

  const runDiagnostics = useCallback(async () => {
    setBusy("diagnostics");
    setFeedback(null);
    try {
      setDiagnostics(await getDiagnostics());
    } catch (reason) {
      setFeedback({ kind: "error", text: errorText(reason, "本地检查未完成") });
    } finally {
      setBusy("");
    }
  }, []);

  return (
    <section className="settings-page">
      <header>
        <div>
          <h1>设置</h1>
          <p>为你的创作习惯，留一点偏好。</p>
        </div>
      </header>
      {feedback ? (
        <p className={`settings-feedback is-${feedback.kind}`} role="status">
          {feedback.kind === "success" ? (
            <CheckCircle2 size={16} />
          ) : (
            <AlertCircle size={16} />
          )}
          {feedback.text}
        </p>
      ) : null}

      <div className="page-tabs" role="tablist" aria-label="设置分类">
        {[
          ["connection", "百炼连接"],
          ["storage", "文件与存储"],
          ["appearance", "外观"],
        ].map(([value, label]) => (
          <button
            key={value}
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="settings-content">
        <div hidden={tab !== "connection"} className="connection-layout">
          <div className="settings-group">
            <h2>百炼连接</h2>
            <p className="settings-note">
              应用在本机运行；生成时文本和已确认的参考音频会发送至阿里云百炼。
              模型 {modelBoundary.id} 需在{modelBoundary.region}
              开通后才会返回结果。
            </p>

            <Field
              label="API Key"
              value={apiKey}
              configured={status.apiKeyConfigured}
              revealed={revealApiKey}
              busy={busy === "api-key"}
              ready={ready}
              helpHref={helpLinks.apiKey}
              helpText="如何获取 API Key"
              onChange={setApiKey}
              onToggleReveal={() => setRevealApiKey((value) => !value)}
              onSave={() => void saveField("api-key")}
            />

            <Field
              label="业务空间 ID（Workspace ID）"
              value={workspaceId}
              configured={status.workspaceConfigured}
              revealed={revealWorkspace}
              busy={busy === "workspace"}
              ready={ready}
              helpHref={helpLinks.workspaceId}
              helpText="如何获取 Workspace ID"
              onChange={setWorkspaceId}
              onToggleReveal={() => setRevealWorkspace((value) => !value)}
              onSave={() => void saveField("workspace")}
            />

            <div className="credential-status">
              <span className={status.apiKeyConfigured ? "ready" : ""}>
                API Key {status.apiKeyConfigured ? "已配置" : "未配置"}
              </span>
              <span className={status.workspaceConfigured ? "ready" : ""}>
                Workspace ID {status.workspaceConfigured ? "已配置" : "未配置"}
              </span>
            </div>
            <p className="settings-hint">
              Workspace ID 需要在控制台手动查看，本应用不会代为查询账号信息。
            </p>

            <div className="settings-actions">
              <a
                className="text-link"
                href={helpLinks.console}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink size={14} /> 打开百炼控制台
              </a>
              {confirmClear ? (
                <span className="confirm-inline">
                  <span>确认清除已保存凭据？</span>
                  <button
                    type="button"
                    disabled={busy !== ""}
                    onClick={() => void clear("all")}
                  >
                    确认清除
                  </button>
                  <button type="button" onClick={() => setConfirmClear(false)}>
                    取消
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  disabled={
                    !ready ||
                    busy !== "" ||
                    (!status.apiKeyConfigured && !status.workspaceConfigured)
                  }
                  onClick={() => setConfirmClear(true)}
                >
                  <Trash2 size={15} /> 清除凭据
                </button>
              )}
            </div>
          </div>

          <div className="settings-group">
            <h2>本地环境检查</h2>
            <p className="settings-note">
              只检查依赖与配置是否就绪，不调用模型，也不会产生费用。
            </p>
            <button
              type="button"
              disabled={busy !== ""}
              onClick={() => void runDiagnostics()}
            >
              {busy === "diagnostics" ? (
                <Loader2 size={15} className="spin" />
              ) : (
                <SlidersHorizontal size={15} />
              )}
              运行本地检查
            </button>
            {diagnostics ? (
              <ul className="diagnostics-list">
                {Object.entries(diagnostics.tools).map(([name, tool]) => (
                  <li key={name}>
                    {tool.available ? "✓" : "✕"} {name}
                    {tool.available ? " 可用" : " 未找到，请安装后重试"}
                  </li>
                ))}
                <li>
                  {diagnostics.storage.data_root_writable ? "✓" : "✕"}{" "}
                  数据目录可写
                </li>
                <li>
                  {diagnostics.credentials.api_key_configured ? "✓" : "✕"} API
                  Key 已配置
                </li>
                <li>
                  {diagnostics.credentials.workspace_configured ? "✓" : "✕"}{" "}
                  Workspace ID 已配置
                </li>
                <li className="muted">
                  未检查：{diagnostics.not_checked.join("、")}
                </li>
              </ul>
            ) : null}
            <p className="settings-hint">
              短音频实测会产生真实云端调用与费用，需在创作台完成一次已确认的生成任务；
              本期设置页不提供隐藏的免费授权探测。
            </p>
          </div>
        </div>
        {tab === "storage" ? (
          <StorageSettings settings={settings} onSaved={setSettings} />
        ) : null}
        <div hidden={tab !== "appearance"}>
          <div className="settings-group">
            <h2>外观</h2>
            <p className="settings-note">界面保持轻盈，阅读由你决定。</p>
            <div className="appearance-grid">
              <label className="settings-field">
                <span>主题</span>
                <select
                  aria-label="主题"
                  value={theme}
                  onChange={(event) =>
                    void saveTheme(event.target.value as ThemePreference)
                  }
                >
                  {THEME_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="settings-field">
                <span>脚本字体</span>
                <select
                  aria-label="脚本字体"
                  value={font}
                  onChange={(event) => setFont(event.target.value)}
                >
                  {SCRIPT_FONTS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="settings-field">
                <span>脚本字号</span>
                <select
                  aria-label="脚本字号"
                  value={fontSize}
                  onChange={(event) => setFontSize(Number(event.target.value))}
                >
                  {FONT_SIZES.map((size) => (
                    <option key={size} value={size}>
                      {size}px
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div
              className="font-preview"
              style={{
                fontFamily:
                  font === "serif" ? "var(--font-serif)" : "var(--font-ui)",
                fontSize,
              }}
            >
              把一段文字，变成值得被听见的故事。
              <br />
              声音的温度，藏在每一次恰好的停顿里。
            </div>
            <div className="settings-actions">
              <button
                type="button"
                disabled={busy !== "" || !settings}
                onClick={() => void saveAppearance()}
              >
                {busy === "appearance" ? (
                  <Loader2 size={15} className="spin" />
                ) : null}
                保存外观设置
              </button>
            </div>
          </div>

          <div className="settings-group">
            <h2>高级</h2>
            <label className="settings-field">
              <span>并发任务数</span>
              <select
                aria-label="并发任务数"
                value={workers}
                onChange={(event) => setWorkers(Number(event.target.value))}
              >
                {[1, 2].map((count) => (
                  <option key={count} value={count}>
                    {count}
                  </option>
                ))}
              </select>
            </label>
            <p className="settings-hint">
              并发设置随“保存外观设置”一起保存；同时最多执行两个任务。
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Field(props: {
  label: string;
  value: string;
  configured: boolean;
  revealed: boolean;
  busy: boolean;
  ready: boolean;
  helpHref: string;
  helpText: string;
  onChange: (value: string) => void;
  onToggleReveal: () => void;
  onSave: () => void;
}) {
  return (
    <div className="settings-field-row">
      <label className="settings-field">
        <span>
          {props.label}
          {props.configured ? <em className="configured">已配置</em> : null}
        </span>
        <div className="credential-input">
          <input
            aria-label={props.label}
            type={props.revealed ? "text" : "password"}
            value={props.value}
            autoComplete="off"
            spellCheck={false}
            placeholder={props.configured ? "留空表示不修改" : "输入后保存"}
            onChange={(event) => props.onChange(event.target.value)}
          />
          <button
            type="button"
            aria-label={`${props.revealed ? "隐藏" : "显示"}${props.label.split("（")[0]}`}
            onClick={props.onToggleReveal}
          >
            {props.revealed ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
      </label>
      <div className="field-tools">
        <a href={props.helpHref} target="_blank" rel="noopener noreferrer">
          <ExternalLink size={13} /> {props.helpText}
        </a>
      </div>
      <button
        type="button"
        aria-label={`保存${props.label.split("（")[0]}`}
        className="primary"
        disabled={!props.ready || props.busy || !props.value.trim()}
        onClick={props.onSave}
      >
        {props.busy ? <Loader2 size={15} className="spin" /> : null}
        保存
      </button>
    </div>
  );
}
