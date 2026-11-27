import { describe, expect, it } from "vitest";
import type { Workspace } from "@familiar/contracts";
import { createConditions, NO_CONDITIONS, type ConditionKind } from "./conditions.js";

/** "flag <name>": true while the state's data has that key. */
const flag: ConditionKind = {
  form: "flag <name>",
  read(text) {
    const name = /^flag (\w+)$/.exec(text)?.[1];
    return name ? (ws) => name in ws.state.data : null;
  },
};
const ws = (data: Record<string, unknown>) => ({ state: { data } }) as unknown as Workspace;

describe("conditions", () => {
  const conditions = createConditions([flag]);

  it("reads a condition of a kind it was given, whatever the case and spacing", () => {
    const lit = conditions.parse("  Flag   LIT ");
    expect(lit?.text).toBe("flag lit");
    expect(lit?.holds(ws({ lit: 1 }))).toBe(true);
    expect(lit?.holds(ws({}))).toBe(false);
  });

  it("adds not, as often as it is said", () => {
    expect(conditions.parse("not flag lit")?.holds(ws({}))).toBe(true);
    expect(conditions.parse("not flag lit")?.holds(ws({ lit: 1 }))).toBe(false);
    expect(conditions.parse("not not flag lit")?.holds(ws({ lit: 1 }))).toBe(true);
  });

  it("gives null for anything outside the vocabulary, and for nothing at all", () => {
    for (const text of ["when it feels right", "not sure", "not", "", undefined, null]) expect(conditions.parse(text)).toBeNull();
    expect(NO_CONDITIONS.parse("flag lit")).toBeNull();
  });

  it("works a text out once, and lists how each kind is written", () => {
    expect(conditions.parse("flag lit")).toBe(conditions.parse("FLAG lit"));
    expect(conditions.forms).toEqual(["flag <name>", "not <condition>"]);
  });
});
