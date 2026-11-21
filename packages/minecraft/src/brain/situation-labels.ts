import type { State } from "@familiar/contracts";
import type { MinecraftStateData } from "../encode/state-data.js";
import { minecraftDataOf, nearestThreat } from "./read-state.js";

// The rough situation the scorebook learns under. Each entry below reads one label from the
// state; a situation is its labels joined by "/". The scorebook keeps one adjustment per skill
// and label (not a page per combination), so adding a label here costs one adjustment per skill.
// Every threshold is a first guess to tune in play.

/** Below this food level counts as hungry. */
export const HUNGRY_FOOD = 14;
/** Within this many blocks of base counts as at base. */
export const BASE_RADIUS = 16;
const FULL_AIR = 20;

/** One label of the situation: what it says of a state. Add a label: add an entry. */
const LABELS: ((data: MinecraftStateData) => string)[] = [
  (d) => (d.time.isNight ? "night" : "day"),
  (d) => (nearestThreat(d) ? "threatened" : "safe"),
  (d) => (d.self.food < HUNGRY_FOOD ? "hungry" : "fed"),
  (d) => (d.self.distanceToBase <= BASE_RADIUS ? "at_base" : d.self.skyLight === 0 ? "underground" : "surface"),
  (d) => (d.nearby.players.length > 0 ? "with_others" : "alone"),
  // What the body is in the middle of: trouble it is already in is not the doing of whatever starts next.
  (d) => (d.self.falling ? "falling" : d.self.onFire || d.self.inLava ? "burning" : d.self.air < FULL_AIR ? "underwater" : "steady"),
];

/** E.g. "night/threatened/hungry/underground/alone/steady", or "unknown" before the first Minecraft state. */
export function situationOf(state: State): string {
  const data = minecraftDataOf(state);
  return data ? LABELS.map((label) => label(data)).join("/") : "unknown";
}
