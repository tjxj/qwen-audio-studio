/** Every outbound official link lives here so updates only touch one file. */
export const helpLinks = {
  apiKey: "https://help.aliyun.com/zh/model-studio/get-api-key",
  workspaceId:
    "https://help.aliyun.com/zh/model-studio/obtain-the-app-id-and-workspace-id",
  audioApi: "https://help.aliyun.com/zh/model-studio/audio-generation-api",
  console: "https://bailian.console.aliyun.com/",
  font: "https://github.com/adobe-fonts/source-han-serif",
} as const;

export type HelpLinkKey = keyof typeof helpLinks;

export const modelBoundary = {
  id: "qwen-audio-3.1-tts-next",
  region: "华北2（北京）",
  maxReferenceCount: 3,
  maxReferenceSeconds: 30,
  maxCompiledChars: 3000,
} as const;
