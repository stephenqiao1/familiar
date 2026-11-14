import type { Skill, State, Workspace } from "@familiar/contracts";
import { distance, type MemoryStore } from "@familiar/memory";
import { SURPRISE_SIGNAL, type FocusInput, type Thing } from "@familiar/neuromodulators";
import type { MinecraftStateData } from "../encode/state-data.js";
import { thingsInView } from "./cues.js";
import { placeOf } from "./memories.js";
import { minecraftDataOf } from "./read-state.js";

// What moves the player's focus. Each input runs from -1 (routine, restful: assume) to 1
// (unreliable, demanding: look closely). Add or remove one: write it here and edit playerFocus.
// Every number is a first guess to tune in play.

const MAX_LIGHT = 15;
/** Memories within this many blocks make a place familiar. */
const FAMILIAR_WITHIN = 32;
/** This many memories nearby and the place is well known. */
const WELL_KNOWN = 5;
/** A surprise this size is medium: noise, not a broken rule. */
const MEDIUM = [0.3, 0.6] as const;
const NOISY_WINDOW_MS = 120_000;
const NOISY_COUNT = 2;
/** Skills that are rest, not work. */
const RESTFUL = new Set(["idle", "sleep"]);

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

/** Darkness: up as the light falls. */
export const darkness = input("darkness", (d) => 1 - d.time.lightLevel / MAX_LIGHT);

/** Night, or a closed-in space: harder to see what is coming. */
export const nightOrEnclosed = input("night_or_enclosed", (d) => (d.time.isNight ? 0.5 : 0) + (d.self.enclosed ? 0.5 : 0));

/** Few or no memories of this place push focus up; a well-known place pulls it down. */
export function unfamiliarPlace(memory: MemoryStore): FocusInput {
  return input("unfamiliar_place", (_d, ws, now) => {
    const here = placeOf(ws.state);
    if (!here) return 0;
    const known = memory.recall({ place: here, limit: WELL_KNOWN, touch: false }, now).filter((m) => distance(m.place, here) <= FAMILIAR_WITHIN).length;
    return 1 - (2 * known) / WELL_KNOWN;
  });
}

/** Medium surprises keep happening: things are noisy here, though no rule is broken. */
export function noisy(): FocusInput {
  let seenAt = -1;
  let recent: number[] = [];
  return {
    name: "noisy",
    read(ws, now) {
      const signal = ws.signals[SURPRISE_SIGNAL];
      if (signal && signal.at !== seenAt) {
        seenAt = signal.at;
        if (signal.value >= MEDIUM[0] && signal.value < MEDIUM[1]) recent.push(now);
      }
      recent = recent.filter((at) => now - at <= NOISY_WINDOW_MS);
      return recent.length >= NOISY_COUNT ? 1 : 0;
    },
  };
}

/** The running skill: up for one that marks itself demanding, down for rest or nothing at all. */
export function task<Ctx>(skills: Skill<Ctx>[]): FocusInput {
  const demanding = new Set(skills.filter((s) => s.demanding).map((s) => s.name));
  return {
    name: "task",
    read(ws) {
      const running = ws.current?.skill;
      if (running === undefined || RESTFUL.has(running)) return -1;
      return demanding.has(running) ? 1 : 0;
    },
  };
}

// TODO(focus): let the planner mark a goal as demanding (a "needs care" flag on the plan).

/** A fresh set of everything that moves the player's focus (some inputs keep their own state). */
export function playerFocus<Ctx>(memory: MemoryStore, skills: Skill<Ctx>[]): FocusInput[] {
  return [darkness, nightOrEnclosed, unfamiliarPlace(memory), noisy(), task(skills)];
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
