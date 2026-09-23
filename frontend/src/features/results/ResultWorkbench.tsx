import {Star} from "lucide-react";
import {useState} from "react";
import type {Job} from "../../types";
import {ABComparePlayer} from "./ABComparePlayer";
import {AudioEventTimeline} from "./AudioEventTimeline";
import {ResultPlayer} from "./ResultPlayer";
import {ValidationReport} from "./ValidationReport";

export default function ResultWorkbench({
  job,
  variants,
  onSetFinal
}: {
  job: Job;
  variants?: Job[];
  onSetFinal?: (jobId: string) => void;
}) {
  const available = [job, ...(variants || []).filter((item) => item.id !== job.id)];
  const [selected, setSelected] = useState(0);
  const [synchronized, setSynchronized] = useState(true);
  const current = available[selected] || job;
  const mediaUrl = current.outputAssetId ? "/api/media/" + current.outputAssetId : undefined;
  const playableVariants = available.filter((item) => item.params.format !== "pcm");
  const displayVariants = available.slice(0, 3);

  return (
    <div className="result-workbench">
      <div className="result-main">
        <header className="result-header">
          <div>
            <h1>{job.projectName}</h1>
            <p>{current.prompt.replace(/\s+/g, " ").slice(0, 96)}</p>
          </div>
          <a className="continue-project" href={`/?project=${encodeURIComponent(job.projectId)}`}>基于此项目生成新版本</a>
        </header>
        <div className="variant-switcher">
          {displayVariants.map((variant, index) => (
            <button
              type="button"
              key={variant.id}
              aria-pressed={selected === index}
              onClick={() => setSelected(index)}
            >
              版本 {String.fromCharCode(65 + index)} · Seed {variant.params.seed}
            </button>
          ))}
          {onSetFinal ? <button type="button" className="set-final" onClick={() => onSetFinal(current.id)}><Star size={15} />设为最终版本</button> : null}
        </div>
        <ResultPlayer src={current.params.format === "pcm" ? undefined : mediaUrl} downloadSrc={mediaUrl} pcm={current.params.format === "pcm"} durationHint={current.report?.durationSeconds} channels={current.report?.channels} />
        <AudioEventTimeline prompt={current.prompt} />
        {playableVariants.length >= 2 ? <ABComparePlayer variants={playableVariants.slice(0, 2)} synchronized={synchronized} onSynchronizedChange={setSynchronized} /> : null}
      </div>
      <ValidationReport job={current} />
    </div>
  );
}
