import { describe, expect, it } from "vitest";
import { createDefenceWatch, type DefenceTick } from "./defence-watch.js";

const flee = { rule: "threat_contact", skill: "flee", gain: 0.3, urgency: 0.27, heldBack: true, won: false };
const winner = { region: "instinct", skill: "attack", urgency: 0.7, reason: "chose attack" };
const tick = (over: Partial<DefenceTick>): DefenceTick => ({ now: 0, fired: [], winner: null, threatClose: true, died: false, ...over });

describe("createDefenceWatch", () => {
  it("reports a death that follows a held-back or outvoted defence reflex, with the gain and what won", () => {
    const watch = createDefenceWatch();
    expect(watch.observe(tick({ now: 1000, fired: [flee], winner }))).toBeNull();
    expect(watch.observe(tick({ now: 4000, died: true }))).toEqual({ at: 1000, rule: "threat_contact", skill: "flee", gain: 0.3, urgency: 0.27, heldBack: true, winner });
    // Reported once.
    expect(watch.observe(tick({ now: 5000, died: true }))).toBeNull();
  });

  it("says nothing when the reflex got its way, when no threat was close, or when the death came much later", () => {
    const won = createDefenceWatch();
    won.observe(tick({ now: 1000, fired: [{ ...flee, heldBack: false, won: true }], winner: { ...winner, region: "reflex", skill: "flee" } }));
    expect(won.observe(tick({ now: 2000, died: true }))).toBeNull();

    const safe = createDefenceWatch();
    safe.observe(tick({ now: 1000, fired: [flee], winner, threatClose: false }));
    expect(safe.observe(tick({ now: 2000, died: true }))).toBeNull();

    const late = createDefenceWatch();
    late.observe(tick({ now: 1000, fired: [flee], winner }));
    expect(late.observe(tick({ now: 60_000, died: true }))).toBeNull();
  });
});
