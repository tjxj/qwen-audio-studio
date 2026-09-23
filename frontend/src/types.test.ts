import {describe, expect, it} from "vitest";
import {DEFAULT_PARAMS} from "./types";

describe("shared audio contracts", () => {
  it("defines safe Next defaults", () => {
    expect(DEFAULT_PARAMS).toMatchObject({
      format: "wav",
      sampleRate: 48000,
      channels: 2,
      volume: 50,
      rate: 1,
      seed: 42
    });
  });
});
