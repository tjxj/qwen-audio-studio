export type PromptTag = "角色" | "对白" | "时间戳" | "音效" | "音乐";

const placeholders: Record<PromptTag, string> = {
  角色: "请描述角色",
  对白: "请填写对白",
  时间戳: "0.0s–5.0s",
  音效: "请描述音效",
  音乐: "请描述音乐"
};

export function insertTag(
  source: string,
  selection: {start: number; end: number},
  tag: PromptTag
) {
  const selected = source.slice(selection.start, selection.end);
  const content = selected || placeholders[tag];
  const block = `【${tag}：${content}】`;
  const text =
    source.slice(0, selection.start) + block + source.slice(selection.end);
  const cursor = selection.start + block.length;
  return {text, selection: {start: cursor, end: cursor}};
}
