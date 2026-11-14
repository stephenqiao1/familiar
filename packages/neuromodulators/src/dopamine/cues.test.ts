import { describe, expect, it } from "vitest";
import { cueProposals, MAX_CUE_URGENCY, towardKey, type Thing } from "./cues.js";
import { createScorebook } from "./scorebook.js";

const chest = (id: string): Thing => ({ id, kind: "chest" });
const lava: Thing = { id: "pos:0,0,9", kind: "lava" };

/** A scorebook where heading to chests paid off and heading to lava hurt. */
function book() {
  const scorebook = createScorebook();
  for (let i = 0; i < 3; i++) scorebook.learn("day", towardKey("go_to", "chest"), 1, 0.1);
  scorebook.learn("day", towardKey("go_to", "lava"), -1, 0.1);
  return scorebook;
}

describe("cueProposals", () => {
  it("proposes heading to the nearest thing of a kind that paid off before", () => {
    const { cues, proposals } = cueProposals({
      things: [chest("pos:1,0,0"), lava, chest("pos:5,0,0")],
      situation: "day",
      da: 0.5,
      scorebook: book(),
      skillsToward: () => ["go_to"],
    });
    expect(cues).toEqual([{ thing: chest("pos:1,0,0"), skill: "go_to", boost: expect.any(Number) }]);
    expect(proposals).toEqual([
      { action: { skill: "go_to", target: "pos:1,0,0" }, urgency: expect.any(Number), reason: expect.stringMatching(/^wants the chest/) },
    ]);
    expect(proposals[0]!.urgency).toBeGreaterThan(0);
    expect(proposals[0]!.urgency).toBeLessThanOrEqual(MAX_CUE_URGENCY);
  });

  it("wants nothing it has no good memories of, in another situation, or that no skill can reach", () => {
    const scorebook = book();
    const run = (situation: string, skillsToward: () => string[]) =>
      cueProposals({ things: [chest("pos:1,0,0")], situation, da: 0.5, scorebook, skillsToward }).proposals;
    expect(run("night", () => ["go_to"])).toEqual([]);
    expect(run("day", () => [])).toEqual([]);
    expect(cueProposals({ things: [lava], situation: "day", da: 0.5, scorebook, skillsToward: () => ["go_to"] }).proposals).toEqual([]);
  });

  it("wants nothing it never learned about, even when DA makes every fresh skill look good", () => {
    const { proposals } = cueProposals({ things: [chest("pos:1,0,0")], situation: "day", da: 0.65, scorebook: createScorebook(), skillsToward: () => ["go_to"] });
    expect(proposals).toEqual([]);
  });

  it("caps the urgency", () => {
    const scorebook = createScorebook();
    for (let i = 0; i < 40; i++) scorebook.learn("day", towardKey("go_to", "chest"), 5, 0.1);
    const { proposals } = cueProposals({ things: [chest("pos:1,0,0")], situation: "day", da: 0.9, scorebook, skillsToward: () => ["go_to"] });
    expect(proposals[0]!.urgency).toBe(MAX_CUE_URGENCY);
  });
});
