import { Repeat2 } from "lucide-react";
export interface LoopSelection {
  enabled: boolean;
  start: number;
  end: number;
}
export function validLoop(loop: LoopSelection, duration: number) {
  return (
    Number.isFinite(loop.start) &&
    Number.isFinite(loop.end) &&
    loop.start >= 0 &&
    loop.end <= duration &&
    loop.end - loop.start >= 0.5 - 0.00001
  );
}
export function LoopRegion({
  value,
  duration,
  onChange,
}: {
  value: LoopSelection;
  duration: number;
  onChange: (value: LoopSelection) => void;
}) {
  const valid = validLoop(value, duration);
  return (
    <div className="audio-loop">
      <label className="audio-loop-toggle">
        <input
          type="checkbox"
          checked={value.enabled}
          disabled={duration < 0.5}
          onChange={(event) =>
            onChange({ ...value, enabled: event.target.checked })
          }
        />
        <Repeat2 size={15} />
        循环选区
      </label>
      {value.enabled ? (
        <>
          <label>
            起点
            <input
              aria-label="循环起点（秒）"
              type="number"
              min={0}
              max={duration}
              step={0.1}
              value={value.start}
              onChange={(event) =>
                onChange({ ...value, start: Number(event.target.value) })
              }
            />
          </label>
          <label>
            终点
            <input
              aria-label="循环终点（秒）"
              type="number"
              min={0}
              max={duration}
              step={0.1}
              value={value.end}
              onChange={(event) =>
                onChange({ ...value, end: Number(event.target.value) })
              }
            />
          </label>
          <span>秒</span>
          {!valid ? (
            <span className="loop-error" role="alert">
              选区至少 0.5 秒，且不能超出音频。
            </span>
          ) : null}
        </>
      ) : (
        <span>可用键盘调整起止时间</span>
      )}
    </div>
  );
}
