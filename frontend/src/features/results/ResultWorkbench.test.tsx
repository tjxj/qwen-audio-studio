import {render, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {describe, expect, it, vi} from "vitest";
import ResultWorkbench from "./ResultWorkbench";
import type {Job} from "../../types";

const job: Job = {
  id: "job-1",
  projectId: "project-1",
  projectName: "深夜电台 · 城市边缘的光",
  mode: "podcast",
  prompt: "【角色：旁白】城市的灯在脚下连成一片。",
  params: {
    format: "mp3",
    sampleRate: 48000,
    channels: 2,
    volume: 50,
    rate: 1,
    seed: 42,
    enableCbr: true,
    bitRate: 320,
    quality: 5,
    enableAigcTag: false
  },
  status: "success",
  createdAt: "2026-09-23T00:00:00Z",
  updatedAt: "2026-09-23T00:02:18Z",
  elapsedSeconds: 138,
  outputAssetId: "asset-1",
  report: {
    ffprobe: "pass",
    ffmpeg: "pass",
    requestId: "req-safe",
    durationSeconds: 208.105,
    sampleRate: 48000,
    channels: 2,
    bytes: 8210000,
    sha256: "7e3c9a0b2d4f6e8c"
  }
};

describe("result workbench", () => {
  const variants = [
    job,
    {...job, id: "job-2", params: {...job.params, seed: 87}},
    {...job, id: "job-3", params: {...job.params, seed: 126}}
  ];

  it("renders variants, player controls, timeline and validation report", () => {
    render(<ResultWorkbench job={job} variants={variants} />);
    expect(screen.getByRole("button", {name: "版本 A · Seed 42"})).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Prompt 结构时间线")).toBeVisible();
    expect(screen.getByText("验收报告")).toBeVisible();
    expect(screen.getByText("req-safe")).toBeVisible();
    expect(screen.getAllByText("通过").length).toBeGreaterThanOrEqual(2);
  });

  it("switches seed variants and toggles synchronized comparison", async () => {
    const user = userEvent.setup();
    render(<ResultWorkbench job={job} variants={variants} />);
    await user.click(screen.getByRole("button", {name: "版本 B · Seed 87"}));
    expect(screen.getByRole("button", {name: "版本 B · Seed 87"})).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("同步播放")).toBeChecked();
    await user.click(screen.getByLabelText("同步播放"));
    expect(screen.getByLabelText("同步播放")).not.toBeChecked();
  });

  it("shows only real generated variants", () => {
    render(<ResultWorkbench job={job} variants={[job]} />);
    expect(screen.getByRole("button", {name: "版本 A · Seed 42"})).toBeVisible();
    expect(screen.queryByRole("button", {name: /版本 B/})).not.toBeInTheDocument();
    expect(screen.queryByText("A / B 对比试听")).not.toBeInTheDocument();
    expect(screen.getByText("Prompt 结构时间线")).toBeVisible();
  });

  it("marks the selected real variant as final", async () => {
    const setFinal = vi.fn();
    const user = userEvent.setup();
    render(<ResultWorkbench job={job} variants={variants} onSetFinal={setFinal} />);
    await user.click(screen.getByRole("button", {name: "版本 B · Seed 87"}));
    await user.click(screen.getByRole("button", {name: "设为最终版本"}));
    expect(setFinal).toHaveBeenCalledWith("job-2");
  });

  it("starts both real variants when synchronized comparison is enabled", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const user = userEvent.setup();
    render(<ResultWorkbench job={job} variants={variants} />);
    await user.click(screen.getByRole("button", {name: "播放版本 A"}));
    expect(play).toHaveBeenCalledTimes(2);
    play.mockRestore();
    pause.mockRestore();
  });

  it("keeps raw PCM downloadable without claiming browser playback", () => {
    render(<ResultWorkbench job={{...job, params:{...job.params, format:"pcm"}}} variants={[]} />);
    expect(screen.getByRole("button", {name:"播放"})).toBeDisabled();
    expect(screen.getByText(/PCM 是原始音频流/)).toBeVisible();
    expect(screen.getByRole("link", {name:"下载音频"})).toBeVisible();
  });

  it("keeps the URL-selected job as version A even when history order differs", () => {
    const newer = {...job, id:"job-newer", params:{...job.params, seed:99}};
    render(<ResultWorkbench job={job} variants={[newer, job]} />);
    expect(screen.getByRole("button", {name:"版本 A · Seed 42"})).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", {name:"版本 B · Seed 99"})).toBeVisible();
  });
});
