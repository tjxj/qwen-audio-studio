import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  getJob,
  getProject,
  listJobs,
  patchJobMetadata,
  setProjectFinalJob,
  request,
} from "../../api";
import ResultWorkbench from "./ResultWorkbench";
import "./results.css";

const labels = {
  queued: "排队中",
  running: "正在生成",
  success: "生成成功",
  failed: "生成失败",
  cancelled: "已取消",
  interrupted: "生成已中断",
};
const statusNotes = {
  queued: "任务已进入队列，开始后会自动更新。",
  running: "正在处理音频，页面会自动更新。",
  success: "",
  failed: "生成未成功。请返回创作台检查配置和提示词后重试。",
  cancelled: "任务已取消。可以返回创作台继续编辑。",
  interrupted: "本地服务曾中断，任务未自动重发。再次生成可能产生新的调用费用。",
};

export default function ResultPage() {
  const { jobId = "" } = useParams();
  const queryClient = useQueryClient();
  const [now, setNow] = useState(Date.now()),
    [cancelError, setCancelError] = useState("");
  const jobQuery = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => getJob(jobId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status &&
        ["success", "failed", "cancelled", "interrupted"].includes(status)
        ? false
        : 1000;
    },
  });
  const historyQuery = useQuery({
    queryKey: ["jobs"],
    queryFn: listJobs,
    refetchInterval: (query) =>
      query.state.data?.some(
        (item) => item.status === "queued" || item.status === "running",
      )
        ? 1000
        : false,
  });
  useEffect(() => {
    if (!["running", "queued"].includes(jobQuery.data?.status || "")) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [jobQuery.data?.status]);
  useEffect(() => {
    if (jobQuery.data?.status === "success")
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
  }, [jobQuery.data?.status, jobId, queryClient]);
  const projectQuery = useQuery({
    queryKey: ["project", jobQuery.data?.projectId],
    queryFn: () => getProject(jobQuery.data!.projectId),
    enabled: Boolean(jobQuery.data?.projectId),
  });
  if (jobQuery.isLoading)
    return <div className="loading-state">正在获取生成状态…</div>;
  if (!jobQuery.data)
    return (
      <div className="loading-state error">
        <p>生成任务暂时无法读取。</p>
        <button type="button" onClick={() => void jobQuery.refetch()}>
          重新加载
        </button>
        <a href="/library">返回作品库</a>
      </div>
    );
  if (jobQuery.data.status !== "success") {
    return (
      <div className="loading-state">
        <span className={"large-status " + jobQuery.data.status}>
          {labels[jobQuery.data.status]}
        </span>
        <h1>{jobQuery.data.projectName}</h1>
        <p>{jobQuery.data.error || statusNotes[jobQuery.data.status]}</p>
        {["queued", "running"].includes(jobQuery.data.status) ? (
          <p className="muted">
            {
              {
                preparing: "准备中",
                requesting: "请求模型中",
                downloading: "下载音频中",
                validating: "验收音频中",
              }[jobQuery.data.stage || "preparing"]
            }{" "}
            · 已等待{" "}
            {Math.max(
              0,
              Math.floor((now - Date.parse(jobQuery.data.createdAt)) / 1000),
            )}{" "}
            秒
          </p>
        ) : null}
        {jobQuery.data.status === "queued" ? (
          <button
            onClick={async () => {
              try {
                await request("/api/jobs/" + jobId + "/cancel", "POST", {});
                await jobQuery.refetch();
              } catch (e) {
                setCancelError(e instanceof Error ? e.message : "取消失败");
              }
            }}
          >
            取消排队
          </button>
        ) : null}
        {jobQuery.data.status === "running" ? (
          <p className="hint">已开始处理，无法保证撤回云端请求或免除费用。</p>
        ) : null}
        {cancelError ? (
          <p className="error" role="alert">
            {cancelError}
          </p>
        ) : null}
        <a
          className="result-continue"
          href={`/?project=${encodeURIComponent(jobQuery.data.projectId)}`}
        >
          返回创作台
        </a>
      </div>
    );
  }
  const variants = historyQuery.data?.filter(
    (item) =>
      item.projectId === jobQuery.data?.projectId && item.status === "success",
  );
  return (
    <ResultWorkbench
      job={jobQuery.data}
      variants={variants}
      comparisonVariants={historyQuery.data?.filter(
        (item) => item.status === "success",
      )}
      finalJobId={projectQuery.data?.finalJobId}
      onSetFinal={async (selectedJobId) => {
        await setProjectFinalJob(jobQuery.data!.projectId, selectedJobId);
        await queryClient.invalidateQueries({
          queryKey: ["project", jobQuery.data!.projectId],
        });
      }}
      onSaveNote={async (selectedJobId, note) => {
        await patchJobMetadata(selectedJobId, { note });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["jobs"] }),
          queryClient.invalidateQueries({ queryKey: ["job", selectedJobId] }),
        ]);
      }}
    />
  );
}
