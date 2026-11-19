import { Vec3 } from "vec3";
import { describe, expect, it } from "vitest";
import { fakeBot } from "../primitives/fake-bot.test-helper.js";
import { sleep, sleepProblem } from "./sleep.js";

/** A bot at night beside its bed (the fake's bed is at 0,63,1). */
function atNight(over: { isDay?: boolean; sleeping?: boolean } = {}) {
  const bot = fakeBot();
  Object.assign(bot.state, { time: { isDay: over.isDay ?? false }, isSleeping: over.sleeping ?? false });
  return bot;
}

describe("sleepProblem", () => {
  it("is null at night, near the bed, with nothing hostile close", () => {
    expect(sleepProblem(atNight().ctx)).toBeNull();
    expect(sleep.canRun(atNight().ctx)).toBe(true);
  });
  it("says why not: day, already asleep, no bed in reach, a hostile near", () => {
    expect(sleepProblem(atNight({ isDay: true }).ctx)).toBe("it is day");
    expect(sleepProblem(atNight({ sleeping: true }).ctx)).toBe("already asleep");
    const far = atNight();
    far.state.entity.position = new Vec3(200.5, 63, 0.5);
    expect(sleepProblem(far.ctx)).toBe("no bed in reach");
    expect(sleep.canRun(far.ctx)).toBe(false);
    const hunted = fakeBot({ entities: [{ id: 7, name: "zombie", type: "hostile", position: new Vec3(3.5, 63, 0.5), height: 1.8, isValid: true }] });
    Object.assign(hunted.state, { time: { isDay: false }, isSleeping: false });
    expect(sleepProblem(hunted.ctx)).toBe("a hostile is near");
  });
});
