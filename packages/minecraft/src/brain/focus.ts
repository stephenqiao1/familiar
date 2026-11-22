import type { State, Workspace } from "@familiar/contracts";
import { distance, type MemoryStore } from "@familiar/memory";
import { predictionsFailing, SURPRISE_SIGNAL, type FocusInput, type Thing } from "@familiar/neuromodulators";
import type { MinecraftStateData } from "../encode/state-data.js";
import { thingsInView } from "./cues.js";
import { placeOf } from "./memories.js";
import { minecraftDataOf } from "./read-state.js";

// What moves the player's focus. Each input runs from -1 (what the bot knows holds here: assume)
// to 1 (it does not, or there is little of it: look closely). Add or remove one: write it here
// and edit playerFocus. Darkness, night and danger are not here: they are needs, and patience
// and alarm follow those. Every number is a first guess to tune in play.

/** Memories within this many blocks make a place familiar. */
const FAMILIAR_WITHIN = 32;
/** This many memories nearby and the place is well known. */
const WELL_KNOWN = 5;

/** An input that reads the Minecraft state; neutral before the first one arrives. */
function input(name: string, read: (data: MinecraftStateData, ws: Workspace, now: number) => number): FocusInput {
  return {
    name,
    read(ws, now) {
      const data = minecraftDataOf(ws.state);
      return data ? read(data, ws, now) : 0;
    },
  };
}

/** Few or no memories of this place push focus up; a well-known place pulls it down. */
export function unfamiliarPlace(memory: MemoryStore): FocusInput {
  return input("unfamiliar_place", (_d, ws, now) => {
    const here = placeOf(ws.state);
    if (!here) return 0;
    const known = memory.recall({ place: here, limit: WELL_KNOWN, touch: false }, now).filter((m) => distance(m.place, here) <= FAMILIAR_WITHIN).length;
    return 1 - (2 * known) / WELL_KNOWN;
  });
}

/** How well the bot's predictions have been holding, from dopamine's surprise at each run that ends. */
const surprised = () =>
  predictionsFailing((ws) => {
    const signal = ws.signals[SURPRISE_SIGNAL];
    return signal ? { size: signal.value, at: signal.at } : null;
  });

/** A fresh set of everything that moves the player's focus (some inputs keep their own state). */
export function playerFocus(memory: MemoryStore): FocusInput[] {
  return [unfamiliarPlace(memory), surprised()];
}

/** Asleep: in bed with eyes shut. */
export function asleep(ws: Workspace): boolean {
  return minecraftDataOf(ws.state)?.self.asleep ?? false;
}

/** The bot moved between two states. */
export function moved(before: State, after: State): boolean {
  const [a, b] = [placeOf(before), placeOf(after)];
  return a !== null && b !== null && distance(a, b) > 0;
}

/** The things in view the current goal asked the bot to watch for. */
export function watchedThings(ws: Workspace): Thing[] {
  const watchFor = ws.goal?.watchFor ?? [];
  return watchFor.length ? thingsInView(ws.state).filter((t) => watchFor.includes(t.kind)) : [];
}
