import type { Feeling, State, Workspace } from "@familiar/contracts";
import { FEAR_SIGNAL } from "@familiar/region-amygdala";
import { AIR_SIGNAL, AROUSAL_SIGNAL, COLD_SIGNAL, HUNGER_SIGNAL, HURT_SIGNAL, PAIN_SIGNAL, SICK_SIGNAL, SORE_SIGNAL, TIRED_SIGNAL } from "@familiar/region-brainstem";
import { STRESS_SIGNAL } from "@familiar/region-hypothalamus";
import type { InsulaOptions, Reading } from "@familiar/region-insula";
import type { MinecraftStateData } from "../encode/state-data.js";
import { minecraftDataOf } from "./read-state.js";

// The player's insula: the table from the body's readings to a word for each feeling, the raw
// readings it watches for a change nothing explains, and what explains one. Every feeling here
// restates a reading another region already shares; none is made up.
// Add a feeling: add a row to FEELINGS.

const MAX = { health: 20, food: 20, air: 20 };
/** Arousal above this starts to feel tense; at 1 it is fully so. */
const TENSE_FROM = 0.7;
/** A hit this recent explains health falling. */
const HIT_WITHIN_MS = 3000;
/** A meal this recent explains food rising. */
const MEAL_WITHIN_MS = 5000;
/** Kinds of damage with nothing to see: health lost to one of these is not explained by the hit itself. */
const UNSEEN_DAMAGE = new Set(["generic", "magic", "indirect_magic", "out_of_world", "generic_kill"]);
const EATING = ["eat", "consume"];

type Level = (ws: Workspace, data: MinecraftStateData) => number;
const signal = (ws: Workspace, name: string) => ws.signals[name]?.value;

/** Each feeling: its word, the reading it restates, and how strong that reading is now (0 to 1). The body's own reading is used where the medulla is left out. */
const FEELINGS: { word: string; from: string; level: Level }[] = [
  { word: "hungry", from: "hunger", level: (ws, d) => signal(ws, HUNGER_SIGNAL) ?? 1 - d.self.food / MAX.food },
  // Hurting is the standing loss of health, or the fresh sting (and the soreness after it) if that is stronger.
  { word: "hurting", from: "health and pain", level: (ws, d) => Math.max(signal(ws, HURT_SIGNAL) ?? 1 - d.self.health / MAX.health, signal(ws, PAIN_SIGNAL) ?? 0, 0.5 * (signal(ws, SORE_SIGNAL) ?? 0)) },
  { word: "tired", from: "tiredness", level: (ws) => signal(ws, TIRED_SIGNAL) ?? 0 },
  { word: "cold", from: "cold", level: (ws, d) => signal(ws, COLD_SIGNAL) ?? d.self.freezing },
  { word: "sick", from: "illness", level: (ws) => signal(ws, SICK_SIGNAL) ?? 0 },
  { word: "short of breath", from: "air", level: (ws, d) => signal(ws, AIR_SIGNAL) ?? 1 - d.self.air / MAX.air },
  { word: "afraid", from: "fear", level: (ws) => signal(ws, FEAR_SIGNAL) ?? 0 },
  // Tense is the slow wear of stress, or being wound up right now.
  { word: "tense", from: "stress and arousal", level: (ws) => Math.max(signal(ws, STRESS_SIGNAL) ?? 0, ((signal(ws, AROUSAL_SIGNAL) ?? 0) - TENSE_FROM) / (1 - TENSE_FROM)) },
];

/** The words a feeling can be, for anything that lists them. "at ease" is said when none is felt. */
export const FEELING_WORDS = FEELINGS.map((f) => f.word);

/** The body's readings as feelings, in the table's order. */
export function playerReadings(ws: Workspace): Reading[] {
  const data = minecraftDataOf(ws.state);
  return data ? FEELINGS.map(({ word, from, level }) => ({ word, from, level: Math.min(1, Math.max(0, level(ws, data))) })) : [];
}

/** The raw readings watched for a change nothing explains, each 0 (none) to 1 (full). */
export function playerBody(ws: Workspace): Record<string, number> {
  const self = minecraftDataOf(ws.state)?.self;
  return self ? { health: self.health / MAX.health, food: self.food / MAX.food, breath: self.air / MAX.air } : {};
}

/**
 * The known cause of a raw reading changing right now, or null. Health: a hit that could be
 * seen (an attacker, a fall, fire, a cactus), drowning, starving, an illness, and any healing.
 * Food: the hunger effect and ordinary use on the way down, a meal on the way up. Breath: being
 * under water, and any coming back.
 */
export function playerExplains(reading: string, change: number, ws: Workspace): string | null {
  const data = minecraftDataOf(ws.state);
  if (!data) return "no body yet";
  const { self } = data;
  if (reading === "health") {
    if (change > 0) return "healing";
    const hurt = self.lastHurt;
    if (hurt && hurt.msAgo <= HIT_WITHIN_MS && (hurt.by !== null || (hurt.kind !== null && !UNSEEN_DAMAGE.has(hurt.kind)))) return hurt.kind ?? "a hit";
    if (self.falling || self.onFire || self.inLava || self.inBlock) return "a fall, fire or being buried";
    if (self.air <= 0) return "drowning";
    if (self.food <= 0) return "starving";
    return self.effects.some((e) => e === "poison" || e === "wither") ? "illness" : null;
  }
  if (reading === "food") {
    if (change < 0) return self.effects.includes("hunger") ? "the hunger effect" : null;
    const ate = ws.current && EATING.includes(ws.current.skill) ? ws.current.skill : ws.recentEvents.find((e) => EATING.includes(e.skill) && e.type === "done" && ws.state.timestamp - e.timestamp <= MEAL_WITHIN_MS)?.skill;
    return ate ?? (self.effects.includes("saturation") ? "the saturation effect" : null);
  }
  if (reading === "breath") return change > 0 || self.inWater || self.inBlock ? "water or air" : null;
  return null;
}

/** What the insula region needs from the player (everything but the bot's settings and the surprises). */
export function playerInsula(): Pick<InsulaOptions, "readings" | "body" | "explains"> {
  return { readings: playerReadings, body: playerBody, explains: playerExplains };
}

/** The body's readings that the feeling line restates: with the line alone, the deciding layers are not also told these numbers. */
const RESTATED = ["health", "food", "saturation", "air", "freezing", "sinceSleepMinutes", "healing"] as const;

/**
 * A view of the state with the feeling added to the body (`self.feels`), for the deciding
 * layers. `numbers` false: the readings the line restates are left out, so they are told the
 * line alone. With no feeling, or nothing to change, the view is returned as it is.
 */
export function withFeeling(view: State, feeling: Feeling | null, tell: { line: boolean; numbers: boolean }): State {
  const data = minecraftDataOf(view);
  if (!data || !feeling || (!tell.line && tell.numbers)) return view;
  const self: Record<string, unknown> = { ...data.self, ...(tell.line ? { feels: feeling.line } : {}) };
  if (!tell.numbers) for (const key of RESTATED) delete self[key];
  return { ...view, data: { ...view.data, self } };
}
