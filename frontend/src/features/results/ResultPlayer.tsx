import { Download, Pause, Play, RotateCcw, Volume2 } from "lucide-react";
import { useEffect, useState } from "react";
import { LoopRegion } from "../player/LoopRegion";
import { SeekBar } from "../player/SeekBar";
import { useABController } from "../player/useABController";

const waveformCache = new Map<string, number[]>();
export function Waveform({
  compact = false,
  src,
  assetKey,
}: {
  compact?: boolean;
  src?: string;
  assetKey?: string;
}) {
  const count = compact ? 72 : 150;
  const key = `${assetKey || src || ""}:${count}`;
  const [state, setState] = useState<{
    key: string;
    values: number[];
    error: string;
  }>({ key, values: [], error: "" });
  const values = state.key === key ? state.values : [];
  const error = state.key === key ? state.error : "";
  useEffect(() => {
    let active = true;
    const cached = waveformCache.get(key);
    setState({ key, values: cached || [], error: "" });
    if (!src || cached) return;
    const AudioContextClass =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextClass) {
      setState({
        key,
        values: [],
        error: "当前浏览器不支持波形解析，仍可试听或下载。",
      });
      return;
    }
    const context = new AudioContextClass();
    const abort = new AbortController();
    let closed = false;
    const close = () => {
      if (!closed) {
        closed = true;
        void context.close().catch(() => undefined);
      }
    };
    fetch(src, { signal: abort.signal })
      .then((response) => {
        if (!response.ok) throw new Error("media unavailable");
        return response.arrayBuffer();
      })
      .then((buffer) => context.decodeAudioData(buffer))
      .then((audio) => {
        const samples = audio.getChannelData(0);
        const peaks = Array.from({ length: count }, (_, index) => {
          let peak = 0;
          const start = Math.floor((index * samples.length) / count);
          const end = Math.floor(((index + 1) * samples.length) / count);
          for (let cursor = start; cursor < end; cursor++)
            peak = Math.max(peak, Math.abs(samples[cursor]));
          return peak;
        });
        const maximum = Math.max(...peaks, 0.01);
        const normalized = peaks.map((peak) =>
          Math.max(2, (peak / maximum) * 90),
        );
        waveformCache.set(key, normalized);
        if (waveformCache.size > 40)
          waveformCache.delete(waveformCache.keys().next().value!);
        if (active) setState({ key, values: normalized, error: "" });
      })
      .catch(() => {
        if (active)
          setState({
            key,
            values: [],
            error: "波形解析失败，可尝试播放或下载音频。",
          });
      })
      .finally(close);
    return () => {
      active = false;
      abort.abort();
      close();
    };
  }, [key, src, count]);
  if (!src) return <div className="audio-wave-empty">暂无可预览的音频波形</div>;
  if (error)
    return (
      <div className="audio-wave-empty" role="status">
        {error}
      </div>
    );
  if (!values.length)
    return (
      <div className="audio-wave-empty" role="status">
        正在解析真实音频波形…
      </div>
    );
  return (
    <div
      className={compact ? "waveform compact" : "waveform"}
      aria-label="真实音频波形"
    >
      {values.map((height, index) => (
        <i key={index} style={{ height: `${height}%` }} />
      ))}
    </div>
  );
}

export function ResultPlayer({
  src,
  downloadSrc,
  durationHint = 0,
  channels = 2,
  pcm = false,
  assetKey,
}: {
  src?: string;
  downloadSrc?: string;
  durationHint?: number;
  channels?: number;
  pcm?: boolean;
  assetKey?: string;
}) {
  const player = useABController([src], [durationHint]);
  return (
    <section className="result-player" aria-label="当前版本播放器">
      <div className="player-caption">
        <span>成品试听</span>
        <span>{channels === 2 ? "立体声" : "单声道"}</span>
      </div>
      <div className="waveform-canvas">
        <Waveform src={src} assetKey={assetKey} />
        {src && player.duration ? (
          <div
            className="audio-playhead"
            style={{
              left: `${Math.min(100, (player.position / player.duration) * 100)}%`,
            }}
          />
        ) : null}
      </div>
      <audio
        aria-label="当前版本音频"
        ref={(element) => {
          player.audioRefs.current[0] = element;
        }}
        src={src}
        preload="metadata"
        onTimeUpdate={() => player.onTimeUpdate(0)}
        onLoadedMetadata={() => player.onMetadata(0)}
        onPause={() => player.onPause(0)}
        onError={player.onError}
        onEnded={player.onEnded}
      />
      <SeekBar
        position={player.position}
        duration={player.duration}
        onSeek={player.seek}
      />
      <div className="transport">
        <button
          type="button"
          aria-label="后退 10 秒"
          disabled={!src}
          onClick={() => player.seek(player.position - 10)}
        >
          <RotateCcw size={18} />
          <small>10</small>
        </button>
        <button
          type="button"
          className="play-button"
          aria-label={player.playing ? "暂停" : "播放"}
          disabled={!src}
          onClick={() => (player.playing ? player.pause() : void player.play())}
        >
          {player.playing ? (
            <Pause size={20} />
          ) : (
            <Play size={20} fill="currentColor" />
          )}
        </button>
        <span className="transport-spacer" />
        <Volume2 size={17} />
        <input
          aria-label="播放音量"
          type="range"
          min={0}
          max={100}
          value={Math.round(player.volume * 100)}
          onChange={(event) =>
            player.changeVolume(Number(event.target.value) / 100)
          }
        />
        {downloadSrc ? (
          <a
            className="transport-action"
            href={`${downloadSrc}?download=1`}
            download
          >
            <Download size={15} />
            下载音频
          </a>
        ) : null}
      </div>
      {src ? (
        <LoopRegion
          value={player.loop}
          duration={player.duration}
          onChange={player.setLoop}
        />
      ) : null}
      {pcm ? (
        <p className="playback-note">
          PCM 是原始音频流，请下载后按当前采样率与声道参数导入音频工具。
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
