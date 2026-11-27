import { describe, expect, it } from "vitest";
import type { Goal } from "@familiar/contracts";
import { createWorkspace } from "@familiar/core";
import type { Area } from "./area.js";
import { areaOf, areaRegions } from "./area-region.js";
import { feedbackFor } from "./ladder.js";

const signal = new AbortController().signal;
const LADDER = ["low", "mid", "top"];
const goal = (text: string) => ({ text }) as Goal;
const area = (name: string, more: Partial<Area> = {}): Area => ({ name, layer: 1, everyMs: 0, input: name, run: () => ({ action: [] }), ...more });

describe("an area as regions", () => {
  it("an every-tick area is one region: it is handed its view and feedback, and its ports are written and traced", async () => {
    const store = createWorkspace();
    store.update({ schemaVersion: 1, tick: 0, timestamp: 0, data: { full: true } }, null);
    store.viewFor("thalamus").setView("low", { schemaVersion: 1, tick: 0, timestamp: 0, data: { told: true } });
    store.viewFor("top").setCortex("top", { feedback: { goal: goal("mine") } });
    const seen: unknown[] = [];
    const proposal = { action: { skill: "dig" }, urgency: 0.5, reason: "r" };
    const regions = areaRegions(
      area("low", {
        run: (input) => {
          seen.push(input.view.data, input.feedback);
          return { action: [proposal], up: { found: "ore" }, ask: ["ore"], trace: { why: "x" } };
        },
      }),
      LADDER,
    );
    expect(regions).toHaveLength(1);
    const out = await regions[0]!.run(store.viewFor("low"), signal);
    expect(seen).toEqual([{ told: true }, { goal: goal("mine") }]);
    expect(out.proposals).toEqual([proposal]);
    expect(store.cortex().low).toMatchObject({ up: { found: "ore" }, feedback: null, ask: ["ore"] });
    expect(out.trace).toEqual({ why: "x", ports: { input: "low", feedback: { goal: goal("mine") }, up: { found: "ore" }, action: [{ skill: "dig" }], ask: ["ore"], down: null } });
  });

  it("feedback comes from the nearest area above that says anything; one left out passes the next one's through", () => {
    const store = createWorkspace();
    const ws = store.viewFor("x");
    expect(feedbackFor(ws, "low", LADDER)).toBeNull();
    ws.setCortex("top", { feedback: { goal: goal("far") } });
    expect(feedbackFor(ws, "low", LADDER)).toEqual({ goal: goal("far") });
    ws.setCortex("mid", { feedback: { goal: goal("near") } });
    expect(feedbackFor(ws, "low", LADDER)).toEqual({ goal: goal("near") });
    expect(feedbackFor(ws, "mid", LADDER)).toEqual({ goal: goal("far") });
    // Nothing comes down to the top, from below, or to an area that is not on the ladder.
    ws.setCortex("low", { feedback: { goal: goal("below") } });
    expect(feedbackFor(ws, "top", LADDER)).toBeNull();
    expect(feedbackFor(ws, "other", LADDER)).toBeNull();
  });

  it("a background area is two regions: its every-tick half says what it holds again, from the workspace as it stands", async () => {
    const store = createWorkspace();
    const top = area("top", { everyMs: 15_000, timeoutMs: 60_000, dueNow: () => true, run: () => ({ action: [], up: { note: 1 } }), hold: (ws) => ({ feedback: { goal: ws.goal }, ask: ws.goal?.detail ?? [] }) });
    const [hold, slow] = areaRegions(top, LADDER);
    expect(hold).toMatchObject({ name: "top-hold", layer: 1, everyMs: 0 });
    expect(slow).toMatchObject({ name: "top", everyMs: 15_000, timeoutMs: 60_000 });
    expect(slow!.dueNow?.(store.viewFor("top"))).toBe(true);
    expect(areaOf("top-hold")).toBe("top");
    expect(areaOf("top")).toBe("top");

    await slow!.run(store.viewFor("top"), signal);
    expect(store.cortex().top).toMatchObject({ up: { note: 1 }, feedback: { goal: null }, ask: [] });
    // Something else replaces the goal between two runs of the area: the next tick's feedback has it.
    store.viewFor("alarm").setGoal({ text: "retreat", steps: [], reason: "", detail: ["bed"] });
    const out = await hold!.run(store.viewFor("top-hold"), signal);
    expect(store.cortex().top).toMatchObject({ up: { note: 1 }, feedback: { goal: { text: "retreat", setBy: "alarm" } }, ask: ["bed"] });
    expect(out).toMatchObject({ proposals: [], trace: { ports: { ask: ["bed"], down: { goal: { text: "retreat" } } } } });
  });
});
