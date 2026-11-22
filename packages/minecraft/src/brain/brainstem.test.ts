import type { Skill } from "@familiar/contracts";
import { createWorkspace } from "@familiar/core";
import { describe, expect, it } from "vitest";
import { fakeData, fakeState, type StatePatch } from "../encode/state.test-helper.js";
import { menuSkills } from "../skills/index.js";
import { HOLDABLE, leaningOf, playerBrainstem, REFLEX_NOTE } from "./brainstem.js";

const ws = createWorkspace().viewFor("brainstem");
const zombie = (dist: number, id = 1) => ({ id: `entity:${id}`, type: "zombie", dist, hostile: true, reachable: true });
const moment = (before: StatePatch, after: StatePatch) => ({ before: fakeState(before), after: fakeState(after), ws });

describe("playerBrainstem", () => {
  const skill = (name: string, flags: Partial<Skill<null>> = {}): Skill<null> => ({ name, description: "", canRun: (_ctx, target) => target !== "pos:0,0,0", run: async () => ({ status: "done" }), ...flags });
  const skills = [skill("flee"), skill("brace", { primitive: true }), skill("surface", { reflexOnly: true })];
  const settings = playerBrainstem(skills, null);

  it("lets a loaded response name a real skill, but not a primitive, a reflex-only skill or an unknown one", () => {
    expect(settings.responseProblem("flee")).toBeNull();
    expect(settings.responseProblem("brace")).toBe("a primitive, not a skill");
    expect(settings.responseProblem("surface")).toBe("reflex-only skill");
    expect(settings.responseProblem("fly")).toBe("unknown skill");
  });

  it("reads what the brainstem needs of the body: health, and whether it is stuck or sore", () => {
    expect(settings.body(fakeState({ self: { health: 10, air: 5, food: 15 } }))).toEqual({ health: 0.5, stuck: false, sore: 0 });
    expect(settings.body({ schemaVersion: 0, tick: 0, timestamp: 0, data: {} })).toBeNull();
  });

  it("knows which way each reflex skill leans, and what a goal may hold back", () => {
    expect([leaningOf("flee"), leaningOf("attack"), leaningOf("freeze"), leaningOf("eat")]).toEqual(["away", "toward", null, null]);
    expect(HOLDABLE).toEqual(["defence_fight", "defence_flee", "defence_freeze", "recuperate", "hold_ground", "edge_guard", "need_air", "eat_to_heal", "cure", "eat_when_starving", "flee", "attack", "eat", "steady"]);
    expect(REFLEX_NOTE).toContain("in_lava_or_fire, drowning, last_stand");
  });

  it("keeps primitives and reflex-only skills off the menu unless primitives are asked for", () => {
    expect(menuSkills(skills).map((s) => s.name)).toEqual(["flee"]);
    expect(menuSkills(skills, true).map((s) => s.name)).toEqual(["flee", "brace"]);
  });
});
