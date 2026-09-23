import {AlertTriangle, Clock3, Plus} from "lucide-react";
import {Link} from "react-router-dom";
import type {Job} from "../../types";
import {JobQueue} from "../jobs/JobQueue";

export default function HistoryPage({
  jobs,
  onRetry
}: {
  jobs: Job[];
  onRetry: (id: string) => void;
}) {
  return (
    <section className="data-page">
      <header><div><span>本地记录</span><h1>生成历史</h1></div><Clock3 size={24} /></header>
      {jobs.some((job) => job.status === "failed") ? (
        <div className="history-alert"><AlertTriangle size={17} />失败任务的错误内容已经脱敏，可以安全查看和重试。</div>
      ) : null}
      {jobs.map((job) => job.error ? <p className="job-error" key={job.id}>{job.error}</p> : null)}
      {jobs.length === 0 ? <div className="empty-state"><Clock3 size={30} /><strong>还没有生成记录</strong><p>任务提交后可以在这里查看排队、生成、验收与失败重试状态。</p><Link to="/"><Plus size={16} />开始创作</Link></div> : null}
      <JobQueue jobs={jobs} onRetry={onRetry} />
    </section>
  );
}
