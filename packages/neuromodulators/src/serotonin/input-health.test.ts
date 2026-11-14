import { describe, expect, it } from "vitest";
import { createInputHealth } from "./input-health.js";

const MIN = 60_000;

describe("createInputHealth", () => {
  it("says nothing about a healthy input", () => {
    const health = createInputHealth();
    for (let t = 0; t <= 20 * MIN; t += MIN) expect(health.check("fed", 0.4, t)).toBeNull();
  });

  it("warns at once when an input is not a number", () => {
    expect(createInputHealth().check("fed", Number.NaN, 0)).toBe('check outlook input "fed": it returned NaN');
  });

  it("warns when an input has been 0 for 5 minutes, naming it, at most once a minute", () => {
    const health = createInputHealth();
    expect(health.check("equipped", 0, 0)).toBeNull();
    expect(health.check("equipped", 0, 5 * MIN - 1)).toBeNull();
    expect(health.check("equipped", 0, 5 * MIN)).toBe('check outlook input "equipped": it has been 0 for 5 minutes');
    expect(health.check("equipped", 0, 5 * MIN + 500)).toBeNull();
    expect(health.check("equipped", 0, 6 * MIN)).toMatch(/has been 0 for 6 minutes/);
  });

  it("starts the 5 minutes again once the input moves off 0", () => {
    const health = createInputHealth();
    health.check("equipped", 0, 0);
    health.check("equipped", 0.5, 4 * MIN);
    expect(health.check("equipped", 0, 5 * MIN)).toBeNull();
    expect(health.check("equipped", 0, 10 * MIN)).not.toBeNull();
  });

  it("warns when an input that used to give a value has gone silent for 5 minutes", () => {
    const health = createInputHealth();
    health.check("progress", 0.5, 0);
    expect(health.check("progress", null, MIN)).toBeNull();
    expect(health.check("progress", null, 6 * MIN)).toBe('check outlook input "progress": it has had no value for 5 minutes');
  });

  it("does not warn about an input that has never given a value (e.g. before the first state)", () => {
    const health = createInputHealth();
    for (let t = 0; t <= 20 * MIN; t += MIN) expect(health.check("safety", null, t)).toBeNull();
  });

  it("tracks each input on its own", () => {
    const health = createInputHealth();
    health.check("equipped", 0, 0);
    health.check("fed", 1, 0);
    expect(health.check("fed", 1, 5 * MIN)).toBeNull();
    expect(health.check("equipped", 0, 5 * MIN)).not.toBeNull();
  });
});
