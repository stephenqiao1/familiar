import type { State } from "@familiar/contracts";
import { SCHEMA_VERSION } from "../encode/encode-state.js";
import type { MinecraftStateData, Sighted } from "../encode/state-data.js";

/** A hostile mob this close is a threat: it keeps alarm up, and the defence reflexes act inside it. */
export const DANGER_DISTANCE = 8;

/** A state's Minecraft data, or null if it is not a Minecraft state (e.g. before the first one arrives). */
export function minecraftDataOf(state: State): MinecraftStateData | null {
  return state.schemaVersion === SCHEMA_VERSION ? (state.data as unknown as MinecraftStateData) : null;
}

/** The closest hostile mob within DANGER_DISTANCE, or null. */
export function nearestThreat(data: MinecraftStateData) {
  return data.nearby.mobs.filter((m) => m.hostile && m.dist <= DANGER_DISTANCE).sort((a, b) => a.dist - b.dist)[0] ?? null;
}

/** What the eyes say of a nearby thing; one from a state made without eyes counts as seen, straight ahead and still. */
export function sightedOf(thing: Partial<Sighted>): Sighted {
  return { bearing: thing.bearing ?? { side: "ahead", angle: 0 }, seen: thing.seen ?? true, closing: thing.closing ?? 0, ...(thing.speed === undefined ? {} : { speed: thing.speed }), ...(thing.lastSeen ? { lastSeen: thing.lastSeen } : {}) };
}
