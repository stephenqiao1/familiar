import { createModels, DEFAULT_CEREBELLUM, modelId, NO_READERS, type Model } from "@familiar/region-cerebellum";
import { describe, expect, it } from "vitest";
import { playerCerebellum } from "./cerebellum-readers.js";
import { MEASURE_BOUNDS } from "./cerebellum.js";

const S = { ...DEFAULT_CEREBELLUM, bounds: MEASURE_BOUNDS };
const now = Date.now();
const model = (measures: Record<string, number>, changes: Record<string, number> = {}, runs = 8): Model => ({ measures: Object.fromEntries(Object.entries(measures).map(([k, value]) => [k, { value, spread: value / 10, seen: runs, at: now }])), runs, changes, at: now });

describe("what the player takes from the cerebellum", () => {
  it("pace: from the most specific trusted key for this ground", () => {
    const store = createModels({ [modelId("pace", "swim", "jog|water|water")]: model({ secondsPerBlock: 0.33 }), [modelId("pace", "walk", "jog")]: model({ secondsPerBlock: 0.2 }) });
    const { pace } = playerCerebellum({ store, settings: S });
    expect(pace.pace("swim", { gait: "jog", ground: "water", surface: "liquid", inWater: true })?.value).toBe(0.33);
    // Ground never walked before falls back to the gait alone.
    expect(pace.pace("walk", { gait: "jog", ground: "sand", surface: "loose" })?.value).toBe(0.2);
    expect(pace.pace("walk", { gait: "sprint", ground: "sand", surface: "loose" })).toBeNull();
  });

  it("expectations: an empty list is filled, and the check goes by the learned changes", () => {
    const store = createModels({ [modelId("primitive", "use_on", "lever|bare")]: model({}, { targetChanged: 8, turned: 8 }) });
    const check = playerCerebellum({ store, settings: S }).expects("use_on", { aim: "lever", hand: null }, ["hands", "head"], []);
    expect(check?.expects).toEqual(["targetChanged", "turned"]);
    expect(check?.met({ targetChanged: true, turned: 0.4 })).toBe(true);
    expect(check?.met({ turned: 0.4 })).toBe(false);
    expect(playerCerebellum({ store, settings: { ...S, ...NO_READERS } }).expects("use_on", { aim: "lever", hand: null }, ["hands", "head"], [])).toBeNull();
  });

  it("the give-up base is the fixed two minutes until a skill's time is known", () => {
    const store = createModels({ [modelId("skill", "go_to", "")]: model({ seconds: 5 }) });
    const cerebellum = playerCerebellum({ store, settings: S });
    expect(cerebellum.giveUpBaseMs("eat", now)).toBe(120_000);
    expect(cerebellum.giveUpBaseMs("go_to", now)).toBe(30_000);
    expect(playerCerebellum({ store, settings: { ...S, ...NO_READERS } }).giveUpBaseMs("go_to", now)).toBe(120_000);
  });

  it("timing: the delay after a sign is learned from the events remembered, and harm due soon is told by kind", () => {
    const store = createModels();
    let latest: { label: string; at: number } | null = null;
    const cerebellum = playerCerebellum({ store, settings: S, timing: { latest: () => latest, leadsTo: () => [["seen|creeper", "hurt|creeper"]] } });
    latest = { label: "seen|creeper", at: 1000 };
    expect(cerebellum.timings()).toEqual([]);
    latest = { label: "hurt|creeper", at: 9000 };
    expect(cerebellum.timings()).toMatchObject([{ kind: "timing", name: "seen|creeper>hurt|creeper", measures: { seconds: 8 } }]);
    expect(cerebellum.timings()).toEqual([]);
    // Once the delay is trusted, a creeper seen 7 s ago is due; a zombie is not.
    store.set(modelId("timing", "seen|creeper>hurt|creeper", ""), model({ seconds: 8 }));
    latest = { label: "seen|creeper", at: 100_000 };
    cerebellum.timings();
    expect(cerebellum.due("creeper", 101_000)).toBe(false);
    expect(cerebellum.due("creeper", 107_000)).toBe(true);
    expect(cerebellum.due("zombie", 107_000)).toBe(false);
    expect(cerebellum.notes(107_000)).toMatchObject({ due: [{ what: "hurt|creeper" }] });
  });
});
