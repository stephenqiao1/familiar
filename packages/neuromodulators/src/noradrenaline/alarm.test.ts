import { describe, expect, it } from "vitest";
import { createAlarm } from "./alarm.js";
import { DEFAULT_NORADRENALINE } from "./settings.js";

describe("createAlarm", () => {
  it("is never below the sustained level, and stays there as long as it holds", () => {
    const alarm = createAlarm(DEFAULT_NORADRENALINE);
    expect(alarm.update(0.8, 0, 0)).toBe(0.8);
    expect(alarm.update(0.8, 0, 600_000)).toBe(0.8);
  });

  it("with the cause gone, what is left fades with the time constant: a third after one, almost nothing after five", () => {
    const alarm = createAlarm({ alarmDecaySeconds: 5 });
    alarm.update(1, 0, 0);
    expect(alarm.update(0, 0, 5000)).toBeCloseTo(1 / Math.E);
    expect(alarm.update(0, 0, 25_000)).toBeLessThan(0.01);
  });

  it("a jump lifts it to that much at least, and fades the same way; jumps do not pile up", () => {
    const alarm = createAlarm({ alarmDecaySeconds: 5 });
    expect(alarm.update(0, 0.4, 0)).toBe(0.4);
    expect(alarm.update(0, 0.3, 0)).toBe(0.4);
    expect(alarm.update(0, 0.9, 0)).toBe(0.9);
    expect(alarm.update(0, 3, 0)).toBe(1);
    expect(alarm.update(0, 0, 5000)).toBeCloseTo(1 / Math.E);
    // A little worse every tick for a minute is still only a little.
    const creeping = createAlarm({ alarmDecaySeconds: 5 });
    for (let s = 0; s < 60; s++) creeping.update(0, 0.05, s * 1000);
    expect(creeping.level()).toBe(0.05);
  });

  it("a jump smaller than the sustained level changes nothing", () => {
    const alarm = createAlarm({ alarmDecaySeconds: 5 });
    alarm.update(0.7, 0, 0);
    expect(alarm.update(0.7, 0, 60_000)).toBe(0.7);
    expect(alarm.update(0.7, 0.3, 60_000)).toBe(0.7);
  });

  it("fades more slowly in a bot that stays rattled", () => {
    const rattled = createAlarm({ alarmDecaySeconds: 30 });
    const steady = createAlarm({ alarmDecaySeconds: 5 });
    for (const alarm of [rattled, steady]) alarm.update(1, 0, 0);
    expect(rattled.update(0, 0, 10_000)).toBeGreaterThan(steady.update(0, 0, 10_000) + 0.5);
  });
});
