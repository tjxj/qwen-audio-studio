import {Clock3, MessageSquareText, Music2, Sparkles, UserRound} from "lucide-react";
import type {PromptTag} from "./editor";

const tags: Array<{tag: PromptTag; icon: typeof Clock3}> = [
  {tag: "角色", icon: UserRound},
  {tag: "对白", icon: MessageSquareText},
  {tag: "时间戳", icon: Clock3},
  {tag: "音效", icon: Sparkles},
  {tag: "音乐", icon: Music2}
];

export function PromptTagToolbar({
  onInsert
}: {
  onInsert: (tag: PromptTag) => void;
}) {
  return (
    <div className="prompt-toolbar" aria-label="提示词标签">
      {tags.map(({tag, icon: Icon}) => (
        <button key={tag} type="button" onClick={() => onInsert(tag)}>
          <Icon size={16} strokeWidth={1.7} />
          {tag}
        </button>
      ))}
    </div>
  );
}
