import type { Candidate, Workspace } from "@familiar/contracts";
import { describe, expect, it } from "vitest";
import { highestUrgency } from "./highest-urgency.js";

/** The highest-urgency arbiter never reads the workspace. */
const ws = {} as Workspace;
const c = (region: string, layer: number, urgency: number): Candidate => ({
  region,
  layer,
  urgency,
  action: { skill: region },
  reason: "",
});

describe("highestUrgency", () => {
  it("picks the most urgent candidate", () => {
    expect(highestUrgency.pick([c("instinct", 1, 0.4), c("reflex", 0, 0.9)], ws)?.region).toBe("reflex");
    expect(highestUrgency.pick([c("reflex", 0, 0.2), c("instinct", 1, 0.6)], ws)?.region).toBe("instinct");
  });

  it("breaks ties in favour of the faster layer", () => {
    expect(highestUrgency.pick([c("prefrontal", 2, 0.5), c("instinct", 1, 0.5)], ws)?.region).toBe("instinct");
  });

  it("returns null with no candidates", () => {
    expect(highestUrgency.pick([], ws)).toBeNull();
  });

  describe("settledEarly", () => {
    it("settles on a full-urgency candidate when only slower layers are still running", () => {
      expect(highestUrgency.settledEarly!([c("reflex", 0, 1)], [1, 2], ws)?.region).toBe("reflex");
    });

    it("waits while a faster layer is still running", () => {
      expect(highestUrgency.settledEarly!([c("instinct", 1, 1)], [0], ws)).toBeNull();
    });

    it("waits when the best is below full urgency", () => {
      expect(highestUrgency.settledEarly!([c("reflex", 0, 0.9)], [1], ws)).toBeNull();
    });
  });
});
