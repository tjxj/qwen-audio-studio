import {Download, Pause, Play, RotateCcw, Volume2} from "lucide-react";
import {useEffect, useMemo, useRef, useState} from "react";

function useWaveform(src: string | undefined, count: number) {
  const [values, setValues] = useState<number[]>([]);
  useEffect(() => {
    let active = true;
    let closed = false;
    setValues([]);
    const AudioContextClass = window.AudioContext || (window as typeof window & {webkitAudioContext?: typeof AudioContext}).webkitAudioContext;
    if (!src || !AudioContextClass) return () => { active = false; };
    const context = new AudioContextClass();
    const closeContext = () => {
      if (closed) return;
      closed = true;
      void context.close().catch(() => undefined);
    };
    fetch(src)
      .then((response) => response.arrayBuffer())
      .then((buffer) => context.decodeAudioData(buffer))
      .then((audio) => {
        if (!active) return;
        const samples = audio.getChannelData(0);
        const step = Math.max(1, Math.floor(samples.length / count));
        const peaks = Array.from({length: count}, (_, index) => {
          let peak = 0;
          const end = Math.min(samples.length, (index + 1) * step);
          for (let cursor = index * step; cursor < end; cursor++) peak = Math.max(peak, Math.abs(samples[cursor]));
          return peak;
        });
        const maximum = Math.max(...peaks, 0.01);
        setValues(peaks.map((peak) => 8 + peak / maximum * 84));
      })
      .catch(() => undefined)
      .finally(closeContext);
    return () => { active = false; closeContext(); };
  }, [src, count]);
  return values;
}

function Waveform({compact = false, src}: {compact?: boolean; src?: string}) {
  const count = compact ? 72 : 150;
  const values = useWaveform(src, count);
  const bars = useMemo(() => values.length ? values : Array.from({length: count}, () => 12), [values, count]);
  return (
    <div className={(compact ? "waveform compact" : "waveform") + (values.length ? "" : " loading")} aria-label={values.length ? "真实音频波形" : "正在解析音频波形"}>
      {bars.map((height, index) => (
        <i key={index} style={{height: height + "%"}} />
      ))}
    </div>
  );
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00.0";
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${rest.toFixed(1).padStart(4, "0")}`;
}

export function ResultPlayer({src, downloadSrc, durationHint = 0, channels = 2, pcm = false}: {src?: string; downloadSrc?: string; durationHint?: number; channels?: number; pcm?: boolean}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const previousSrc = useRef(src);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(durationHint);
  const [playbackError, setPlaybackError] = useState("");

  useEffect(() => {
    if (previousSrc.current === src) return;
    previousSrc.current = src;
    audioRef.current?.pause();
    setPlaying(false);
    setCurrentTime(0);
    setDuration(durationHint);
    setPlaybackError("");
  }, [src, durationHint]);

  const toggle = async () => {
    if (!audioRef.current) return;
    if (playing) {
      audioRef.current.pause();
      setPlaying(false);
    } else {
      try {
        await audioRef.current.play();
        setPlaybackError("");
        setPlaying(true);
      } catch {
        setPlaying(false);
        setPlaybackError("浏览器无法播放该音频，请下载后使用本地音频工具打开。");
      }
    }
  };

  return (
    <section className="result-player">
      <div className="waveform-canvas">
        <div className="channel-labels"><span>{channels === 2 ? "L" : "M"}</span>{channels === 2 ? <span>R</span> : null}</div>
        <Waveform src={src} />
        <div className="playhead" style={{left: duration ? `${Math.min(100, currentTime / duration * 100)}%` : "0%"}}><b>{formatTime(currentTime)}</b></div>
      </div>
      <audio ref={audioRef} src={src} onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)} onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)} onEnded={() => setPlaying(false)} />
      <div className="transport">
        <button type="button" aria-label="后退 10 秒" onClick={() => { if (audioRef.current) audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 10); }}><RotateCcw size={16} /></button>
        <button type="button" className="play-button" aria-label={playing ? "暂停" : "播放"} disabled={!src} onClick={() => void toggle()}>
          {playing ? <Pause size={20} /> : <Play size={20} fill="currentColor" />}
        </button>
        <span className="timecode">{formatTime(currentTime)} <i>/</i> {formatTime(duration)}</span>
        <span className="transport-spacer" />
        <Volume2 size={17} />
        <input aria-label="播放音量" type="range" min={0} max={100} defaultValue={70} onChange={(event) => { if (audioRef.current) audioRef.current.volume = Number(event.target.value) / 100; }} />
        {downloadSrc ? <a className="transport-action" href={downloadSrc} download><Download size={15} />下载音频</a> : null}
      </div>
      {pcm ? <p className="playback-note">PCM 是原始音频流，请下载后按当前采样率与声道参数导入音频工具。</p> : null}
      {playbackError ? <p className="playback-error" role="alert">{playbackError}</p> : null}
    </section>
  );
}

export {Waveform};
