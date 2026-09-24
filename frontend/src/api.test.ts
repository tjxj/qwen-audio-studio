import { describe, expect, it, vi } from "vitest";

describe("API session bootstrap", () => {
  it("fetches a CSRF session before a direct-route reference mutation", async () => {
    vi.resetModules();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            csrf_token: "csrf-safe",
            credentials: {
              api_key_configured: false,
              workspace_configured: false,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "ref",
            name: "voice.wav",
            duration_seconds: 1,
            bytes: 4,
            codec: "pcm_s16le",
            consent_token: "consent",
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { prepareReference } = await import("./api");
    await prepareReference(
      new File(["data"], "voice.wav", { type: "audio/wav" }),
    );
    expect(fetchMock.mock.calls[0][0]).toBe("/api/session");
    expect(fetchMock.mock.calls[1][1].headers["X-Qwen-Studio-CSRF"]).toBe(
      "csrf-safe",
    );
    vi.unstubAllGlobals();
  });
});
