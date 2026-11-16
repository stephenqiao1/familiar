import type { Skill, SkillEvent, SkillResult } from "@familiar/contracts";
import { createSkillExecutor } from "@familiar/core";
import { REFLEX_SKILLS } from "@familiar/minecraft";
import { describe, expect, it } from "vitest";
import { cutShortReason } from "./cut-short.js";

const HERE = { x: 4, y: 63, z: -2 };

describe("cutShortReason", () => {
  it("names the reflex and the place when a protective reflex takes over from an ordinary skill", () => {
    expect(cutShortReason("withdraw", "go_to", REFLEX_SKILLS, HERE)).toBe("cut short by withdraw at 4,63,-2");
    expect(cutShortReason("dig_out", "idle", REFLEX_SKILLS, HERE)).toBe("cut short by dig_out at 4,63,-2");
    expect(cutShortReason("recoil", "go_to", REFLEX_SKILLS, HERE)).toBe("cut short by recoil at 4,63,-2");
  });

  it("is null when nothing was running, when the next skill is ordinary, or when one reflex follows another", () => {
    expect(cutShortReason("withdraw", undefined, REFLEX_SKILLS, HERE)).toBeNull();
    expect(cutShortReason("eat", "go_to", REFLEX_SKILLS, HERE)).toBeNull();
    expect(cutShortReason("withdraw", "escape_hazard", REFLEX_SKILLS, HERE)).toBeNull();
    // The soft version (steady) only interrupts, as any other change of skill does.
    expect(cutShortReason("steady", "go_to", REFLEX_SKILLS, HERE)).toBeNull();
  });

  it("a reflex interruption ends the running skill as failed with that reason, not as interrupted", async () => {
    const events: SkillEvent[] = [];
    const skill = (name: string): Skill<null> => ({
      name,
      description: name,
      canRun: () => true,
      run: (_ctx, _target, signal) => new Promise<SkillResult>((resolve) => signal.addEventListener("abort", () => resolve({ status: "interrupted" }))),
    });
    const executor = createSkillExecutor({ skills: [skill("go_to"), skill("withdraw")], ctx: null, onEvent: (e) => events.push(e) });
    await executor.start("go_to");
    // What the bot's loop does when the winning action is a protective reflex's skill.
    const reason = cutShortReason("withdraw", executor.current()?.skill, REFLEX_SKILLS, HERE);
    if (reason) await executor.abandon(reason);
    await executor.start("withdraw");
    expect(events.map((e) => `${e.skill} ${e.type}${e.reason ? `: ${e.reason}` : ""}`)).toEqual(["go_to started", "go_to failed: cut short by withdraw at 4,63,-2", "withdraw started"]);
  });
});
