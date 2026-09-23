import {FolderOpen, ShieldCheck, Waves} from "lucide-react";

export function GenerationCommandBar({
  referenceCount,
  disabled,
  busy,
  credentialsReady,
  onGenerate
}: {
  referenceCount: number;
  disabled: boolean;
  busy: boolean;
  credentialsReady: boolean;
  onGenerate: () => void;
}) {
  return (
    <div className="generation-command-bar">
      <div className="upload-status">
        <ShieldCheck size={19} />
        <div>
          <strong>{referenceCount} 条参考音频将上传</strong>
          <span>生成完成后清理临时副本</span>
        </div>
      </div>
      {!credentialsReady ? (
        <p className="credential-warning">请先在设置中配置 API Key 与 Workspace ID</p>
      ) : null}
      <div className="output-folder">
        <span>输出文件夹</span>
        <span className="output-path"><FolderOpen size={16} /> 本地默认目录</span>
      </div>
      <button
        type="button"
        className="generate-button"
        disabled={disabled || busy}
        onClick={onGenerate}
      >
        <Waves size={20} />
        {busy ? "正在提交…" : "生成音频"}
      </button>
    </div>
  );
}
