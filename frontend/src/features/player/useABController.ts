import { useEffect, useRef, useState } from "react";
import { usePlaybackCoordinator } from "./PlayerProvider";
import { validLoop, type LoopSelection } from "./LoopRegion";

/** One playing track, one shared clock. Paused alternatives are positioned on each update. */
export function useABController(
  sources: Array<string | undefined>,
  durationHints: number[] = [],
) {
  const audioRefs = useRef<Array<HTMLAudioElement | null>>([]);
  const playback = usePlaybackCoordinator();
  const epoch = useRef(0);
  const sourceKey = sources.join("\n");
  const [selected, setSelected] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [durations, setDurations] = useState(durationHints);
  const [volume, setVolume] = useState(0.7);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const knownDurations = durations.filter(
    (value) => Number.isFinite(value) && value > 0,
  );
  const duration =
    knownDurations.length === sources.length ? Math.min(...knownDurations) : 0;
  const [loop, setLoop] = useState<LoopSelection>({
    enabled: false,
    start: 0,
    end: 0,
  });
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  useEffect(() => {
    epoch.current += 1;
    const elements = [...audioRefs.current];
    elements.forEach((audio) => {
      if (audio) {
        playback.release(audio);
        audio.currentTime = 0;
        audio.volume = volume;
      }
    });
    setSelected(0);
    setPlaying(false);
    setPosition(0);
    setDurations(durationHints);
    setError("");
    setNotice("");
    const positiveHints = durationHints.filter(
      (value) => Number.isFinite(value) && value > 0,
    );
    setLoop({
      enabled: false,
      start: 0,
      end: positiveHints.length ? Math.min(...positiveHints) : 0,
    });
    return () => {
      epoch.current += 1;
      elements.forEach((audio) => {
        if (audio) playback.release(audio);
      });
    };
    // Reset only for an actual media change, not background metadata refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey, playback]);

  const seek = (next: number) => {
    const safe = Math.max(
      0,
      Math.min(Number.isFinite(next) ? next : 0, duration),
    );
    if (next > duration) setNotice("已定位到两条音频的共同区间末尾。");
    audioRefs.current.forEach((audio) => {
      if (audio) audio.currentTime = safe;
    });
    setPosition(safe);
  };
  const pause = () => {
    epoch.current += 1;
    audioRefs.current.forEach((audio) => audio?.pause());
    setPlaying(false);
  };
  const play = async (index = selected) => {
    const target = audioRefs.current[index];
    if (!target || !sources[index]) return;
    if (loop.enabled && !validLoop(loop, duration)) {
      setError("请调整循环范围：至少 0.5 秒，且不能超出音频。");
      return;
    }
    const current = audioRefs.current[selectedRef.current];
    const time = current?.currentTime ?? position;
    audioRefs.current.forEach((audio) => audio?.pause());
    const limit = duration || Math.max(0, time);
    let next = Math.min(time, limit);
    if (loop.enabled && (next < loop.start || next >= loop.end))
      next = loop.start;
    if (time > limit) setNotice("两条音频长度不同，播放位置已限制在共同区间。");
    if (duration > 0 && next >= duration) {
      next = 0;
      setNotice(
        sources.length > 1
          ? "共同区间已播放完，重新从开头试听。"
          : "音频已播放完，重新从开头试听。",
      );
    }
    audioRefs.current.forEach((audio) => {
      if (audio) {
        audio.currentTime = next;
        audio.volume = volume;
      }
    });
    setSelected(index);
    selectedRef.current = index;
    setPosition(next);
    setError("");
    const token = ++epoch.current;
    playback.claim(target);
    try {
      await target.play();
      if (token !== epoch.current || !playback.owns(target)) {
        target.pause();
        return;
      }
      setPlaying(true);
    } catch {
      if (token === epoch.current) {
        target.pause();
        setPlaying(false);
        setError("音频加载或播放失败。请重试，或下载后在本地打开。");
      }
    }
  };
  const onTimeUpdate = (index: number) => {
    if (index !== selectedRef.current) return;
    const audio = audioRefs.current[index];
    if (!audio) return;
    let next = audio.currentTime;
    if (loop.enabled && validLoop(loop, duration) && next >= loop.end)
      next = loop.start;
    else if (duration && next >= duration) {
      next = duration;
      pause();
    }
    audioRefs.current.forEach((element, cursor) => {
      if (element && (cursor !== index || next !== audio.currentTime))
        element.currentTime = next;
    });
    setPosition(next);
  };
  const onMetadata = (index: number) => {
    const value = audioRefs.current[index]?.duration;
    if (!value || !Number.isFinite(value)) return;
    setDurations((current) => {
      const next = [...current];
      next[index] = value;
      return next;
    });
    setLoop((current) =>
      current.enabled
        ? current
        : {
            ...current,
            end:
              current.end > 0 && Number.isFinite(current.end)
                ? Math.min(current.end, value)
                : value,
          },
    );
  };
  const changeVolume = (next: number) => {
    const safe = Math.max(0, Math.min(1, next));
    setVolume(safe);
    audioRefs.current.forEach((audio) => {
      if (audio) audio.volume = safe;
    });
  };
  return {
    audioRefs,
    selected,
    playing,
    position,
    duration,
    durations,
    volume,
    error,
    notice,
    loop,
    setLoop,
    seek,
    pause,
    play,
    changeVolume,
    onTimeUpdate,
    onMetadata,
    onPause: (index: number) => {
      if (index === selectedRef.current) setPlaying(false);
    },
    onError: () => {
      pause();
      setError("音频文件无法读取，请检查文件是否仍在原位置，或重新下载。");
    },
    onEnded: () => {
      if (loop.enabled && validLoop(loop, duration)) {
        seek(loop.start);
        void play();
      } else pause();
    },
  };
}
