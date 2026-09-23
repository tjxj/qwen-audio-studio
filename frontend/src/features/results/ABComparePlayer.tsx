import {Pause, Play} from "lucide-react";
import {useRef, useState} from "react";
import type {Job} from "../../types";
import {Waveform} from "./ResultPlayer";

export function ABComparePlayer({
  variants,
  synchronized,
  onSynchronizedChange
}: {
  variants: Job[];
  synchronized: boolean;
  onSynchronizedChange: (next: boolean) => void;
}) {
  const audioRefs = useRef<Array<HTMLAudioElement | null>>([]);
  const [playing, setPlaying] = useState<number | null>(null);

  const toggle = async (index: number) => {
    const targets = synchronized ? audioRefs.current.filter(Boolean) : [audioRefs.current[index]].filter(Boolean);
    if (playing === index) {
      targets.forEach((audio) => audio?.pause());
      setPlaying(null);
      return;
    }
    audioRefs.current.forEach((audio) => audio?.pause());
    if (synchronized) targets.forEach((audio) => { if (audio) audio.currentTime = 0; });
    await Promise.all(targets.map((audio) => audio?.play().catch(() => undefined)));
    setPlaying(index);
  };

  return (
    <section className="ab-compare">
      <div className="timeline-heading">
        <strong>A / B 对比试听</strong>
        <label className="sync-toggle">
          <input
            aria-label="同步播放"
            type="checkbox"
            checked={synchronized}
            onChange={(event) => onSynchronizedChange(event.target.checked)}
          />
          同步播放
        </label>
      </div>
      {variants.map((variant, index) => {
        const item = {label: String.fromCharCode(65 + index), seed: variant.params.seed, color: index === 0 ? "blue" : "green"};
        const src = variant.outputAssetId ? "/api/media/" + variant.outputAssetId : undefined;
        return (
        <div className={"compare-row " + item.color} key={item.label}>
          <b>{item.label}</b>
          <span>Seed {item.seed}</span>
          <audio ref={(element) => { audioRefs.current[index] = element; }} src={src} onEnded={() => setPlaying(null)} />
          <button type="button" aria-label={(playing === index ? "暂停版本 " : "播放版本 ") + item.label} onClick={() => void toggle(index)}>{playing === index ? <Pause size={15} /> : <Play size={15} fill="currentColor" />}</button>
          <Waveform compact src={src} />
          <time>{variant.report?.durationSeconds ? variant.report.durationSeconds.toFixed(1) + " 秒" : "—"}</time>
        </div>
      )})}
    </section>
  );
}
