import type { State } from "@familiar/contracts";
import { SCHEMA_VERSION } from "../encode/encode-state.js";
import type { MinecraftStateData } from "../encode/state-data.js";

/** A hostile mob this close is a threat (it triggers fight-or-flight). */
export const DANGER_DISTANCE = 8;

/** A state's Minecraft data, or null if it is not a Minecraft state (e.g. before the first one arrives). */
export function minecraftDataOf(state: State): MinecraftStateData | null {
  return state.schemaVersion === SCHEMA_VERSION ? (state.data as unknown as MinecraftStateData) : null;
}

/** The closest hostile mob within DANGER_DISTANCE, or null. */
export function nearestThreat(data: MinecraftStateData) {
  return data.nearby.mobs.filter((m) => m.hostile && m.dist <= DANGER_DISTANCE).sort((a, b) => a.dist - b.dist)[0] ?? null;
}
