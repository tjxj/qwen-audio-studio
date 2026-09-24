export function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00.0";
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${(seconds % 60).toFixed(1).padStart(4, "0")}`;
}

export function SeekBar({
  position,
  duration,
  onSeek,
  label = "播放进度",
}: {
  position: number;
  duration: number;
  onSeek: (next: number) => void;
  label?: string;
}) {
  return (
    <div className="audio-seek">
      <input
        aria-label={label}
        aria-valuetext={`${formatTime(position)}，共 ${formatTime(duration)}`}
        type="range"
        min={0}
        max={duration || 0}
        step={0.01}
        value={Math.min(position, duration)}
        disabled={!duration}
        onChange={(event) => onSeek(Number(event.target.value))}
      />
      <div>
        <time>{formatTime(position)}</time>
        <time>{formatTime(duration)}</time>
      </div>
    </div>
  );
}
