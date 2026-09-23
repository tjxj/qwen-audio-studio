import {useQuery} from "@tanstack/react-query";
import {useParams} from "react-router-dom";
import {getJob, listJobs, setProjectFinalJob} from "../../api";
import ResultWorkbench from "./ResultWorkbench";

export default function ResultPage() {
  const {jobId = ""} = useParams();
  const jobQuery = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => getJob(jobId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && ["success", "failed", "cancelled", "interrupted"].includes(status) ? false : 1000;
    }
  });
  const historyQuery = useQuery({queryKey: ["jobs"], queryFn: listJobs});
  if (jobQuery.isLoading) return <div className="loading-state">正在获取生成状态…</div>;
  if (!jobQuery.data) return <div className="loading-state error">没有找到生成任务。</div>;
  if (jobQuery.data.status !== "success") {
    return (
      <div className="loading-state">
        <span className={"large-status " + jobQuery.data.status}>{jobQuery.data.status}</span>
        <h1>{jobQuery.data.projectName}</h1>
        <p>{jobQuery.data.error || "音频正在生成，页面会自动更新。"}</p>
      </div>
    );
  }
  const variants = historyQuery.data?.filter((item) => item.projectId === jobQuery.data?.projectId && item.status === "success");
  return <ResultWorkbench job={jobQuery.data} variants={variants} onSetFinal={(selectedJobId) => void setProjectFinalJob(jobQuery.data!.projectId, selectedJobId)} />;
}
