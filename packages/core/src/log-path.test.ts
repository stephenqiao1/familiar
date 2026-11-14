import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultLogPath } from "./log-path.js";

describe("defaultLogPath", () => {
  it("builds logs/<role>-<timestamp>.jsonl", () => {
    const at = new Date("2026-10-30T12:00:00.000Z");
    expect(defaultLogPath("player", at)).toBe(join("logs", "player-2026-10-30T12-00-00.000Z.jsonl"));
  });
});
