import { describe, expect, it } from "vitest";
import { insertTag } from "./editor";

describe("structured prompt editor", () => {
  it("inserts an audio effect block at the selection", () => {
    expect(insertTag("开场", { start: 1, end: 1 }, "音效")).toEqual({
      text: "开【音效：请描述音效】场",
      selection: { start: 11, end: 11 },
    });
  });

  it("wraps selected dialogue text", () => {
    expect(insertTag("你好世界", { start: 0, end: 2 }, "对白")).toEqual({
      text: "【对白：你好】世界",
      selection: { start: 7, end: 7 },
    });
  });
});
