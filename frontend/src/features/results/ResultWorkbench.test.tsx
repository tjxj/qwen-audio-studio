import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ResultWorkbench from "./ResultWorkbench";
import { ValidationReport } from "./ValidationReport";
import { ResultPlayer } from "./ResultPlayer";
import { ABComparePlayer } from "./ABComparePlayer";
import { PlayerProvider } from "../player/PlayerProvider";
import { DEFAULT_PARAMS, type Job } from "../../types";

const job: Job = {
  id: "job-1",
  projectId: "project-1",
  projectName: "深夜电台 · 城市边缘的光",
  mode: "podcast",
  prompt: "【角色：旁白】城市的灯在脚下连成一片。",
  params: { ...DEFAULT_PARAMS, format: "mp3" },
  status: "success",
  createdAt: "2026-09-23T00:00:00Z",
  updatedAt: "2026-09-23T00:02:18Z",
  elapsedSeconds: 138,
  outputAssetId: "asset-1",
  report: {
    ffprobe: "pass",
    ffmpeg: "pass",
    requestId: "req-safe",
    durationSeconds: 30,
    sampleRate: 48000,
    channels: 2,
    bytes: 8210000,
    sha256: "7e3c9a0b2d4f6e8c",
  },
};
const variants = [
  job,
  {
    ...job,
    id: "job-2",
    outputAssetId: "asset-2",
    params: { ...job.params, seed: 87 },
  },
  {
    ...job,
    id: "job-3",
    outputAssetId: "asset-3",
    params: { ...job.params, seed: 126 },
  },
];

beforeEach(() => {
  // jsdom has no media engine. Preserve browser state/event semantics at that boundary.
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    Object.defineProperty(this, "paused", { configurable: true, value: false });
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    const wasPlaying = !this.paused;
    Object.defineProperty(this, "paused", { configurable: true, value: true });
    if (wasPlaying) this.dispatchEvent(new Event("pause"));
  });
});
afterEach(() => vi.restoreAllMocks());

describe("result workbench", () => {
  it("shows every generated version and allows searching the last one", async () => {
    const many = Array.from({ length: 7 }, (_, index) => ({
      ...job,
      id: `version-${index}`,
      params: { ...job.params, seed: 100 + index },
    }));
    render(<ResultWorkbench job={job} variants={many} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Seed 106/ }));
    expect(screen.getByRole("button", { name: /Seed 106/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.type(screen.getByRole("textbox", { name: "搜索版本" }), "106");
    expect(screen.getByRole("button", { name: /Seed 106/ })).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /Seed 105/ }),
    ).not.toBeInTheDocument();
  });
  it("keeps the URL-selected job current regardless of history order or reused route", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ResultWorkbench job={job} variants={[variants[1], job]} />,
    );
    expect(
      screen.getByRole("button", { name: "版本 A · Seed 42" }),
    ).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: /Seed 87/ }));
    const next = {
      ...job,
      id: "next-route",
      params: { ...job.params, seed: 900 },
    };
    rerender(<ResultWorkbench job={next} variants={[...variants, next]} />);
    expect(screen.getByRole("button", { name: /Seed 900/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
  it("reports final-version success only after the save succeeds", async () => {
    const setFinal = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({});
    const user = userEvent.setup();
    render(
      <ResultWorkbench job={job} variants={variants} onSetFinal={setFinal} />,
    );
    await user.click(screen.getByRole("button", { name: /Seed 87/ }));
    await user.click(screen.getByRole("button", { name: "设为最终版本" }));
    expect(screen.getByRole("alert")).toHaveTextContent("最终版本未保存");
    expect(screen.queryByText("已设为最终版本")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "设为最终版本" }));
    expect(screen.getByText("已设为最终版本")).toHaveAttribute(
      "role",
      "status",
    );
    expect(setFinal).toHaveBeenLastCalledWith("job-2");
    expect(
      screen.getByRole("button", { name: "当前为最终版本" }),
    ).toBeDisabled();
  });
  it("opens the real validation report in the detail tab", async () => {
    render(<ResultWorkbench job={job} />);
    await userEvent
      .setup()
      .click(screen.getByRole("tab", { name: "验收报告" }));
    expect(screen.getByText("req-safe")).toBeVisible();
    expect(screen.getAllByText("通过")).toHaveLength(2);
  });
  it("never presents missing or failed checks as passed", () => {
    const { rerender } = render(
      <ValidationReport job={{ ...job, report: undefined }} />,
    );
    expect(screen.queryAllByText("通过")).toHaveLength(0);
    expect(screen.getAllByText("未执行")).toHaveLength(2);
    rerender(
      <ValidationReport
        job={{
          ...job,
          report: { ...job.report!, ffprobe: "failed", ffmpeg: "not run" },
        }}
      />,
    );
    expect(screen.getByText("失败")).toBeVisible();
    expect(screen.getByText("未执行")).toBeVisible();
    expect(screen.queryByText("通过")).not.toBeInTheDocument();
  });
  it("keeps raw PCM downloadable without claiming browser playback", () => {
    render(
      <ResultWorkbench
        job={{ ...job, params: { ...job.params, format: "pcm" } }}
      />,
    );
    expect(screen.getByRole("button", { name: "播放" })).toBeDisabled();
    expect(screen.getByText(/PCM 是原始音频流/)).toBeVisible();
    expect(screen.getByRole("link", { name: "下载音频" })).toHaveAttribute(
      "href",
      "/api/media/asset-1?download=1",
    );
    expect(screen.getByRole("tab", { name: "A/B 对比" })).toBeDisabled();
  });
  it("saves a note for the selected version without changing other versions", async () => {
    const save = vi.fn().mockResolvedValue({});
    render(<ResultWorkbench job={job} variants={variants} onSaveNote={save} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Seed 87/ }));
    await user.type(
      screen.getByRole("textbox", { name: "版本备注" }),
      "语气自然",
    );
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(save).toHaveBeenCalledWith("job-2", "语气自然");
    expect(screen.getByText("版本备注已保存")).toBeVisible();
  });
});

describe("audio transport", () => {
  it("pauses a native preview removed during route changes", async () => {
    const { rerender } = render(
      <PlayerProvider>
        <audio aria-label="原生预览" src="/preview.wav" />
      </PlayerProvider>,
    );
    const preview = screen.getByLabelText("原生预览") as HTMLAudioElement;
    await preview.play();
    expect(preview.paused).toBe(false);
    rerender(
      <PlayerProvider>
        <p>另一个页面</p>
      </PlayerProvider>,
    );
    await waitFor(() => expect(preview.paused).toBe(true));
  });
  it("switches A/B at the same position with only one audible track, including the main player", async () => {
    render(
      <PlayerProvider>
        <ResultPlayer src="/main.wav" durationHint={30} />
        <ABComparePlayer variants={variants} />
      </PlayerProvider>,
    );
    const user = userEvent.setup();
    const main = screen.getByLabelText("当前版本音频") as HTMLAudioElement;
    const a = screen.getByLabelText("对比音频 A") as HTMLAudioElement;
    const b = screen.getByLabelText("对比音频 B") as HTMLAudioElement;
    await user.click(screen.getByRole("button", { name: "播放" }));
    expect(main.paused).toBe(false);
    await user.click(screen.getByRole("button", { name: "播放版本 A" }));
    a.currentTime = 12.4;
    fireEvent.timeUpdate(a);
    await user.click(screen.getByRole("button", { name: "播放版本 B" }));
    expect(main.paused).toBe(true);
    expect(a.currentTime).toBeCloseTo(12.4, 2);
    expect(b.currentTime).toBeCloseTo(12.4, 2);
    expect(
      [main, a, b].filter(
        (audio) => !audio.paused && !audio.muted && audio.volume > 0,
      ),
    ).toEqual([b]);
  });
  it("allows the third version in comparison and pauses old media on replacement", async () => {
    render(<ABComparePlayer variants={variants} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "播放版本 A" }));
    const a = screen.getByLabelText("对比音频 A") as HTMLAudioElement;
    await user.selectOptions(
      screen.getByRole("combobox", { name: "对比版本 A" }),
      "job-3",
    );
    expect(a.paused).toBe(true);
    expect(a).toHaveAttribute("src", "/api/media/asset-3");
  });
  it("limits shared playback to the shorter track and stops at the common end", async () => {
    render(
      <ABComparePlayer
        variants={[
          job,
          { ...variants[1], report: { ...job.report!, durationSeconds: 10 } },
        ]}
      />,
    );
    const user = userEvent.setup();
    expect(
      screen.getByRole("slider", { name: "对比播放进度" }),
    ).toHaveAttribute("max", "10");
    expect(screen.getByText(/两条音频时长不同/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "播放版本 A" }));
    const a = screen.getByLabelText("对比音频 A") as HTMLAudioElement;
    const b = screen.getByLabelText("对比音频 B") as HTMLAudioElement;
    a.currentTime = 10.2;
    fireEvent.timeUpdate(a);
    expect(a.paused).toBe(true);
    expect(b.paused).toBe(true);
    expect(a.currentTime).toBe(10);
    expect(b.currentTime).toBe(10);
  });
  it("seeks, rewinds, changes volume and rejects too-short loop selections", async () => {
    render(<ResultPlayer src="/main.wav" durationHint={30} />);
    const user = userEvent.setup();
    const audio = screen.getByLabelText("当前版本音频") as HTMLAudioElement;
    fireEvent.change(screen.getByRole("slider", { name: "播放进度" }), {
      target: { value: "22" },
    });
    expect(audio.currentTime).toBe(22);
    await user.click(screen.getByRole("button", { name: "后退 10 秒" }));
    expect(audio.currentTime).toBe(12);
    fireEvent.change(screen.getByRole("slider", { name: "播放音量" }), {
      target: { value: "25" },
    });
    expect(audio.volume).toBe(0.25);
    await user.click(screen.getByRole("checkbox", { name: "循环选区" }));
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "循环起点（秒）" }),
      { target: { value: "5" } },
    );
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "循环终点（秒）" }),
      { target: { value: "5.2" } },
    );
    expect(screen.getByRole("alert")).toHaveTextContent("至少 0.5 秒");
    await user.click(screen.getByRole("button", { name: "播放" }));
    expect(audio.paused).toBe(true);
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "循环终点（秒）" }),
      { target: { value: "6" } },
    );
    await user.click(screen.getByRole("button", { name: "播放" }));
    expect(audio.currentTime).toBe(5);
    audio.currentTime = 6.1;
    fireEvent.timeUpdate(audio);
    expect(audio.currentTime).toBe(5);
    expect(audio.paused).toBe(false);
  });
  it("stops on unmount and clears the old media when the source changes", async () => {
    const { rerender, unmount } = render(
      <ResultPlayer src="/first.wav" durationHint={30} />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "播放" }));
    const audio = screen.getByLabelText("当前版本音频") as HTMLAudioElement;
    audio.currentTime = 20;
    fireEvent.timeUpdate(audio);
    rerender(<ResultPlayer src="/second.wav" durationHint={10} />);
    expect(audio.paused).toBe(true);
    expect(audio.currentTime).toBe(0);
    expect(screen.getByRole("slider", { name: "播放进度" })).toHaveAttribute(
      "max",
      "10",
    );
    await user.click(screen.getByRole("button", { name: "播放" }));
    unmount();
    expect(audio.paused).toBe(true);
  });
  it("leaves a usable retry control after media loading fails", async () => {
    render(
      <ResultPlayer
        src="/missing.wav"
        durationHint={30}
        downloadSrc="/missing.wav"
      />,
    );
    const audio = screen.getByLabelText("当前版本音频") as HTMLAudioElement;
    fireEvent.error(audio);
    expect(screen.getByRole("alert")).toHaveTextContent("无法读取");
    expect(screen.getByRole("button", { name: "播放" })).toBeEnabled();
    await userEvent.setup().click(screen.getByRole("button", { name: "播放" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(audio.paused).toBe(false);
  });
  it("changing result tabs pauses the previous primary audio", async () => {
    render(<ResultWorkbench job={job} variants={variants} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "播放" }));
    const audio = screen.getByLabelText("当前版本音频") as HTMLAudioElement;
    await user.click(screen.getByRole("tab", { name: "A/B 对比" }));
    expect(audio.paused).toBe(true);
    expect(
      within(screen.getByRole("region", { name: "A / B 对比试听" })).getByRole(
        "button",
        { name: "播放版本 A" },
      ),
    ).toBeVisible();
  });
});
