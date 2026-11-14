import type { State, Workspace } from "@familiar/contracts";
import type { OutlookInput } from "@familiar/neuromodulators";
import type { MinecraftStateData } from "../encode/state-data.js";
import { DANGER_DISTANCE, minecraftDataOf, nearestThreat } from "./read-state.js";
import { NEVER_STARTED } from "./rewards.js";

// How good the near future looks to the player, for patience. Each input is one small function
// from 0 (bad) to 1 (good); the outlook is their average. Add or remove one: write it here and
// edit playerOutlook. Every number is a first guess to tune in play.

const MAX_HEALTH = 20;
const MAX_FOOD = 20;
const MAX_LIGHT = 15;
/** Enough food items carried to feel stocked. */
const FOOD_STOCK = 8;
/** How many of the latest finished skills count toward progress. */
const RECENT_SKILLS = 5;
/** How long finishing a step of the goal keeps progress high: after this long about a third of the lift is left. */
const STEP_GLOW_MS = 120_000;
/** Losing this much health in one tick is heavy damage. */
const HEAVY_DAMAGE = 6;

/** An input that reads the Minecraft state; unknown (null) before the first one arrives. */
function input(name: string, read: (data: MinecraftStateData, ws: Workspace) => number): OutlookInput {
  return {
    name,
    read(ws) {
      const data = minecraftDataOf(ws.state);
      return data && read(data, ws);
    },
  };
}

/** No hostile close by, and health not low. */
export const safety = input("safety", (d) => {
  const threat = nearestThreat(d);
  return ((threat ? threat.dist / DANGER_DISTANCE : 1) + d.self.health / MAX_HEALTH) / 2;
});

/** Food bar not low, and some food carried. */
export const fed = input("fed", (d) => (d.self.food / MAX_FOOD + Math.min(d.self.foodItems, FOOD_STOCK) / FOOD_STOCK) / 2);

/** Daytime; or at night, lit and sheltered (a roof and walls). */
export const lightAndShelter = input("light_and_shelter", (d) =>
  d.time.isNight ? (d.time.lightLevel / MAX_LIGHT + (d.self.enclosed ? 1 : 0)) / 2 : 1,
);

/** Carries what the current goal wants; with no such list, at least a weapon. */
export const equipped = input("equipped", (d, ws) => {
  const wants = ws.goal?.wants ?? [];
  if (!wants.length) return d.self.bestWeapon ? 1 : 0.5;
  return wants.reduce((sum, w) => sum + Math.min(d.self.inventory[w.item] ?? 0, w.count) / w.count, 0) / wants.length;
});

/**
 * The goal is advancing: full right after the planner judges a step finished, fading over a couple
 * of minutes back to the share of recently finished skills that succeeded (interrupted ones aside;
 * even with none).
 */
export const progress: OutlookInput = {
  name: "progress",
  read(ws) {
    const ended = ws.recentEvents.filter((e) => e.type === "done" || (e.type === "failed" && !NEVER_STARTED.has(e.reason ?? ""))).slice(-RECENT_SKILLS);
    const skillShare = ended.length ? ended.filter((e) => e.type === "done").length / ended.length : 0.5;
    const stepDoneAt = ws.goal?.stepDoneAt ?? null;
    const glow = stepDoneAt === null ? 0 : Math.exp(-Math.max(0, ws.state.timestamp - stepDoneAt) / STEP_GLOW_MS);
    return skillShare + (1 - skillShare) * glow;
  },
};

// TODO(serotonin): a "company" input (a friendly player nearby) once social features exist.

/** Everything the player's outlook is made of. */
export const playerOutlook: OutlookInput[] = [safety, fed, lightAndShelter, equipped, progress];

/** Sudden danger: a hostile appears close by when none was, or heavy damage in one tick. */
export function isShock(before: State, after: State): boolean {
  const a = minecraftDataOf(before);
  const b = minecraftDataOf(after);
  if (!a || !b) return false;
  return (!nearestThreat(a) && nearestThreat(b) !== null) || a.self.health - b.self.health >= HEAVY_DAMAGE;
}
