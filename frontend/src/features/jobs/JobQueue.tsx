import {
  AlertTriangle,
  CheckCircle2,
  LoaderCircle,
  RotateCcw,
} from "lucide-react";
import type { Job } from "../../types";

export function JobQueue({
  jobs,
  onRetry,
}: {
  jobs: Job[];
  onRetry?: (id: string) => void;
}) {
  return (
    <div className="job-table">
      <div className="job-table-head">
        <span>任务名称</span>
        <span>类型</span>
        <span>Seed</span>
        <span>状态</span>
        <span>耗时</span>
        <span>操作</span>
      </div>
      {jobs.map((job) => (
        <div className="job-row" key={job.id}>
          <strong>{job.projectName}</strong>
          <span>{job.mode}</span>
          <span>{job.params.seed}</span>
          <span className={"job-status " + job.status}>
            {job.status === "running" ? (
              <LoaderCircle size={14} />
            ) : job.status === "failed" ? (
              <AlertTriangle size={14} />
            ) : (
              <CheckCircle2 size={14} />
            )}
            {job.status}
          </span>
          <span>
            {job.elapsedSeconds ? job.elapsedSeconds.toFixed(1) + "s" : "—"}
          </span>
          <span>
            {job.status === "failed" && onRetry ? (
              <button type="button" onClick={() => onRetry(job.id)}>
                <RotateCcw size={13} />
                重试
              </button>
            ) : (
              "—"
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
