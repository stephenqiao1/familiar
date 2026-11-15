import { describe, expect, it } from "vitest";
import { createWorkspace } from "@familiar/core";
import { createReflexRegion, REFLEX_SIGNAL, SOFT_CAP, type ReflexRule } from "./reflex-region.js";

const signal = new AbortController().signal;
const rule = (name: string, kind: ReflexRule["kind"], skill: string, urgency = 1): ReflexRule => ({
  name,
  kind,
  check: () => ({ action: { skill }, urgency, reason: name }),
});
const never: ReflexRule = { name: "never", kind: "hard", check: () => null };
const broken: ReflexRule = {
  name: "broken",
  kind: "hard",
  check: () => {
    throw new Error("bad data");
  },
};

describe("createReflexRegion", () => {
  it("runs every tick on the fastest layer by default", () => {
    expect(createReflexRegion({ rules: [] })).toMatchObject({ name: "reflex", layer: 0, everyMs: 0 });
  });

  it("proposes once per rule that fires and names them in the trace", async () => {
    const ws = createWorkspace().viewFor("reflex");
    const out = await createReflexRegion({ rules: [rule("a", "hard", "flee"), never, rule("b", "hard", "eat")] }).run(ws, signal);
    expect(out.proposals).toEqual([
      { action: { skill: "flee" }, urgency: 1, reason: "a" },
      { action: { skill: "eat" }, urgency: 1, reason: "b" },
    ]);
    expect(out.trace).toMatchObject({ fired: ["a", "b"] });
  });

  it("skips a rule that throws and records why", async () => {
    const ws = createWorkspace().viewFor("reflex");
    const out = await createReflexRegion({ rules: [broken, rule("a", "hard", "flee")] }).run(ws, signal);
    expect(out.proposals).toHaveLength(1);
    expect(out.trace).toMatchObject({ fired: ["a"], errors: { broken: "bad data" } });
  });

  describe("hard and soft", () => {
    const run = async (rules: ReflexRule[], gain?: number) => {
      const store = createWorkspace();
      const out = await createReflexRegion({ rules, ...(gain === undefined ? {} : { gainOf: () => gain }) }).run(store.viewFor("reflex"), signal);
      return { out, signals: store.signals() };
    };

    it("a hard rule is always urgency 1, whatever the gain or the urgency it wrote", async () => {
      for (const gain of [0, 0.3, 1, 1.5]) {
        const { out } = await run([rule("save", "hard", "flee", 0.4)], gain);
        expect(out.proposals[0]?.urgency).toBe(1);
        expect(out.trace?.rules).toEqual([{ rule: "save", kind: "hard", skill: "flee", base: 0.4, gain: 1, urgency: 1 }]);
      }
    });

    it("a soft rule is its base urgency times the gain", async () => {
      const { out } = await run([rule("defend", "soft", "flee", 0.7)], 0.5);
      expect(out.proposals[0]?.urgency).toBeCloseTo(0.35);
      expect(out.trace?.rules).toEqual([{ rule: "defend", kind: "soft", skill: "flee", base: 0.7, gain: 0.5, urgency: 0.35 }]);
    });

    it("a soft rule is capped at 0.95: no gain can make it win outright", async () => {
      for (const gain of [1.2, 1.5, 100]) expect((await run([rule("defend", "soft", "flee", 0.9)], gain)).out.proposals[0]?.urgency).toBe(SOFT_CAP);
      expect(SOFT_CAP).toBeLessThan(1);
    });

    it("with no gain given, a soft rule keeps its base urgency", async () => {
      expect((await run([rule("eat", "soft", "eat", 0.9)])).out.proposals[0]?.urgency).toBe(0.9);
    });

    it("shares the highest urgency fired this tick: 1 for a hard reflex, 0 for none", async () => {
      expect((await run([rule("save", "hard", "flee")])).signals[REFLEX_SIGNAL]?.value).toBe(1);
      expect((await run([rule("defend", "soft", "flee", 0.9)], 0.5)).signals[REFLEX_SIGNAL]?.value).toBeCloseTo(0.45);
      expect((await run([never])).signals[REFLEX_SIGNAL]?.value).toBe(0);
    });
  });
});
