import {
  CheckCircle2,
  CircleDashed,
  FileAudio2,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import type { Job } from "../../types";
const statusLabels = {
  queued: "排队中",
  running: "生成中",
  success: "生成成功",
  failed: "生成失败",
  cancelled: "已取消",
  interrupted: "已中断",
};
function ValidationStatus({ value }: { value?: string }) {
  if (value === "pass")
    return (
      <span className="validation-pass">
        <CheckCircle2 size={14} />
        通过
      </span>
    );
  if (value === "failed")
    return (
      <span className="validation-failed">
        <XCircle size={14} />
        失败
      </span>
    );
  return (
    <span className="validation-pending">
      <CircleDashed size={14} />
      未执行
    </span>
  );
}
export function ValidationReport({ job }: { job: Job }) {
  const report = job.report;
  return (
    <section className="validation-report">
      <div className="result-section-title">
        <div>
          <ShieldCheck size={17} />
          <strong>文件验收</strong>
        </div>
        <span className={`status-dot ${job.status}`}>
          {statusLabels[job.status]}
        </span>
      </div>
      <dl>
        <div>
          <dt>音频时长</dt>
          <dd>
            {report?.durationSeconds
              ? `${report.durationSeconds.toFixed(3)} 秒`
              : "—"}
          </dd>
        </div>
        <div>
          <dt>生成耗时</dt>
          <dd>
            {job.elapsedSeconds ? `${job.elapsedSeconds.toFixed(1)} 秒` : "—"}
          </dd>
        </div>
        <div>
          <dt>格式</dt>
          <dd>{job.params.format.toUpperCase()}</dd>
        </div>
        <div>
          <dt>采样率</dt>
          <dd>
            {report?.sampleRate ? `${report.sampleRate / 1000} kHz` : "—"}
          </dd>
        </div>
        <div>
          <dt>声道</dt>
          <dd>
            {report?.channels === 2
              ? "双声道"
              : report?.channels === 1
                ? "单声道"
                : "—"}
          </dd>
        </div>
        <div>
          <dt>文件大小</dt>
          <dd>
            {report?.bytes === undefined
              ? "—"
              : `${(report.bytes / 1024 / 1024).toFixed(2)} MB`}
          </dd>
        </div>
        <div>
          <dt>ffprobe 检查</dt>
          <dd>
            <ValidationStatus value={report?.ffprobe} />
          </dd>
        </div>
        <div>
          <dt>ffmpeg 解码</dt>
          <dd>
            <ValidationStatus value={report?.ffmpeg} />
          </dd>
        </div>
        <div className="report-long-value">
          <dt>请求 ID</dt>
          <dd>{report?.requestId || "—"}</dd>
        </div>
        <div className="report-long-value">
          <dt>SHA-256</dt>
          <dd>{report?.sha256 || "—"}</dd>
        </div>
      </dl>
      <div className="report-note">
        <FileAudio2 size={17} />
        <p>这里只验证文件与解码。台词完整度、音色和表现力请实际试听确认。</p>
      </div>
    </section>
  );
}
