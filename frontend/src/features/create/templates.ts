import type { CreationMode } from "../../types";
import builtinTemplates from "../../../../backend/data/templates.json";

export interface InspirationTemplate {
  id: string;
  title: string;
  subtitle: string;
  mode: CreationMode;
  duration: string;
  prompt: string;
}

export const modeProfiles: Record<
  CreationMode,
  { title: string; description: string; detail: string }
> = {
  podcast: {
    title: "播客创作",
    description: "自然对谈与稳定声场",
    detail:
      "适合双人访谈、深夜陪伴和知识聊天，重点描述主播差异、停顿与环境底噪。",
  },
  advertisement: {
    title: "广告创作",
    description: "短时长、高记忆点、强节奏",
    detail:
      "适合品牌片头与产品广告，建议明确开场音效、核心卖点、品牌落版和音乐淡出。",
  },
  audiobook: {
    title: "有声书创作",
    description: "旁白叙事与角色对白",
    detail:
      "适合小说章节和故事片段，建议区分旁白、人物声线、场景氛围与段落节奏。",
  },
  drama: {
    title: "广播剧创作",
    description: "多角色、动作音效与空间变化",
    detail: "适合悬疑、情感和科幻短剧，重点编排角色出场、动作先后与远近声场。",
  },
  game: {
    title: "游戏配音创作",
    description: "NPC 台词与世界环境声",
    detail:
      "适合任务对白、战斗播报和交互语音，建议写清角色身份、状态、触发情境和环境事件。",
  },
  narration: {
    title: "旁白创作",
    description: "单人讲述与清晰信息传达",
    detail:
      "适合科技解说、纪录片和教程，重点控制声线、语速、重音、停顿与背景克制程度。",
  },
  auto: {
    title: "自定义创作",
    description: "自由组合完整声音场景",
    detail: "从空白结构开始，自由组合角色、对白、时间戳、音效与音乐。",
  },
};

// Shared original catalog; preview and final compilation stay on the server.
export const inspirationTemplates: InspirationTemplate[] = builtinTemplates.map(
  (template) => {
    const values: Record<string, string> = Object.fromEntries(
      template.variables.map((variable) => [
        variable.key,
        String(variable.default),
      ]),
    );
    return {
      id: template.id,
      title: template.name,
      subtitle: template.description,
      mode: template.mode as CreationMode,
      duration: `建议 ${template.suggested_duration_seconds} 秒`,
      prompt: template.prompt_pattern.replace(
        /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g,
        (_, key: string) => values[key] ?? "",
      ),
    };
  },
);
