import { describe, expect, it } from "vitest";
import { cleanWants, namePrompt, planPrompt } from "./claude-planner.js";

describe("planPrompt", () => {
  it("puts the current goal before the situation", () => {
    const prompt = planPrompt({
      situation: "health 20/20",
      currentGoal: { text: "build a shelter", steps: ["gather wood"], specs: [{ text: "gather wood" }], priority: 0.5, protected: false, doneWhen: null, reason: "", wants: [{ item: "torch", count: 8 }], watchFor: [], ifThen: [], holdBack: [], detail: [], expect: [], stepsDone: 0, stepDoneAt: null, setBy: "prefrontal", setAt: 0 },
    });
    expect(prompt).toBe("Current goal: build a shelter\nSteps (0 of 1 done): gather wood\nCarry: 8 torch\n\nSituation:\nhealth 20/20\n\nSet the goal.");
  });

  it("says when there is no goal yet", () => {
    expect(planPrompt({ situation: "x", currentGoal: null })).toMatch(/^Current goal: none yet\./);
  });
});

describe("cleanWants", () => {
  it("rounds counts, drops empty ones, and keeps one entry per item", () => {
    expect(cleanWants([{ item: "bread", count: 4.6 }, { item: "torch", count: 0 }, { item: "", count: 2 }, { item: "bread", count: 8 }])).toEqual([
      { item: "bread", count: 8 },
    ]);
  });

});

describe("what the planner is shown and asked, with the cortex on", () => {
  it("shows a step given in full, a graded hold-back, a protected goal and why it was woken", () => {
    const prompt = planPrompt({
      situation: "health 20/20",
      woken: "Step 1 is stuck: go_to failed 3 times. Plan another way.",
      currentGoal: {
        text: "fetch bread",
        steps: ["go to the chest", "eat"],
        specs: [{ text: "go to the chest", skill: "go_to", target: "pos:1,2,3", doneWhen: "within 3 of chest", giveUpWhen: "time is night" }, { text: "eat" }],
        priority: 0.8,
        protected: true,
        doneWhen: "need safety below 0.5",
        reason: "",
        wants: [],
        watchFor: [],
        ifThen: [],
        holdBack: [{ name: "flee", strength: 0.5, until: "step" }, { name: "eat", strength: 1 }, { name: "steady", strength: 1, until: 20 }],
        detail: [],
        expect: [{ what: "sees chest", when: "within 6 of base chest" }, { what: "not sees zombie" }],
        stepsDone: 1,
        stepDoneAt: null,
        setBy: "prefrontal",
        setAt: 0,
      },
    });
    expect(prompt).toBe(
      'Current goal: fetch bread (priority 0.8)\nThis goal is protected: it stands until "need safety below 0.5" is true, and your plan will wait until then.\n' +
        "Steps (1 of 2 done): go to the chest [skill go_to at pos:1,2,3; done when within 3 of chest; give up when time is night]; eat\nCarry: nothing in particular\n" +
        "Holding back: flee (strength 0.5, until its step is done), eat, steady (strength 1, for 20 s)\nExpecting: sees chest (when within 6 of base chest); not sees zombie\n\nSituation:\nhealth 20/20\n\nStep 1 is stuck: go_to failed 3 times. Plan another way.\n\nSet the goal.",
    );
  });

  it("shows the planner its notes, and says so when it has none yet", () => {
    expect(planPrompt({ situation: "s", currentGoal: null, notes: [{ key: "ledge", text: "cannot be reached" }, { key: "chest", text: "empty" }] })).toBe(
      "Current goal: none yet.\n\nYour notes (2 of 5):\n- ledge: cannot be reached\n- chest: empty\n\nSituation:\ns\n\nSet the goal.",
    );
    expect(planPrompt({ situation: "s", currentGoal: null, notes: [] })).toContain("Your notes (0 of 5): none yet.");
    expect(planPrompt({ situation: "s", currentGoal: null })).not.toContain("notes");
  });

  it("asks for a routine's name with its steps, what it brings about and the names in use", () => {
    expect(namePrompt({ steps: [{ skill: "go_to", target: "nearest:chest" }, { skill: "take_items" }], doneWhen: "carrying 1 bread", taken: ["go_to", "eat"] })).toBe(
      "The agent has done this routine several times, and each time it brought about: carrying 1 bread\n1. go_to (nearest:chest)\n2. take_items\n\nIt will be kept as one ability of its own. Names already in use: go_to, eat.\nName it in one word and describe it in one line.",
    );
  });
});
