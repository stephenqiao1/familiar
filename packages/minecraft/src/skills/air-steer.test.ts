import { describe, expect, it } from "vitest";
import { Vec3 } from "vec3";
import { shortBy } from "./air-steer.js";

describe("shortBy", () => {
  const spot = new Vec3(1.5, 64, 0.5);

  it("standing still in the air, the body comes down as far short as it is from the spot", () => {
    expect(shortBy(new Vec3(0.5, 72, 0.5), new Vec3(0, 0, 0), spot)).toBeCloseTo(1);
  });

  it("the air carries a moving body on: less short the faster it goes and the longer the fall has left", () => {
    const moving = shortBy(new Vec3(0.5, 72, 0.5), new Vec3(0.1, 0, 0), spot);
    expect(moving).toBeLessThan(0.3);
    const nearlyDown = shortBy(new Vec3(0.5, 64.5, 0.5), new Vec3(0.1, -0.8, 0), spot);
    expect(nearlyDown).toBeGreaterThan(0.85);
  });

  it("says when the body would overshoot, and ignores speed that is not toward the spot", () => {
    expect(shortBy(new Vec3(0.5, 90, 0.5), new Vec3(0.25, 0, 0), spot)).toBeLessThan(0);
    expect(shortBy(new Vec3(0.5, 72, 0.5), new Vec3(0, 0, 0.2), spot)).toBeCloseTo(1);
  });
});
