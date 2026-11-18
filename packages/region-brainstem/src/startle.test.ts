import { describe, expect, it } from "vitest";
import { createStartle, FLINCH, FULL, holdMsOf, magnitudeOf, potentiationOf, sizeOf, type Edge, type Factors, type StartleStrengths } from "./startle.js";

const calm: Edge = { alarm: 0, sore: 0, dark: 0, badPlace: 0 };
const plain: Factors = { intensity: 0.8, potentiation: 1, warning: 0, habituated: 0, selfCaused: false, hurtNow: false, gain: 1 };
const ON: StartleStrengths = { startle: 1, potentiation: 1, warning: 1, habituation: 1, selfCaused: 1 };
const bang = (intensity = 0.8, over = {}) => ({ kind: "explosion", place: "0,0", intensity, ...over });

describe("magnitudeOf", () => {
  it("rises with intensity", () => {
    expect([0.2, 0.5, 0.9].map((intensity) => magnitudeOf({ ...plain, intensity }))).toEqual([0.2, 0.5, 0.9]);
  });

  it("is enlarged by potentiation, shrunk by warning and by habituation, and never leaves 0 to 1", () => {
    expect(magnitudeOf({ ...plain, intensity: 0.5, potentiation: 1.6 })).toBeCloseTo(0.8);
    expect(magnitudeOf({ ...plain, warning: 0.8 })).toBeCloseTo(0.16);
    expect(magnitudeOf({ ...plain, habituated: 0.5 })).toBeCloseTo(0.4);
    expect(magnitudeOf({ ...plain, intensity: 1, potentiation: 1.6 })).toBe(1);
    // The factors have limits: warning stops at 0.8, habituation at 0.9, potentiation at 1.6.
    expect(magnitudeOf({ ...plain, intensity: 1, warning: 5 })).toBeCloseTo(0.2);
    expect(magnitudeOf({ ...plain, intensity: 1, habituated: 5 })).toBeCloseTo(0.1);
    expect(magnitudeOf({ ...plain, intensity: 0.5, potentiation: 9 })).toBeCloseTo(0.8);
  });

  it("a self-caused event gives 0", () => {
    expect(magnitudeOf({ ...plain, intensity: 1, potentiation: 1.6, selfCaused: true })).toBe(0);
  });

  it("damage on the same tick caps the damping at 0.5: an event that is hurting right now is never silenced", () => {
    expect(magnitudeOf({ ...plain, warning: 0.8, habituated: 0.9 })).toBeCloseTo(0.016);
    expect(magnitudeOf({ ...plain, warning: 0.8, habituated: 0.9, hurtNow: true })).toBeCloseTo(0.2);
    expect(magnitudeOf({ ...plain, intensity: 1, habituated: 0.9, hurtNow: true })).toBe(0.5);
  });

  it("the bot's strength multiplies it: 0 never startles, 1.5 is jumpy", () => {
    expect(magnitudeOf({ ...plain, gain: 0 })).toBe(0);
    expect(magnitudeOf({ ...plain, intensity: 0.4, gain: 1.5 })).toBeCloseTo(0.6);
  });
});

describe("potentiationOf", () => {
  it("is 1 when calm, in the light, somewhere safe, and rises with alarm, soreness, darkness and a bad place, up to 1.6", () => {
    expect(potentiationOf(calm)).toBe(1);
    expect(potentiationOf({ ...calm, alarm: 1 })).toBeCloseTo(1.3);
    expect(potentiationOf({ ...calm, sore: 1 })).toBeCloseTo(1.2);
    expect(potentiationOf({ ...calm, dark: 1 })).toBeCloseTo(1.15);
    expect(potentiationOf({ ...calm, badPlace: 1 })).toBeCloseTo(1.15);
    expect(potentiationOf({ alarm: 1, sore: 1, dark: 1, badPlace: 1 })).toBe(1.6);
    expect(potentiationOf({ alarm: 1, sore: 1, dark: 1, badPlace: 1 }, 0)).toBe(1);
    expect(potentiationOf({ ...calm, alarm: 1 }, 0.5)).toBeCloseTo(1.15);
  });
});

describe("sizeOf and holdMsOf", () => {
  it("below 0.25 nothing, up to 0.6 a flinch, above that a full startle", () => {
    expect([0.1, 0.24, 0.25, 0.6, 0.61, 1].map(sizeOf)).toEqual(["none", "none", "flinch", "flinch", "full", "full"]);
    expect([FLINCH, FULL]).toEqual([0.25, 0.6]);
  });

  it("a full startle holds longer the bigger it is: 250 ms at the threshold, 500 at the top", () => {
    expect([0.6, 0.8, 1].map(holdMsOf)).toEqual([250, 375, 500]);
    expect(holdMsOf(0.3)).toBe(250);
  });
});

describe("createStartle", () => {
  it("warning lowers it when the source was seen coming", () => {
    const seen = createStartle(ON).judge(bang(0.8, { foreseen: 1 }), calm, false, 0);
    expect(seen).toMatchObject({ warning: 0.8, size: "none", silenced: "too small" });
    expect(seen.magnitude).toBeCloseTo(0.16);
    expect(createStartle(ON).judge(bang(0.8), calm, false, 0)).toMatchObject({ warning: 0, magnitude: 0.8, size: "full" });
    expect(createStartle({ ...ON, warning: 0 }).judge(bang(0.8, { foreseen: 1 }), calm, false, 0).size).toBe("full");
  });

  it("a weaker event of the same kind from the same place just before is a warning too", () => {
    const s = createStartle(ON);
    expect(s.judge(bang(0.2), calm, false, 0).size).toBe("none");
    expect(s.judge(bang(0.9), calm, false, 300)).toMatchObject({ warning: 0.8, size: "none" });
    // Not from somewhere else, and not after more than half a second.
    const t = createStartle(ON);
    t.judge(bang(0.2), calm, false, 0);
    expect(t.judge(bang(0.9, { place: "5,5" }), calm, false, 300).warning).toBe(0);
    const u = createStartle(ON);
    u.judge(bang(0.2), calm, false, 0);
    expect(u.judge(bang(0.9), calm, false, 700).warning).toBe(0);
  });

  it("habituation lowers it across repeats, recovers after a minute, and resets when harm follows", () => {
    const s = createStartle(ON);
    const sizes = [0, 4000, 8000, 12_000, 16_000].map((at) => s.judge(bang(0.9), calm, false, at).magnitude);
    expect(sizes[0]).toBeCloseTo(0.9);
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]).toBeLessThan(sizes[i - 1]!);
    expect(sizes[3]).toBeLessThan(0.25);
    // Two minutes on it is back.
    expect(s.judge(bang(0.9), calm, false, 140_000).magnitude).toBeGreaterThan(0.8);

    const harmed = createStartle(ON);
    harmed.judge(bang(0.9), calm, false, 0);
    harmed.harmed(1500); // something bad followed: it was right to startle
    expect(harmed.judge(bang(0.9), calm, false, 4000).magnitude).toBeCloseTo(0.9);
    // Harm that comes more than 3 seconds later says nothing about it.
    const late = createStartle(ON);
    late.judge(bang(0.9), calm, false, 0);
    late.harmed(5000);
    expect(late.judge(bang(0.9), calm, false, 6000).magnitude).toBeCloseTo(0.45, 1);
  });

  it("habituating to one kind of event leaves another kind, and the same kind elsewhere, at full strength", () => {
    const s = createStartle(ON);
    for (const at of [0, 4000, 8000]) s.judge({ kind: "thunder", place: "0,0", intensity: 0.9 }, calm, false, at);
    expect(s.judge({ kind: "thunder", place: "0,0", intensity: 0.9 }, calm, false, 12_000).magnitude).toBeLessThan(0.25);
    expect(s.judge({ kind: "creeper", place: "0,0", intensity: 0.9 }, calm, false, 14_000).magnitude).toBeCloseTo(0.9);
    expect(s.judge({ kind: "thunder", place: "9,9", intensity: 0.9 }, calm, false, 16_000).magnitude).toBeCloseTo(0.9);
  });

  it("a small hurt that keeps repeating startles the first time at most, then the body is used to it: no special case", () => {
    const s = createStartle(ON);
    const tick = { kind: "hurt:starve", intensity: 0.26 };
    const sizes = [0, 4000, 8000, 12_000, 16_000].map((at) => {
      s.harmed(at, tick); // the hurt itself is not "something bad following"
      return s.judge(tick, calm, true, at).size;
    });
    expect(sizes).toEqual(["flinch", "none", "none", "none", "none"]);
    // Fire ticks come every second: the same.
    const fire = createStartle(ON);
    const burn = { kind: "hurt:on_fire", intensity: 0.26 };
    const burning = Array.from({ length: 8 }, (_, i) => (fire.harmed(i * 1000, burn), fire.judge(burn, calm, true, i * 1000).size));
    expect(burning.filter((size) => size !== "none")).toEqual(["flinch"]);
  });

  it("a self-caused event gives 0 and is not counted; an unrelated event straight after still startles", () => {
    const s = createStartle(ON);
    expect(s.judge(bang(1, { selfCaused: true }), calm, false, 0)).toMatchObject({ magnitude: 0, size: "none", silenced: "self-caused" });
    expect(s.judge({ kind: "zombie", place: "0,0", intensity: 0.8 }, calm, false, 200)).toMatchObject({ magnitude: 0.8, size: "full" });
    expect(createStartle({ ...ON, selfCaused: 0 }).judge(bang(1, { selfCaused: true }), calm, false, 0).size).toBe("full");
  });

  it("does not fire twice within a second, however strong the second event", () => {
    const s = createStartle(ON);
    expect(s.judge(bang(0.9), calm, false, 0).size).toBe("full");
    expect(s.judge({ kind: "zombie", intensity: 1 }, calm, false, 500)).toMatchObject({ size: "none", silenced: "refractory", magnitude: 0 });
    expect(s.judge({ kind: "zombie", intensity: 1 }, calm, false, 1100).size).toBe("full");
  });

  it("being on edge enlarges it; the strength setting scales it", () => {
    const edgy = { alarm: 1, sore: 1, dark: 1, badPlace: 0 };
    expect(createStartle(ON).judge(bang(0.5), edgy, false, 0)).toMatchObject({ potentiation: 1.6, size: "full" });
    expect(createStartle(ON).judge(bang(0.5), calm, false, 0).size).toBe("flinch");
    expect(createStartle({ ...ON, startle: 0 }).judge(bang(1), edgy, false, 0).size).toBe("none");
    expect(createStartle({ ...ON, startle: 1.5 }).judge(bang(0.5), calm, false, 0)).toMatchObject({ magnitude: 0.75, size: "full" });
  });
});
