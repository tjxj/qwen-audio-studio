import { ArrowLeft, ArrowUpRight, Check, Search, Star } from "lucide-react";
import { useEffect, useState } from "react";
function libraryReturnUrl() {
  const from = new URLSearchParams(window.location.search).get("from");
  return from && /^\/library(?:\?|$)/.test(from) ? from : "/library";
}
import type { Job } from "../../types";
import { ABComparePlayer } from "./ABComparePlayer";
import { AudioEventTimeline } from "./AudioEventTimeline";
import { ResultPlayer } from "./ResultPlayer";
import { ValidationReport } from "./ValidationReport";
import "./results.css";

export default function ResultWorkbench({
  job,
  variants,
  comparisonVariants,
  onSetFinal,
  onSaveNote,
  finalJobId,
}: {
  job: Job;
  variants?: Job[];
  comparisonVariants?: Job[];
  onSetFinal?: (jobId: string) => Promise<unknown> | void;
  onSaveNote?: (jobId: string, note: string) => Promise<unknown>;
  finalJobId?: string;
}) {
  const available = [
    job,
    ...(variants || []).filter((item) => item.id !== job.id),
  ];
  const [selection, setSelection] = useState({
    routeId: job.id,
    selectedId: job.id,
  });
  const selectedId =
    selection.routeId === job.id ? selection.selectedId : job.id;
  const current = available.find((item) => item.id === selectedId) || job;
  const [view, setView] = useState<"listen" | "compare">("listen");
  const [detail, setDetail] = useState<"versions" | "report">("versions");
  const [query, setQuery] = useState("");
  const [feedback, setFeedback] = useState("");
  const [failure, setFailure] = useState("");
  const [saving, setSaving] = useState(false);
  const [finalId, setFinalId] = useState(finalJobId);
  const [note, setNote] = useState("");
  useEffect(() => {
    setFinalId(finalJobId);
  }, [finalJobId]);
  useEffect(() => {
    setNote(current.note || "");
    setFeedback("");
    setFailure("");
  }, [current.id]);
  useEffect(() => {
    setView("listen");
  }, [job.id]);
  const mediaUrl =
    current.outputAssetId && current.fileAvailable !== false
      ? `/api/media/${current.outputAssetId}`
      : undefined;
  const comparisons = [
    current,
    ...(comparisonVariants || available).filter(
      (item) => item.id !== current.id,
    ),
  ];
  const canCompare =
    comparisons.filter(
      (item) =>
        item.status === "success" &&
        item.fileAvailable !== false &&
        item.outputAssetId &&
        item.params.format !== "pcm",
    ).length >= 2;
  const markFinal = async () => {
    if (!onSetFinal || saving) return;
    setSaving(true);
    setFailure("");
    setFeedback("");
    try {
      await onSetFinal(current.id);
      setFinalId(current.id);
      setFeedback("已设为最终版本");
    } catch {
      setFailure("最终版本未保存，请重试。");
    } finally {
      setSaving(false);
    }
  };
  const saveNote = async () => {
    if (!onSaveNote) return;
    setSaving(true);
    setFailure("");
    setFeedback("");
    try {
      await onSaveNote(current.id, note);
      setFeedback("版本备注已保存");
    } catch {
      setFailure("备注未保存，请重试。");
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="result-studio">
      <header className="result-topline">
        <div>
          <a className="result-back" href={libraryReturnUrl()}>
            <ArrowLeft size={14} />
            作品库
          </a>
          <h1 title={current.displayName || current.projectName}>
            {current.displayName || current.projectName}
          </h1>
        </div>
        <a
          className="result-continue"
          href={`/library?continue=${encodeURIComponent(current.id)}`}
        >
          继续编辑
          <ArrowUpRight size={15} />
        </a>
      </header>
      <div className="result-columns">
        <section className="result-audition" aria-label="结果试听">
          <div className="result-toolbar">
            <div className="result-tabs" role="tablist" aria-label="试听方式">
              <button
                type="button"
                role="tab"
                aria-selected={view === "listen"}
                onClick={() => setView("listen")}
              >
                成品试听
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === "compare"}
                disabled={!canCompare}
                onClick={() => setView("compare")}
              >
                A/B 对比
              </button>
            </div>
            <span>
              Seed {current.params.seed} · {current.params.format.toUpperCase()}
            </span>
          </div>
          <div className="result-audition-scroll">
            {view === "listen" ? (
              <>
                {current.fileAvailable === false ? (
                  <p className="playback-error" role="alert">
                    音频文件暂不可用，请检查原输出磁盘。生成记录与脚本仍保留。
                  </p>
                ) : null}
                <ResultPlayer
                  key={current.id}
                  src={current.params.format === "pcm" ? undefined : mediaUrl}
                  downloadSrc={mediaUrl}
                  pcm={current.params.format === "pcm"}
                  durationHint={current.report?.durationSeconds}
                  channels={current.report?.channels || current.params.channels}
                  assetKey={current.report?.sha256}
                />
              </>
            ) : (
              <ABComparePlayer key={job.id} variants={comparisons} />
            )}
            <section className="result-script">
              <header>
                <h2>创作脚本</h2>
                <span>{Array.from(current.prompt).length} 字</span>
              </header>
              <div className="result-script-text">{current.prompt}</div>
              <AudioEventTimeline prompt={current.prompt} />
            </section>
          </div>
        </section>
        <aside className="result-detail">
          <div className="result-tabs" role="tablist" aria-label="结果详情">
            <button
              type="button"
              role="tab"
              aria-selected={detail === "versions"}
              onClick={() => setDetail("versions")}
            >
              全部版本 <span>{available.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={detail === "report"}
              onClick={() => setDetail("report")}
            >
              验收报告
            </button>
          </div>
          <div className="result-detail-scroll">
            {detail === "versions" ? (
              <>
                <label className="result-version-search">
                  <Search size={15} />
                  <input
                    aria-label="搜索版本"
                    placeholder="搜索 Seed 或版本名称"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </label>
                <div className="result-version-list">
                  {available
                    .map((variant, index) => ({ variant, index }))
                    .filter(({ variant }) =>
                      `${variant.projectName} ${variant.params.seed}`
                        .toLocaleLowerCase()
                        .includes(query.toLocaleLowerCase()),
                    )
                    .map(({ variant, index }) => (
                      <button
                        className="result-version"
                        type="button"
                        key={variant.id}
                        aria-label={`版本 ${index < 26 ? String.fromCharCode(65 + index) : index + 1} · Seed ${variant.params.seed}`}
                        aria-pressed={current.id === variant.id}
                        onClick={() => {
                          setSelection({
                            routeId: job.id,
                            selectedId: variant.id,
                          });
                          setView("listen");
                        }}
                      >
                        <div>
                          <strong>
                            版本 {String(index + 1).padStart(2, "0")}
                          </strong>
                          {finalId === variant.id ? (
                            <Star size={13} fill="currentColor" />
                          ) : current.id === variant.id ? (
                            <Check size={15} />
                          ) : null}
                        </div>
                        <span>
                          Seed {variant.params.seed} ·{" "}
                          {variant.report?.durationSeconds?.toFixed(1) || "—"}{" "}
                          秒
                        </span>
                        <small>
                          {new Date(variant.createdAt).toLocaleString("zh-CN", {
                            month: "2-digit",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </small>
                      </button>
                    ))}
                </div>
                {!available.some((variant) =>
                  `${variant.projectName} ${variant.params.seed}`
                    .toLocaleLowerCase()
                    .includes(query.toLocaleLowerCase()),
                ) ? (
                  <p className="result-empty">没有匹配的版本。</p>
                ) : null}
              </>
            ) : (
              <ValidationReport job={current} />
            )}
          </div>
          <footer className="result-detail-footer">
            {onSaveNote ? (
              <>
                <label htmlFor="version-note">版本备注</label>
                <div className="result-note-editor">
                  <input
                    id="version-note"
                    maxLength={500}
                    placeholder="记录这版值得保留的地方"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                  />
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void saveNote()}
                  >
                    保存
                  </button>
                </div>
              </>
            ) : null}
            {onSetFinal ? (
              <button
                type="button"
                className="result-final"
                disabled={saving || finalId === current.id}
                onClick={() => void markFinal()}
              >
                <Star size={15} />
                {finalId === current.id
                  ? "当前为最终版本"
                  : saving
                    ? "保存中…"
                    : "设为最终版本"}
              </button>
            ) : null}
            {feedback ? (
              <p className="result-feedback" role="status">
                {feedback}
              </p>
            ) : null}
            {failure ? (
              <p className="playback-error" role="alert">
                {failure}
              </p>
            ) : null}
          </footer>
        </aside>
      </div>
    </div>
  );
}
