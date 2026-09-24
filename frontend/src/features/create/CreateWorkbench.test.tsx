import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CreateWorkbench, { type CreateWorkbenchProps } from "./CreateWorkbench";
import { DEFAULT_PARAMS } from "../../types";
import builtinTemplates from "../../../../backend/data/templates.json";

beforeEach(() => {
  sessionStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, options?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === "/api/session")
        return new Response(
          JSON.stringify({
            csrf_token: "test",
            credentials: {
              api_key_configured: true,
              workspace_configured: true,
            },
          }),
        );
      if (url.pathname === "/api/settings")
        return new Response(
          JSON.stringify({
            revision: 1,
            script_font: "serif",
            script_font_size: 16,
            max_workers: 2,
            theme: "light",
            default_directory_id: "dir_default",
            default_params: {},
          }),
        );
      if (url.pathname.startsWith("/api/directories/"))
        return new Response(
          JSON.stringify({
            id: "dir_default",
            display_name: "音频作品",
            writable: true,
          }),
        );
      if (url.pathname === "/api/templates") {
        const templates = builtinTemplates.filter(
          (template) =>
            !url.searchParams.get("mode") ||
            template.mode === url.searchParams.get("mode"),
        );
        return new Response(
          JSON.stringify({
            items: templates.map((template) => ({
              ...template,
              favorite: false,
            })),
            total: templates.length,
            page: 1,
            page_size: 50,
          }),
        );
      }
      if (url.pathname.endsWith("/preview")) {
        const template = builtinTemplates.find(
          (item) => item.id === url.pathname.split("/")[3],
        )!;
        const { values } = JSON.parse(String(options?.body));
        const resolved = {
          ...Object.fromEntries(
            template.variables.map((variable) => [
              variable.key,
              variable.default,
            ]),
          ),
          ...values,
        };
        const prompt = template.prompt_pattern.replace(
          /\{\{\s*(\w+)\s*\}\}/g,
          (_, key: string) => resolved[key],
        );
        return new Response(
          JSON.stringify({
            prompt,
            compiled_prompt: prompt,
            compiled_chars: Array.from(prompt).length,
            max_chars: 3000,
            values: resolved,
            missing_roles: [],
            can_apply: true,
            params_preset: null,
            params_diff: {},
          }),
        );
      }
      throw new Error("Unexpected test API: " + url.pathname);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

function mount(overrides: Partial<CreateWorkbenchProps> = {}) {
  const onSubmit = vi.fn().mockResolvedValue({ id: "job-1" });
  const onJobCreated = vi.fn();
  const props = {
    credentialsReady: true,
    onSubmit,
    onJobCreated,
    ...overrides,
  };
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={cache}>
      <MemoryRouter>
        <CreateWorkbench {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return props;
}

describe("creation workbench", () => {
  it("inserts structured tags, previews variables, confirms replacement and undoes it", async () => {
    const user = userEvent.setup();
    const { onSubmit } = mount();
    const editor = screen.getByLabelText("场景提示词") as HTMLTextAreaElement;
    await user.clear(editor);
    await user.type(editor, "开场");
    editor.setSelectionRange(1, 1);
    await user.click(screen.getByRole("button", { name: "音效" }));
    expect(editor).toHaveValue("开【音效：请描述音效】场");
    await user.click(screen.getByRole("button", { name: "雨夜陪伴" }));
    const picker = await screen.findByRole("dialog", { name: "灵感模板" });
    const field = await within(picker).findByLabelText("节目名称");
    await user.clear(field);
    await user.type(field, "午夜书桌");
    await waitFor(() =>
      expect(within(picker).getByText(/这里是《午夜书桌》/)).toBeVisible(),
    );
    await user.click(
      within(picker).getByRole("button", { name: "应用到创作台" }),
    );
    expect(editor).toHaveValue("开【音效：请描述音效】场");
    await user.click(
      within(screen.getByRole("dialog", { name: "替换当前文案？" })).getByRole(
        "button",
        { name: "确认替换" },
      ),
    );
    expect(editor.value).toContain("午夜书桌");
    expect(editor.value).toContain("窗外细雨");
    expect(onSubmit).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "撤销应用模板" }));
    expect(editor).toHaveValue("开【音效：请描述音效】场");
    await user.click(screen.getByRole("button", { name: "广播剧" }));
    expect(editor).toHaveValue("开【音效：请描述音效】场");
  }, 15000);

  it("loads seven distinct workflows and their original starter prompts", async () => {
    const user = userEvent.setup();
    mount();
    const editor = screen.getByLabelText("场景提示词");
    const cases = [
      {
        label: "广告",
        guide: "广告创作",
        template: "科技产品",
        prompt: "空白的墙，今晚有了新的故事",
      },
      {
        label: "有声书",
        guide: "有声书创作",
        template: "都市叙事",
        prompt: "没有立刻开灯",
      },
      {
        label: "广播剧",
        guide: "广播剧创作",
        template: "古风相逢",
        prompt: "这把伞，你竟还留着",
      },
      {
        label: "游戏配音",
        guide: "游戏配音创作",
        template: "村庄任务",
        prompt: "东坡风车旁",
      },
      {
        label: "旁白",
        guide: "旁白创作",
        template: "科技解说",
        prompt: "理解语音合成",
      },
      {
        label: "自定义",
        guide: "自定义创作",
        template: "单人声音场景",
        prompt: "灯已经亮了",
      },
      {
        label: "播客",
        guide: "播客创作",
        template: "雨夜陪伴",
        prompt: "今晚不赶路",
      },
    ];
    for (const item of cases) {
      await user.click(screen.getByRole("button", { name: item.label }));
      expect(screen.queryByRole("heading", { name: item.guide })).not.toBeInTheDocument();
      expect(screen.getByRole('button',{name:item.label})).toHaveAttribute('aria-pressed','true');
      expect(screen.getByRole("button", { name: item.template })).toBeVisible();
      expect((editor as HTMLTextAreaElement).value).toContain(item.prompt);
    }
  }, 15000);

  it("preserves a hand-edited prompt while changing the mode template rail", async () => {
    const user = userEvent.setup();
    mount();
    const editor = screen.getByLabelText("场景提示词");
    await user.clear(editor);
    await user.type(editor, "这是一段我自己写的提示词");
    await user.click(screen.getByRole("button", { name: "广播剧" }));
    expect(editor).toHaveValue("这是一段我自己写的提示词");
    expect(screen.getByRole("button", { name: "古风相逢" })).toBeVisible();
  });

  it("disables generation until credentials are configured but leaves editing available", () => {
    mount({ credentialsReady: false });
    expect(screen.getByRole("button", { name: "生成音频" })).toBeDisabled();
    expect(
      screen.getByRole("link", { name: "配置 API Key 与 Workspace ID" }),
    ).toHaveAttribute("href", "/settings");
    expect(screen.getByLabelText("场景提示词")).toBeEnabled();
  });

  it("uses advanced MP3 controls and waits for explicit generation confirmation", async () => {
    const user = userEvent.setup();
    const onPreflight = vi
      .fn()
      .mockResolvedValue({
        compiled_prompt: "编译后的完整脚本",
        compiled_chars: 14,
      });
    const { onSubmit, onJobCreated } = mount({ onPreflight });
    await user.selectOptions(screen.getByLabelText("输出格式"), "mp3");
    await user.click(screen.getByRole("button", { name: "高级设置" }));
    const advanced = screen.getByRole("dialog", { name: "高级输出设置" });
    expect(within(advanced).getByLabelText("MP3 质量")).toBeVisible();
    fireEvent.change(within(advanced).getByLabelText("随机种子"), {
      target: { value: "87" },
    });
    await user.click(within(advanced).getByRole("button", { name: "完成" }));
    await user.click(screen.getByRole("button", { name: "2 个候选" }));
    await user.click(screen.getByRole("button", { name: "生成音频" }));
    const confirm = await screen.findByRole("dialog", { name: "确认生成" });
    expect(onPreflight).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(within(confirm).getByText("编译后的完整脚本")).toBeVisible();
    expect(within(confirm).getByText(/87 \/ 88/)).toBeVisible();
    await user.click(
      within(confirm).getByRole("button", { name: "确认并生成" }),
    );
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(vi.mocked(onSubmit).mock.calls[0][0]).toMatchObject({
      params: { format: "mp3", seed: 87, sample_rate: 48000, channels: 2 },
      candidate_seeds: [87, 88],
    });
    expect(onJobCreated).toHaveBeenCalledWith("job-1");
  });

  it("requires explicit confirmation before submitting references", async () => {
    const user = userEvent.setup();
    const { onSubmit } = mount({
      initialReferences: [
        {
          id: "ref-1",
          name: "voice.wav",
          duration_seconds: 8,
          bytes: 1200,
          codec: "pcm_s16le",
          consent_token: "consent",
        },
      ],
    });
    await user.click(screen.getByRole("button", { name: "生成音频" }));
    const dialog = await screen.findByRole("dialog", {
      name: "确认上传参考音频",
    });
    expect(dialog).toBeVisible();
    expect(within(dialog).getByText(/voice.wav · 8 秒/)).toBeVisible();
    expect(onSubmit).not.toHaveBeenCalled();
    await user.click(
      within(dialog).getByRole("button", { name: "确认上传并生成" }),
    );
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });

  it("continues an existing project after preflight and confirmation", async () => {
    const user = userEvent.setup();
    const { onSubmit } = mount({
      initialProject: {
        id: "project-1",
        name: "续作项目",
        mode: "narration",
        prompt: "旧稿",
        params: DEFAULT_PARAMS,
        referenceBindings: [],
        templateApplication: null,
        outputDirectoryId: null,
        revision: 3,
        createdAt: "",
        updatedAt: "",
        archived: false,
      },
    });
    expect(screen.getByLabelText("场景名称")).toHaveValue("续作项目");
    expect(screen.getByLabelText("场景提示词")).toHaveValue("旧稿");
    await user.click(screen.getByRole("button", { name: "生成音频" }));
    await user.click(
      within(await screen.findByRole("dialog", { name: "确认生成" })).getByRole(
        "button",
        { name: "确认并生成" },
      ),
    );
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(vi.mocked(onSubmit).mock.calls[0][0]).toMatchObject({
      project_id: "project-1",
      project_name: "续作项目",
      prompt: "旧稿",
    });
  });

  it("never submits when server-side preflight reports an error", async () => {
    const user = userEvent.setup();
    const { onSubmit } = mount({
      onPreflight: vi
        .fn()
        .mockRejectedValue(new Error("编译后超过 3000 字，请精简脚本。")),
    });
    await user.click(screen.getByRole("button", { name: "生成音频" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "编译后超过 3000 字",
    );
    expect(onSubmit).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("dialog", { name: "确认生成" }),
    ).not.toBeInTheDocument();
  });

  it("hides new-draft creation in the overflow menu", async () => {
    const user = userEvent.setup();
    const onNewProject = vi.fn();
    mount({ onNewProject });
    expect(
      screen.queryByRole("button", { name: /新建/ }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "更多草稿操作" }));
    await user.click(screen.getByRole("button", { name: /空白草稿/ }));
    expect(onNewProject).toHaveBeenCalledTimes(1);
  });
});
