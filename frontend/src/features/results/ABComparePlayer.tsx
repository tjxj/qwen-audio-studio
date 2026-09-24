import { Pause, Play, Volume2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { Job } from "../../types";
import { LoopRegion } from "../player/LoopRegion";
import { formatTime, SeekBar } from "../player/SeekBar";
import { useABController } from "../player/useABController";
import { Waveform } from "./ResultPlayer";

export function ABComparePlayer({ variants }: { variants: Job[] }) {
  const playable = variants.filter(
    (job) =>
      job.status === "success" &&
      job.fileAvailable !== false &&
      job.outputAssetId &&
      job.params.format !== "pcm",
  );
  const [ids, setIds] = useState(() =>
    playable.slice(0, 2).map((job) => job.id),
  );
  const identity = playable.map((job) => job.id).join("|");
  useEffect(
    () =>
      setIds((current) =>
        current.length === 2 &&
        current.every((id) => playable.some((job) => job.id === id))
          ? current
          : playable.slice(0, 2).map((job) => job.id),
      ),
    [identity],
  );
  const selected = ids
    .map((id) => playable.find((job) => job.id === id))
    .filter((job): job is Job => Boolean(job));
  const sources = selected.map((job) => `/api/media/${job.outputAssetId}`);
  const player = useABController(
    sources,
    selected.map((job) => job.report?.durationSeconds || 0),
  );
  if (playable.length < 2)
    return <div className="result-empty">至少需要两个可播放的成功版本。</div>;
  const lengthsDiffer =
    player.durations.length === 2 &&
    Math.abs(player.durations[0] - player.durations[1]) > 0.15;
  return (
    <section className="ab-compare" aria-label="A / B 对比试听">
      <div className="comparison-intro">
        <strong>A / B 对比试听</strong>
        <span>同一位置切换，每次只听一路</span>
      </div>
      {selected.map((job, index) => {
        const label = index === 0 ? "A" : "B";
        return (
          <div
            className={`compare-row${player.selected === index ? " selected" : ""}`}
            key={label}
          >
            <div className="compare-track-header">
              <b>{label}</b>
              <select
                aria-label={`对比版本 ${label}`}
                value={job.id}
                onChange={(event) => {
                  player.pause();
                  setIds((current) =>
                    current.map((value, cursor) =>
                      cursor === index ? event.target.value : value,
                    ),
                  );
                }}
              >
                {playable.map((option) => (
                  <option
                    key={option.id}
                    value={option.id}
                    disabled={ids[1 - index] === option.id}
                  >
                    {option.projectName} · Seed {option.params.seed}
                  </option>
                ))}
              </select>
              <time>{formatTime(player.durations[index] || 0)}</time>
            </div>
            <div className="compare-track-wave">
              <button
                type="button"
                aria-label={
                  (player.playing && player.selected === index
                    ? "暂停版本 "
                    : "播放版本 ") + label
                }
                aria-pressed={player.selected === index}
                onClick={() =>
                  player.playing && player.selected === index
                    ? player.pause()
                    : void player.play(index)
                }
              >
                {player.playing && player.selected === index ? (
                  <Pause size={18} />
                ) : (
                  <Play size={18} fill="currentColor" />
                )}
              </button>
              <Waveform
                compact
                src={sources[index]}
                assetKey={job.report?.sha256}
              />
            </div>
            <audio
              aria-label={`对比音频 ${label}`}
              ref={(element) => {
                player.audioRefs.current[index] = element;
              }}
              src={sources[index]}
              preload="auto"
              onLoadedMetadata={() => player.onMetadata(index)}
              onTimeUpdate={() => player.onTimeUpdate(index)}
              onPause={() => player.onPause(index)}
              onEnded={player.onEnded}
              onError={player.onError}
            />
          </div>
        );
      })}
      <SeekBar
        label="对比播放进度"
        position={player.position}
        duration={player.duration}
        onSeek={player.seek}
      />
      <div className="compare-volume">
        <Volume2 size={16} />
        <input
          aria-label="对比音量"
          type="range"
          min={0}
          max={100}
          value={Math.round(player.volume * 100)}
          onChange={(event) =>
            player.changeVolume(Number(event.target.value) / 100)
          }
        />
      </div>
      <LoopRegion
        value={player.loop}
        duration={player.duration}
        onChange={player.setLoop}
      />
      {lengthsDiffer ? (
        <p className="playback-note">
          两条音频时长不同，仅在共同的前 {formatTime(player.duration)} 内对比。
        </p>
      ) : null}
      {selected[0]?.projectId !== selected[1]?.projectId ? (
        <p className="playback-note">
          这两条结果来自不同项目，文案与参数可能不同。
        </p>
      ) : null}
      {player.notice ? (
        <p className="playback-note" role="status">
          {player.notice}
        </p>
      ) : null}
      {player.error ? (
        <p className="playback-error" role="alert">
          {player.error}
        </p>
      ) : null}
    </section>
  );
}
