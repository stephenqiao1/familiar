import { describe, expect, it } from "vitest";
import { createWorkspace } from "./workspace.js";

describe("clearGoal", () => {
  it("drops the goal", () => {
    const store = createWorkspace();
    store.viewFor("prefrontal").setGoal({ text: "g", steps: [], reason: "" });
    store.viewFor("noradrenaline").clearGoal();
    expect(store.goal()).toBeNull();
  });
});

describe("createWorkspace", () => {
  it("stamps each region's writes with its name", () => {
    const store = createWorkspace();
    store.viewFor("prefrontal").setGoal({ text: "build a shelter", steps: ["gather wood"], reason: "night is coming" });
    store.viewFor("instinct").setSignal("fear", 0.4);

    const reader = store.viewFor("reflex");
    expect(reader.goal).toMatchObject({ text: "build a shelter", setBy: "prefrontal" });
    expect(reader.signals.fear).toMatchObject({ value: 0.4, source: "instinct" });
  });

  it("clamps signals to 0..1", () => {
    const store = createWorkspace();
    store.viewFor("x").setSignal("a", 3);
    store.viewFor("x").setSignal("b", Number.NaN);
    expect(store.signals().a!.value).toBe(1);
    expect(store.signals().b!.value).toBe(0);
  });

  it("keeps the last 20 skill events", () => {
    const store = createWorkspace();
    for (let i = 0; i < 25; i++) store.addEvent({ skill: `s${i}`, type: "started", timestamp: i });
    const events = store.viewFor("x").recentEvents;
    expect(events).toHaveLength(20);
    expect(events[0]!.skill).toBe("s5");
  });

  it("shows the latest state and running skill", () => {
    const store = createWorkspace();
    store.update({ schemaVersion: 1, tick: 3, timestamp: 0, data: {} }, { skill: "eat", target: undefined, startedAt: 0 });
    const view = store.viewFor("x");
    expect(view.state.tick).toBe(3);
    expect(view.current?.skill).toBe("eat");
  });

  it("keeps what each area of the cortex last said; ports left out are emptied", () => {
    const store = createWorkspace();
    const ws = store.viewFor("motor");
    expect(ws.cortex).toEqual({});
    ws.setCortex("motor", { up: { stuck: true }, ask: ["chest"] });
    expect(ws.cortex.motor).toMatchObject({ up: { stuck: true }, feedback: null, ask: ["chest"] });
    ws.setCortex("motor", { feedback: { goal: null } });
    expect(store.cortex().motor).toMatchObject({ up: null, feedback: { goal: null }, ask: [] });
  });

  it("fills in a goal's defaults: steps in full beside their text, plain hold-backs in full, an ordinary priority", () => {
    const ws = createWorkspace().viewFor("prefrontal");
    ws.setGoal({ text: "g", steps: ["look", { text: "walk", skill: "go_to", doneWhen: "within 3 of chest" }], reason: "", holdBack: ["flee", { name: "eat", strength: 2, until: "step" }], stepsDone: 1 });
    expect(ws.goal).toMatchObject({
      steps: ["look", "walk"],
      specs: [{ text: "look" }, { text: "walk", skill: "go_to", doneWhen: "within 3 of chest" }],
      holdBack: [{ name: "flee", strength: 1 }, { name: "eat", strength: 1, until: "step", step: 1 }],
      priority: 0.5,
      protected: false,
      doneWhen: null,
    });
    expect(ws.goal!.holdBack[1]!.since).toBe(ws.goal!.setAt);
  });

  it("finishStep moves the goal on one step and leaves who set it and when alone", () => {
    const ws = createWorkspace().viewFor("prefrontal");
    ws.finishStep();
    ws.setGoal({ text: "g", steps: ["a", "b"], reason: "" });
    const { setAt } = ws.goal!;
    const motor = ws;
    motor.finishStep();
    expect(ws.goal).toMatchObject({ stepsDone: 1, setBy: "prefrontal", setAt });
    expect(ws.goal!.stepDoneAt).not.toBeNull();
    motor.finishStep();
    motor.finishStep();
    expect(ws.goal!.stepsDone).toBe(2);
  });

  it("asks the goal gate only when a goal already stands, and keeps that one when it gives a reason", () => {
    const asked: string[] = [];
    const store = createWorkspace({ goalGate: (offered, standing) => (asked.push(`${offered.text} against ${standing.text}`), offered.text === "weak" ? "too weak" : null) });
    const ws = store.viewFor("x");
    expect(ws.setGoal({ text: "first", steps: [], reason: "" })).toBeUndefined();
    expect(ws.setGoal({ text: "weak", steps: [], reason: "" })).toBe("too weak");
    expect(ws.setGoal({ text: "strong", steps: [], reason: "" })).toBeUndefined();
    expect(asked).toEqual(["weak against first", "strong against first"]);
    expect(store.goal()!.text).toBe("strong");
  });
});
