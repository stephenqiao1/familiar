import { describe, expect, it } from "vitest";
import { createChestMemory, withTrust, type RememberedLookup } from "./chest-memory.js";

describe("createChestMemory", () => {
  it("remembers the latest contents of each chest", () => {
    const memory = createChestMemory();
    memory.remember("pos:1,2,3", { bread: 8 }, 10);
    memory.remember("pos:1,2,3", { bread: 2, torch: 4 }, 20);
    expect(memory.recall("pos:1,2,3")).toEqual({ contents: { bread: 2, torch: 4 }, seenAt: 20 });
    expect(memory.recall("pos:9,9,9")).toBeUndefined();
  });

  it("starts from saved entries", () => {
    const saved = { "pos:1,2,3": { contents: { bread: 8 }, seenAt: 10 } };
    expect(createChestMemory(saved).entries()).toEqual(saved);
  });
});

describe("withTrust", () => {
  const MIN = 60_000;
  /** Trust halves every 10 minutes; a chest is believed while its trust is above focus. */
  function setup(focus: number) {
    const chests = createChestMemory();
    const clock = { now: 0 };
    const lookups: RememberedLookup[] = [];
    const believed = withTrust(chests, (seenAt) => 0.5 ** ((clock.now - seenAt) / (10 * MIN)) > focus, (l) => lookups.push(l), () => clock.now);
    return { chests, believed, clock, lookups };
  }

  it("uses a remembered chest at low focus and rejects it at high focus, logging both", () => {
    const low = setup(0.2);
    low.believed.remember("pos:1,2,3", { bread: 8 }, 0);
    low.clock.now = 10 * MIN; // trust 0.5
    expect(low.believed.recall("pos:1,2,3")?.contents).toEqual({ bread: 8 });
    expect(low.lookups).toEqual([{ what: "chest pos:1,2,3", used: true }]);

    const high = setup(0.8);
    high.believed.remember("pos:1,2,3", { bread: 8 }, 0);
    high.clock.now = 10 * MIN;
    expect(high.believed.recall("pos:1,2,3")).toBeUndefined();
    expect(high.believed.entries()).toEqual({});
    expect(high.lookups).toEqual([
      { what: "chest pos:1,2,3", used: false },
      { what: "chest pos:1,2,3", used: false },
    ]);
    expect(high.chests.recall("pos:1,2,3")).toBeDefined(); // still remembered, just not believed
  });

  it("rejects older memories sooner", () => {
    const { believed, clock } = setup(0.4);
    believed.remember("pos:1,1,1", { bread: 1 }, 0);
    believed.remember("pos:2,2,2", { bread: 2 }, 12 * MIN);
    clock.now = 15 * MIN; // the first is 15 minutes old (trust 0.35), the second 3 (trust 0.81)
    expect(Object.keys(believed.entries())).toEqual(["pos:2,2,2"]);
  });

  it("guardrail: after more than 3 re-checks in 5 minutes that found nothing changed, trusts the chest for a while", () => {
    const { believed, clock, lookups } = setup(0.99); // so watchful nothing is ever believed
    believed.remember("pos:1,2,3", { bread: 8 }, 0);
    for (let i = 1; i <= 4; i++) {
      clock.now = i * MIN;
      expect(believed.recall("pos:1,2,3")).toBeUndefined();
      believed.remember("pos:1,2,3", { bread: 8 }, clock.now); // went and checked: nothing changed
    }
    expect(lookups.at(-1)?.what).toMatch(/re-checked 4 times with nothing changed/);
    clock.now = 5 * MIN;
    expect(believed.recall("pos:1,2,3")?.contents).toEqual({ bread: 8 });
    clock.now = 20 * MIN;
    expect(believed.recall("pos:1,2,3")).toBeUndefined();
  });

  it("starts the re-check count again when the chest did change", () => {
    const { believed, clock, lookups } = setup(0.99);
    believed.remember("pos:1,2,3", { bread: 8 }, 0);
    for (let i = 1; i <= 6; i++) {
      clock.now = i * MIN;
      believed.remember("pos:1,2,3", { bread: 8 - (i % 2) }, clock.now);
    }
    expect(lookups.some((l) => l.what.includes("re-checked"))).toBe(false);
  });
});
