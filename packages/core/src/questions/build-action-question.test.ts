import { describe, expect, it } from "vitest";
import type { Skill } from "@familiar/contracts";
import { buildActionQuestion } from "./build-action-question.js";

type Ctx = { hungry: boolean };
const skill = (name: string, canRun: (ctx: Ctx) => boolean): Skill<Ctx> => ({
  name,
  description: `${name} description`,
  canRun,
  run: async () => ({ status: "done" }),
});

describe("buildActionQuestion", () => {
  const skills = [
    skill("idle", () => true),
    skill("eat", (ctx) => ctx.hungry),
    skill("broken", () => {
      throw new Error("boom");
    }),
  ];

  it("offers only skills that can run, with their descriptions in the prompt", () => {
    const q = buildActionQuestion(skills, { hungry: false });
    expect(q).toMatchObject({ kind: "choice", id: "next_action", options: ["idle"] });
    expect(q.prompt).toContain("- idle: idle description");
    expect(q.prompt).not.toContain("eat");
    expect(q.prompt).not.toContain("broken");
  });

  it("includes a skill once it can run", () => {
    const q = buildActionQuestion(skills, { hungry: true });
    expect(q.options).toEqual(["idle", "eat"]);
    expect(q.prompt).toContain("- eat: eat description");
  });

  it("puts the context before the question", () => {
    const q = buildActionQuestion(skills, { hungry: false }, "Safety first.");
    expect(q.prompt.startsWith("Safety first.\nWhich skill should the player do next?\n- idle")).toBe(true);
  });
});
