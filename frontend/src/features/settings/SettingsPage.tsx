import {KeyRound, Save, ShieldCheck, Trash2} from "lucide-react";
import {useState} from "react";
import type {CredentialStatus} from "../../types";

export default function SettingsPage({
  status,
  ready = true,
  onSave,
  onClear
}: {
  status: CredentialStatus;
  ready?: boolean;
  onSave: (apiKey: string, workspaceId: string) => Promise<void>;
  onClear: () => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [saved, setSaved] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    await onSave(apiKey, workspaceId);
    setApiKey("");
    setWorkspaceId("");
    setSaved(true);
  };

  return (
    <section className="settings-page">
      <header><div><span>只保存在此设备</span><h1>设置</h1></div><KeyRound size={25} /></header>
      <div className="security-summary">
        <ShieldCheck size={20} />
        <div><strong>macOS 钥匙串保护</strong><p>凭据不会进入浏览器存储、项目文件、日志或生成报告。</p></div>
      </div>
      <form onSubmit={(event) => void submit(event)}>
        <label><span>API Key</span><input aria-label="API Key" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={status.apiKeyConfigured ? "已配置，输入新值可替换" : "输入北京地域 API Key"} required /></label>
        <label><span>Workspace ID</span><input aria-label="Workspace ID" type="password" value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)} placeholder={status.workspaceConfigured ? "已配置，输入新值可替换" : "输入业务空间 ID"} required /></label>
        <div className="credential-status">
          <span className={status.apiKeyConfigured ? "ready" : ""}>API Key {status.apiKeyConfigured ? "已配置" : "未配置"}</span>
          <span className={status.workspaceConfigured ? "ready" : ""}>Workspace ID {status.workspaceConfigured ? "已配置" : "未配置"}</span>
        </div>
        {saved ? <p className="save-confirmation">凭据已写入 macOS 钥匙串。</p> : null}
        <div className="settings-actions">
          <button type="button" onClick={onClear} disabled={!ready}><Trash2 size={15} />清除凭据</button>
          <button type="submit" className="primary" disabled={!ready}><Save size={15} />{ready ? "保存到 macOS 钥匙串" : "正在建立安全会话…"}</button>
        </div>
      </form>
    </section>
  );
}
