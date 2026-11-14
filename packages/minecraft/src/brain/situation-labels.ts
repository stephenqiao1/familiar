import type { State } from "@familiar/contracts";
import type { MinecraftStateData } from "../encode/state-data.js";
import { minecraftDataOf, nearestThreat } from "./read-state.js";

// The rough situation the scorebook files each skill under: five labels, at most 48 situations.
// Every threshold here is a first guess to tune in play.

/** Below this food level counts as hungry. */
export const HUNGRY_FOOD = 14;
/** Within this many blocks of base counts as at base. */
export const BASE_RADIUS = 16;

/** E.g. "night/threatened/hungry/underground/alone", or "unknown" before the first Minecraft state. */
export function situationOf(state: State): string {
  const data = minecraftDataOf(state);
  if (!data) return "unknown";
  return [
    data.time.isNight ? "night" : "day",
    nearestThreat(data) ? "threatened" : "safe",
    data.self.food < HUNGRY_FOOD ? "hungry" : "fed",
    place(data),
    data.nearby.players.length > 0 ? "with_others" : "alone",
  ].join("/");
}

function place(data: MinecraftStateData): string {
  if (data.self.distanceToBase <= BASE_RADIUS) return "at_base";
  return data.self.skyLight === 0 ? "underground" : "surface";
}
