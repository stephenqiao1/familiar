import { describe, expect, it } from "vitest";
import { createAlarm } from "./alarm.js";
import { DEFAULT_NORADRENALINE } from "./settings.js";

describe("createAlarm", () => {
  it("rises at once on a big hit, and with the threat gone falls under 0.1 within about 2 minutes", () => {
    const alarm = createAlarm(DEFAULT_NORADRENALINE);
    expect(alarm.update(1, false, 0)).toBe(1);
    expect(alarm.update(0, false, 30_000)).toBeCloseTo(1 / Math.E);
    expect(alarm.update(0, false, 120_000)).toBeLessThan(0.1);
  });

  it("does not fall while a threat is still present", () => {
    const alarm = createAlarm(DEFAULT_NORADRENALINE);
    alarm.update(0.6, true, 0);
    expect(alarm.update(0, true, 600_000)).toBe(0.6);
    expect(alarm.update(0, false, 630_000)).toBeCloseTo(0.6 / Math.E);
  });

  it("adds triggers together, capped at 1", () => {
    const alarm = createAlarm(DEFAULT_NORADRENALINE);
    alarm.update(0.3, true, 0);
    expect(alarm.update(0.3, true, 0)).toBeCloseTo(0.6);
    expect(alarm.update(0.9, true, 0)).toBe(1);
  });

  it("is raised more in a jumpy bot, and fades faster in one that shakes it off", () => {
    expect(createAlarm({ alarmGain: 2, alarmDecaySeconds: 30 }).update(0.3, false, 0)).toBeCloseTo(0.6);
    const quick = createAlarm({ alarmGain: 1, alarmDecaySeconds: 5 });
    quick.update(1, false, 0);
    expect(quick.update(0, false, 30_000)).toBeLessThan(0.01);
  });
});
