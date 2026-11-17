import type { State } from "@familiar/contracts";
import { SCHEMA_VERSION } from "./encode-state.js";
import type { MinecraftStateData } from "./state-data.js";

/** Parts of a Minecraft state to override in a test. */
export interface StatePatch {
  time?: Partial<MinecraftStateData["time"]>;
  self?: Partial<MinecraftStateData["self"]>;
  nearby?: Partial<MinecraftStateData["nearby"]>;
  current?: MinecraftStateData["current"];
}

/** For tests: a healthy, fed, empty-handed bot at base by day with nothing nearby, plus the patch. */
export function fakeData(p: StatePatch = {}): MinecraftStateData {
  return {
    time: { isNight: false, lightLevel: 15, ...p.time },
    self: {
      position: { x: 0, y: 63, z: 0 },
      dimension: "overworld",
      health: 20,
      food: 20,
      heldItem: null,
      bestWeapon: null,
      inventoryFullPct: 0,
      foodItems: 0,
      badFoodItems: 0,
      saturation: 5,
      effects: [],
      freezing: 0,
      sinceSleepMinutes: 0,
      healing: false,
      inventory: {},
      distanceToBase: 0,
      biome: "plains",
      skyLight: 15,
      enclosed: false,
      asleep: false,
      deaths: 0,
      air: 20,
      onFire: false,
      inLava: false,
      inWater: false,
      falling: false,
      lastHurt: null,
      touching: { feet: "air", head: "air", below: "stone", sides: ["air", "air", "air", "air"] },
      inBlock: false,
      pushed: null,
      motion: null,
      locomotion: { moving: false, pattern: null, gait: "walk", stuck: false },
      ...p.self,
    },
    nearby: { hazards: [], mobs: [], blocks: [], players: [], loud: [], ...p.nearby },
    memory: null,
    current: p.current ?? null,
  };
}

/** For tests: `fakeData(p)` wrapped as a State. */
export function fakeState(p: StatePatch = {}, timestamp = 0): State {
  return { schemaVersion: SCHEMA_VERSION, tick: 0, timestamp, data: { ...fakeData(p) } };
}
