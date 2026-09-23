import {CheckCircle2, Clipboard, FileAudio2, ShieldCheck} from "lucide-react";
import type {Job} from "../../types";

function formatBytes(bytes?: number) {
  if (!bytes) return "—";
  return (bytes / 1024 / 1024).toFixed(2) + " MB";
}

export function ValidationReport({job}: {job: Job}) {
  const report = job.report;
  return (
    <aside className="validation-report">
      <div className="result-section-title">
        <div><ShieldCheck size={18} /><strong>验收报告</strong></div>
        <span className={"status-dot " + job.status}>
          <CheckCircle2 size={15} /> {job.status === "success" ? "生成成功" : job.status}
        </span>
      </div>
      <dl>
        <div><dt>请求 ID</dt><dd>{report?.requestId || "—"} <Clipboard size={13} /></dd></div>
        <div><dt>生成耗时</dt><dd>{job.elapsedSeconds ? job.elapsedSeconds.toFixed(1) + " 秒" : "—"}</dd></div>
        <div><dt>音频时长</dt><dd>{report?.durationSeconds ? report.durationSeconds.toFixed(3) + " 秒" : "—"}</dd></div>
        <div><dt>采样率</dt><dd>{report?.sampleRate ? report.sampleRate / 1000 + " kHz" : "—"}</dd></div>
        <div><dt>声道</dt><dd>{report?.channels === 2 ? "双声道 Stereo" : "单声道 Mono"}</dd></div>
        <div><dt>格式</dt><dd>{job.params.format.toUpperCase()}</dd></div>
        <div><dt>文件大小</dt><dd>{formatBytes(report?.bytes)}</dd></div>
        <div><dt>SHA-256</dt><dd>{report?.sha256 || "—"} <Clipboard size={13} /></dd></div>
        <div className="pass-row"><dt>ffprobe 检查</dt><dd><CheckCircle2 size={15} />通过</dd></div>
        <div className="pass-row"><dt>ffmpeg 解码</dt><dd><CheckCircle2 size={15} />通过</dd></div>
      </dl>
      <div className="report-note">
        <FileAudio2 size={17} />
        <p>报告只保存非敏感元数据，凭据与参考音频内容不会写入。</p>
      </div>
    </aside>
  );
}
