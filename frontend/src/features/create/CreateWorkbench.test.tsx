import {fireEvent, render, screen, waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {describe, expect, it, vi} from "vitest";
import CreateWorkbench from "./CreateWorkbench";
import {DEFAULT_PARAMS} from "../../types";

describe("creation workbench", () => {
  it("inserts structured tags and applies an inspiration template", async () => {
    const user = userEvent.setup();
    render(
      <CreateWorkbench
        credentialsReady
        onSubmit={vi.fn()}
        onJobCreated={vi.fn()}
      />
    );
    const editor = screen.getByLabelText("场景提示词") as HTMLTextAreaElement;
    await user.clear(editor);
    await user.type(editor, "开场");
    editor.setSelectionRange(1, 1);
    await user.click(screen.getByRole("button", {name: "音效"}));
    expect(editor).toHaveValue("开【音效：请描述音效】场");

    await user.click(screen.getByRole("button", {name: /雨夜双人播客/}));
    expect(editor.value).toContain("窗外细雨");
  });

  it("loads mode-specific guidance, templates and starter prompts", async () => {
    const user = userEvent.setup();
    render(<CreateWorkbench credentialsReady onSubmit={vi.fn()} onJobCreated={vi.fn()} />);
    const editor = screen.getByLabelText("场景提示词");
    const cases = [
      {label: "广告", guide: "广告创作", template: "科技产品广告", prompt: "未来，此刻就在你手中"},
      {label: "有声书", guide: "有声书创作", template: "天台夜话", prompt: "你说，我们是不是"},
      {label: "广播剧", guide: "广播剧创作", template: "凌晨两点的便利店", prompt: "关东煮卖完了"},
      {label: "游戏配音", guide: "游戏配音创作", template: "古槐树下的老村长", prompt: "后山那边"},
      {label: "旁白", guide: "旁白创作", template: "AI 趋势解说", prompt: "一个人的创作能力"},
      {label: "自定义", guide: "自定义创作", template: "自定义声音场景", prompt: "请在这里定义"}
    ];

    for (const item of cases) {
      await user.click(screen.getByRole("button", {name: item.label}));
      expect(screen.getByRole("heading", {name: item.guide})).toBeVisible();
      expect(screen.getByRole("button", {name: new RegExp(item.template)})).toBeVisible();
      expect((editor as HTMLTextAreaElement).value).toContain(item.prompt);
    }
  });

  it("preserves a hand-edited prompt while changing the mode template rail", async () => {
    const user = userEvent.setup();
    render(<CreateWorkbench credentialsReady onSubmit={vi.fn()} onJobCreated={vi.fn()} />);
    const editor = screen.getByLabelText("场景提示词");
    await user.clear(editor);
    await user.type(editor, "这是一段我自己写的提示词");
    await user.click(screen.getByRole("button", {name: "广播剧"}));
    expect(editor).toHaveValue("这是一段我自己写的提示词");
    expect(screen.getByRole("button", {name: /凌晨两点的便利店/})).toBeVisible();
  });

  it("disables generation until credentials are configured", () => {
    render(
      <CreateWorkbench
        credentialsReady={false}
        onSubmit={vi.fn()}
        onJobCreated={vi.fn()}
      />
    );
    expect(screen.getByRole("button", {name: "生成音频"})).toBeDisabled();
    expect(screen.getByText("请先在设置中配置 API Key 与 Workspace ID")).toBeVisible();
  });

  it("shows MP3 controls and submits official parameters", async () => {
    const onSubmit = vi.fn().mockResolvedValue({id: "job-1"});
    const onJobCreated = vi.fn();
    const user = userEvent.setup();
    render(
      <CreateWorkbench
        credentialsReady
        onSubmit={onSubmit}
        onJobCreated={onJobCreated}
      />
    );

    await user.selectOptions(screen.getByLabelText("输出格式"), "mp3");
    expect(screen.getByLabelText("MP3 质量")).toBeVisible();
    fireEvent.change(screen.getByLabelText("随机种子"), {
      target: {value: "87"}
    });
    await user.click(screen.getByRole("button", {name: "生成音频"}));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].params).toMatchObject({
      format: "mp3",
      seed: 87,
      sample_rate: 48000,
      channels: 2
    });
    expect(onJobCreated).toHaveBeenCalledWith("job-1");
  });

  it("requires explicit confirmation before submitting references", async () => {
    const onSubmit = vi.fn().mockResolvedValue({id: "job-2"});
    const user = userEvent.setup();
    render(
      <CreateWorkbench
        credentialsReady
        initialReferences={[
          {
            id: "ref-1",
            name: "voice.wav",
            duration_seconds: 8,
            bytes: 1200,
            codec: "pcm_s16le",
            consent_token: "consent"
          }
        ]}
        onSubmit={onSubmit}
        onJobCreated={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", {name: "生成音频"}));
    expect(screen.getByRole("dialog", {name: "确认上传参考音频"})).toBeVisible();
    expect(onSubmit).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", {name: "确认上传并生成"}));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });

  it("continues an existing project for additional seed versions", async () => {
    const onSubmit = vi.fn().mockResolvedValue({id: "job-next"});
    const user = userEvent.setup();
    render(<CreateWorkbench credentialsReady initialProject={{id:"project-1",name:"续作项目",mode:"narration",prompt:"旧稿",params:DEFAULT_PARAMS,createdAt:"",updatedAt:"",archived:false}} onSubmit={onSubmit} onJobCreated={vi.fn()} />);
    expect(screen.getByLabelText("场景名称")).toHaveValue("续作项目");
    expect(screen.getByLabelText("场景提示词")).toHaveValue("旧稿");
    await user.click(screen.getByRole("button", {name:"生成音频"}));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({project_id:"project-1",project_name:"续作项目"});
  });
});
