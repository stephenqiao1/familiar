import type { Candidate } from "@familiar/contracts";
import { describe, expect, it } from "vitest";
import { highestUrgency } from "./highest-urgency.js";

const c = (region: string, layer: number, urgency: number): Candidate => ({
  region,
  layer,
  urgency,
  action: { skill: region },
  reason: "",
});

describe("highestUrgency", () => {
  it("picks the most urgent candidate", () => {
    expect(highestUrgency.pick([c("instinct", 1, 0.4), c("reflex", 0, 0.9)])?.region).toBe("reflex");
    expect(highestUrgency.pick([c("reflex", 0, 0.2), c("instinct", 1, 0.6)])?.region).toBe("instinct");
  });

  it("breaks ties in favour of the faster layer", () => {
    expect(highestUrgency.pick([c("neocortex", 2, 0.5), c("instinct", 1, 0.5)])?.region).toBe("instinct");
  });

  it("returns null with no candidates", () => {
    expect(highestUrgency.pick([])).toBeNull();
  });

  describe("settledEarly", () => {
    it("settles on a full-urgency candidate when only slower layers are still running", () => {
      expect(highestUrgency.settledEarly!([c("reflex", 0, 1)], [1, 2])?.region).toBe("reflex");
    });

    it("waits while a faster layer is still running", () => {
      expect(highestUrgency.settledEarly!([c("instinct", 1, 1)], [0])).toBeNull();
    });

    it("waits when the best is below full urgency", () => {
      expect(highestUrgency.settledEarly!([c("reflex", 0, 0.9)], [1])).toBeNull();
    });
  });
});
