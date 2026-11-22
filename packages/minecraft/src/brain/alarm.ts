import type { State, Workspace } from "@familiar/contracts";
import { STARTLE_SIGNAL } from "@familiar/region-brainstem";
import { pressingThreat } from "./defence.js";
import { minecraftDataOf } from "./read-state.js";

// What the player's alarm reads beside its needs. Alarm itself follows the needs (see the
// noradrenaline region): a mob appearing, a blow or something rushing in is a need suddenly
// worse. What no need shows (a bang, a blow out of nowhere) reaches it as the body's startle.

/** The body's startle this tick, 0 to 1. */
export const startleOf = (ws: Workspace): number => ws.signals[STARTLE_SIGNAL]?.value ?? 0;

/**
 * A threat is present: one that can get to the bot, or hit it from where it is, and is coming or
 * on it. One that cannot reach the bot, or has not noticed it, does not count.
 */
export function threatPresent(state: State): boolean {
  const data = minecraftDataOf(state);
  return data !== null && pressingThreat(data) !== null;
}

// TODO(alarm): a hostile mob targeting the bot (the state doesn't say who a mob is after).
// TODO(alarm): another player being attacked (not sensed yet). Explosions and thunder reach alarm through startle.
