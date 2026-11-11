import { describe, expect, it } from "vitest";
import { createWorkspace } from "@familiar/core";
import { createReflexRegion, type ReflexRule } from "./reflex-region.js";

const ws = createWorkspace().viewFor("reflex");
const always = (name: string, skill: string): ReflexRule => ({
  name,
  check: () => ({ action: { skill }, urgency: 1, reason: name }),
});
const never: ReflexRule = { name: "never", check: () => null };
const broken: ReflexRule = {
  name: "broken",
  check: () => {
    throw new Error("bad data");
  },
};

describe("createReflexRegion", () => {
  it("runs every tick on the fastest layer by default", () => {
    expect(createReflexRegion({ rules: [] })).toMatchObject({ name: "reflex", layer: 0, everyMs: 0 });
  });

  it("proposes once per rule that fires and names them in the trace", async () => {
    const out = await createReflexRegion({ rules: [always("a", "flee"), never, always("b", "eat")] }).run(ws, new AbortController().signal);
    expect(out.proposals.map((p) => p.action)).toEqual([{ skill: "flee" }, { skill: "eat" }]);
    expect(out.trace).toEqual({ fired: ["a", "b"] });
  });

  it("skips a rule that throws and records why", async () => {
    const out = await createReflexRegion({ rules: [broken, always("a", "flee")] }).run(ws, new AbortController().signal);
    expect(out.proposals).toHaveLength(1);
    expect(out.trace).toEqual({ fired: ["a"], errors: { broken: "bad data" } });
  });
});
