import { describe, expect, it } from "vitest";
import { MAX_WASTE, wastedEffort } from "./wasted.js";

const run = (effort: number, gained = 0) => ({ effort, gained, ended: "done" as const });

describe("wastedEffort", () => {
  it("charges the effort of a run that was expected to pay and earned nothing", () => {
    expect(wastedEffort(run(0.1), 0.3)).toBeCloseTo(0.1);
    expect(wastedEffort({ ...run(0.1), ended: "failed" }, 0.3)).toBeCloseTo(0.1);
  });

  it("charges more for more effort, up to a cap", () => {
    expect(wastedEffort(run(0.3), 0.3)).toBeGreaterThan(wastedEffort(run(0.1), 0.3));
    expect(wastedEffort(run(0), 0.3)).toBe(0);
    expect(wastedEffort(run(50), 0.3)).toBe(MAX_WASTE);
  });

  it("takes off what the run earned: one that paid for its effort wasted nothing", () => {
    expect(wastedEffort(run(0.1, 0.04), 0.3)).toBeCloseTo(0.06);
    expect(wastedEffort(run(0.1, 0.5), 0.3)).toBe(0);
  });

  it("charges nothing when no payoff was expected", () => {
    expect(wastedEffort(run(0.1), 0)).toBe(0);
    expect(wastedEffort(run(0.1), -0.2)).toBe(0);
  });

  it("charges nothing for a run cut short, or one that ended in death", () => {
    expect(wastedEffort({ ...run(0.1), ended: "interrupted" }, 0.3)).toBe(0);
    expect(wastedEffort({ ...run(0.1), fatal: true }, 0.3)).toBe(0);
  });
});
