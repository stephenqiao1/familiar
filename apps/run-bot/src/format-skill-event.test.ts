import { describe, expect, it } from "vitest";
import { formatSkillEvent } from "./format-skill-event.js";

describe("formatSkillEvent", () => {
  it("shows skill and type", () => {
    expect(formatSkillEvent({ skill: "idle", type: "started", timestamp: 0 })).toBe("[skill] idle started");
  });

  it("shows target and reason when present", () => {
    expect(
      formatSkillEvent({ skill: "go_to", target: "pos:1,2,3", type: "failed", reason: "timeout", timestamp: 0 }),
    ).toBe("[skill] go_to (pos:1,2,3) failed: timeout");
  });
});
