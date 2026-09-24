import {
  AudioLines,
  BookOpen,
  FileAudio,
  Gamepad2,
  Megaphone,
  MessageCircleMore,
  RadioTower,
} from "lucide-react";
import type { CreationMode } from "../../types";

const modes: Array<{
  value: CreationMode;
  label: string;
  icon: typeof AudioLines;
}> = [
  { value: "podcast", label: "播客", icon: RadioTower },
  { value: "advertisement", label: "广告", icon: Megaphone },
  { value: "audiobook", label: "有声书", icon: BookOpen },
  { value: "drama", label: "广播剧", icon: MessageCircleMore },
  { value: "game", label: "游戏配音", icon: Gamepad2 },
  { value: "narration", label: "旁白", icon: FileAudio },
  { value: "auto", label: "自定义", icon: AudioLines },
];

export function ModeSelector({
  value,
  onChange,
}: {
  value: CreationMode;
  onChange: (mode: CreationMode) => void;
}) {
  return (
    <div className="mode-selector" aria-label="创作模式">
      {modes.map(({ value: mode, label, icon: Icon }) => (
        <button
          key={mode}
          type="button"
          className={value === mode ? "mode-button is-active" : "mode-button"}
          aria-pressed={value === mode}
          onClick={() => onChange(mode)}
        >
          <Icon size={18} strokeWidth={1.7} />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
