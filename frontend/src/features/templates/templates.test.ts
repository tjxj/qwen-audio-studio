import {
  applyTemplateToDraft,
  choiceFromPreview,
  consumePendingTemplate,
  savePendingTemplate,
  type StudioTemplate,
  type TemplatePreview,
} from "./templatesApi";
import { DEFAULT_PARAMS, type DraftFields } from "../../types";

test("应用模板默认保留声音和输出参数，快照可以完整撤销", () => {
  const original: DraftFields = {
    name: "手稿",
    mode: "auto",
    prompt: "原有内容",
    params: { ...DEFAULT_PARAMS, rate: 1.3 },
    referenceBindings: [{ referenceId: "voice_1", alias: "主持人" }],
    outputDirectoryId: "dir_1",
    templateApplication: null,
  };
  const next = applyTemplateToDraft(original, {
    prompt: "新内容",
    mode: "podcast",
    templateApplication: {
      templateId: "rain-podcast",
      templateVersion: 2,
      values: { show: "小节目" },
    },
  });
  expect(next.prompt).toBe("新内容");
  expect(next.params).toBe(original.params);
  expect(next.referenceBindings).toBe(original.referenceBindings);
  expect(next.outputDirectoryId).toBe("dir_1");
  expect(original.prompt).toBe("原有内容");
  expect(original.templateApplication).toBeNull();
});

test("只将用户主动应用的预设转换为客户端参数", () => {
  const template = {
    id: "coffee-ad",
    mode: "advertisement",
    version: 2,
  } as StudioTemplate;
  const preview: TemplatePreview = {
    prompt: "预览",
    values: { brand: "木雀" },
    params_preset: { sample_rate: 24000, volume: 30 },
    compiled_prompt: "预览",
    compiled_chars: 2,
    max_chars: 3000,
    missing_roles: [],
    can_apply: true,
    params_diff: {},
  };
  const result = choiceFromPreview(template, preview);
  expect(result.paramsPreset).toEqual({ sampleRate: 24000, volume: 30 });
  expect(
    choiceFromPreview(template, { ...preview, params_preset: null })
      .paramsPreset,
  ).toBeUndefined();
});

test("跨页应用只保存一次待确认内容并可消费，不保存音色或凭据", () => {
  const choice = {
    prompt: "脚本",
    mode: "podcast" as const,
    templateApplication: {
      templateId: "intro-podcast",
      templateVersion: 2,
      values: { show: "书店" },
    },
  };
  savePendingTemplate(choice);
  expect(consumePendingTemplate()).toEqual(choice);
  expect(consumePendingTemplate()).toBeNull();
});
import { test, expect } from "vitest";
