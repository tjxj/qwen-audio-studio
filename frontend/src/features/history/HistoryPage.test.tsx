import {render, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {describe, expect, it, vi} from "vitest";
import HistoryPage from "./HistoryPage";

describe("history page", () => {
  it("retries a failed job", async () => {
    const retry = vi.fn();
    const user = userEvent.setup();
    render(
      <HistoryPage
        jobs={[
          {
            id: "failed-1",
            projectId: "p",
            projectName: "游戏 NPC · 铁匠",
            mode: "game",
            prompt: "台词",
            params: {
              format: "wav", sampleRate: 48000, channels: 2, volume: 50,
              rate: 1, seed: 42, enableCbr: false, bitRate: 128,
              quality: 5, enableAigcTag: false
            },
            status: "failed",
            createdAt: "2026-09-23",
            updatedAt: "2026-09-23",
            error: "已脱敏错误"
          }
        ]}
        onRetry={retry}
      />
    );
    await user.click(screen.getByRole("button", {name: "重试"}));
    expect(retry).toHaveBeenCalledWith("failed-1");
    expect(screen.getByText("已脱敏错误")).toBeVisible();
  });
});
