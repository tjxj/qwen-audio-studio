import {MessageSquareText, Music2, Sparkles, UserRound} from "lucide-react";

const metadata = {
  "角色": {icon: UserRound, color: "purple"},
  "对白": {icon: MessageSquareText, color: "blue"},
  "音效": {icon: Sparkles, color: "green"},
  "音乐": {icon: Music2, color: "amber"}
};

function promptTracks(prompt: string) {
  const grouped: Record<string, string[]> = {};
  for (const match of prompt.matchAll(/【(角色|对白|音效|音乐)(?:：([^】]+))?】([^【\n]*)/g)) {
    const label = match[1];
    const text = [match[2], match[3]].filter(Boolean).join(" · ").trim();
    if (text) (grouped[label] ||= []).push(text.slice(0, 40));
  }
  return Object.entries(grouped).map(([label, clips]) => ({label, clips, ...metadata[label as keyof typeof metadata]}));
}

export function AudioEventTimeline({prompt}: {prompt: string}) {
  const tracks = promptTracks(prompt);
  return (
    <section className="event-timeline">
      <div className="timeline-heading">
        <strong>Prompt 结构时间线</strong>
        <span>按提示词顺序展示</span>
      </div>
      <div className="timeline-tracks">
        {tracks.map(({label, icon: Icon, color, clips}) => (
          <div className="timeline-track" key={label}>
            <label><Icon size={14} />{label}</label>
            <div className={"clips " + color}>
              {clips.map((clip, index) => <span key={label + "-" + index} style={{gridColumn: index * 2 + 1 + " / span 2"}}>{clip}</span>)}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
