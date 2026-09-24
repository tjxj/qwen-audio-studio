import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ReferenceLibraryPage from "./ReferenceLibraryPage";

describe("reference library page", () => {
  it("validates a local reference and explains its upload boundary", async () => {
    const prepare = vi.fn().mockResolvedValue({
      id: "ref-1",
      name: "voice.wav",
      duration_seconds: 4.2,
      bytes: 2048,
      codec: "pcm_s16le",
      consent_token: "token",
    });
    const user = userEvent.setup();
    render(<ReferenceLibraryPage onPrepare={prepare} />);
    const input = screen.getByLabelText("选择参考音频");
    await user.upload(
      input,
      new File(["audio"], "voice.wav", { type: "audio/wav" }),
    );
    await waitFor(() => expect(prepare).toHaveBeenCalledTimes(1));
    expect(screen.getByText("voice.wav")).toBeVisible();
    expect(screen.getByText(/尚未发送到云端/)).toBeVisible();
  });
});
