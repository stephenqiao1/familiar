import type { State } from "@familiar/contracts";
import type { Vitals } from "@familiar/region-brainstem";
import type { ReflexRule } from "@familiar/region-reflex";
import type { MinecraftStateData } from "../encode/state-data.js";
import { INNATE_BAD_FOODS } from "../foods.js";
import { REFLEX_SKILLS } from "./protective-reflexes.js";
import { minecraftDataOf } from "./read-state.js";
import { onIt } from "./defence.js";
import { LOW_AIR, STARVING_FOOD } from "./reflexes.js";

// The player's medulla: the body's automatic upkeep. What its vital signs are read from, and the
// graded urges that keep it breathing, fed enough to heal, and clear of what makes it sick.
// Every number is a first guess to tune in play.

/** One bot's upkeep. The list is what it is born knowing; each strength is 0 (off) to 1 (full). */
export interface MedullaSettings {
  /** The foods the bot is born knowing are bad for it. Anything else it has to learn by falling ill. */
  innateBadFoods: string[];
  /** The urge to breathe, before the hard limit (scales its urgency). */
  needAir: number;
  /** Eating enough for the body to heal itself (scales its urgency). */
  eatToHeal: number;
  /** Taking a cure when sick (scales its urgency). */
  cure: number;
  /** Eating when starving (scales its urgency). */
  starving: number;
  /** Learn which foods make it ill. */
  learnBadFoods: number;
  /** Share the vital signs as signals. */
  vitals: number;
}

export const DEFAULT_MEDULLA: MedullaSettings = { innateBadFoods: INNATE_BAD_FOODS, needAir: 1, eatToHeal: 1, cure: 1, starving: 1, learnBadFoods: 1, vitals: 1 };

const STRENGTHS = ["needAir", "eatToHeal", "cure", "starving", "learnBadFoods", "vitals"] as const;

/** What is wrong with the settings, or null if they are fine. */
export function medullaProblem(s: MedullaSettings): string | null {
  if (!Array.isArray(s.innateBadFoods) || s.innateBadFoods.some((name) => typeof name !== "string")) return "medulla.innateBadFoods must be a list of item names";
  for (const key of STRENGTHS) if (!(s[key] >= 0 && s[key] <= 1)) return `medulla.${key} must be 0 to 1, got ${s[key]}`;
  return null;
}

const MAX = { health: 20, air: 20, food: 20, saturation: 20 };
/** The food bar must be at least this full for health to come back by itself (checked on 1.21.11: it heals at 18, not at 17). */
export const HEALING_FOOD = 18;
/** The urge to breathe starts at this much air and is strongest just above the hard limit. */
const NEED_AIR = { from: 12, urgencyAtStart: 0.3, urgencyAtLimit: 0.9 };
const EAT_TO_HEAL = 0.5;
const CURE = 0.7;
const STARVING = 0.9;
/** Three game days without sleep is as tired as it gets. */
const TIRED_AFTER_MINUTES = 3 * 1440;

/** How sick each harmful effect makes the body, 0 to 1. Effects not listed do not make it sick. */
const SICKNESS: Record<string, number> = { poison: 1, wither: 1, hunger: 0.5, nausea: 0.4, blindness: 0.4, weakness: 0.3, mining_fatigue: 0.2, slowness: 0.2 };
/**
 * What cures what: the item, and the effects it clears.
 * HOOK(learn-cures): this small table is hand-written. A bot could learn it the way it learns bad
 * foods: an effect that ends just after it drinks something, twice.
 */
const CURES: Record<string, string[]> = { milk_bucket: ["poison", "wither", "hunger", "nausea", "blindness", "weakness", "mining_fatigue", "slowness"] };

/** Whether an effect is one that harms the body. */
export function isHarmful(effect: string): boolean {
  return effect in SICKNESS;
}

/** How sick the body is from its effects: the worst of them. */
export function sickOf(effects: readonly string[]): number {
  return Math.max(0, ...effects.map((effect) => SICKNESS[effect] ?? 0));
}

/** The body's readings, for the medulla's vital signs. */
export function playerVitals(state: State): Vitals | null {
  const self = minecraftDataOf(state)?.self;
  if (!self) return null;
  return {
    health: self.health / MAX.health,
    air: 1 - self.air / MAX.air,
    hunger: 1 - self.food / MAX.food,
    sick: sickOf(self.effects),
    cold: self.freezing,
    tired: Math.min(1, self.sinceSleepMinutes / TIRED_AFTER_MINUTES),
    reserve: Math.min(1, self.saturation / MAX.saturation),
    deaths: self.deaths,
  };
}

/** A soft rule that reads the Minecraft state; silent before the first state, and while a hard reflex's skill runs. */
function urge(name: string, check: (data: MinecraftStateData) => ReturnType<ReflexRule["check"]>): ReflexRule {
  return {
    name,
    kind: "soft",
    check(ws) {
      const data = minecraftDataOf(ws.state);
      if (!data || (data.current !== null && REFLEX_SKILLS.includes(data.current.skill))) return null;
      return check(data);
    },
  };
}

/**
 * The urge to breathe: under water with air at 12 or below, rising steadily from 0.3 at 12 to
 * 0.9 at 7. A goal can hold it back (diving on purpose); at 6 the hard `drowning` reflex takes over.
 */
export function needAir(strength: number): ReflexRule {
  return urge("need_air", ({ self }) => {
    if (!self.inWater || self.air > NEED_AIR.from || self.air <= LOW_AIR) return null;
    const along = (NEED_AIR.from - self.air) / (NEED_AIR.from - (LOW_AIR + 1));
    const base = NEED_AIR.urgencyAtStart + along * (NEED_AIR.urgencyAtLimit - NEED_AIR.urgencyAtStart);
    return { action: { skill: "surface" }, urgency: base * strength, reason: `air ${self.air}/20` };
  });
}

/** Hurt, with the food bar below the level the body needs to heal, and safe food to hand: eat up to that level. */
export function eatToHeal(strength: number): ReflexRule {
  return urge("eat_to_heal", (data) => {
    const { self } = data;
    if (self.health >= MAX.health || self.food >= HEALING_FOOD || self.foodItems === 0 || onIt(data)) return null;
    return { action: { skill: "eat", target: `level:${HEALING_FOOD}` }, urgency: EAT_TO_HEAL * strength, reason: `health ${self.health}/20 cannot heal at food ${self.food}/20` };
  });
}

/** Sick with something a carried cure clears: take it. */
export function cure(strength: number): ReflexRule {
  return urge("cure", ({ self }) => {
    for (const [item, clears] of Object.entries(CURES)) {
      const ill = self.effects.find((effect) => clears.includes(effect));
      if (ill && (self.inventory[item] ?? 0) > 0) return { action: { skill: "consume", target: `item:${item}` }, urgency: CURE * strength, reason: `${ill}, and carrying ${item}` };
    }
    return null;
  });
}

/**
 * Very hungry and carrying food: eat. With nothing else to hand it will eat food it knows to be
 * bad. It does not stop to eat with a threat on it. An urge, so it counts toward the body's
 * `urge` signal: a sleeping bot is woken by it before starving hurts.
 */
export function eatWhenStarving(strength: number): ReflexRule {
  return urge("eat_when_starving", (data) => {
    const { self } = data;
    if (self.food > STARVING_FOOD || (self.foodItems === 0 && self.badFoodItems === 0) || onIt(data)) return null;
    return { action: { skill: "eat" }, urgency: STARVING * strength, reason: `food ${self.food}/20${self.foodItems === 0 ? ", with only bad food to eat" : ""}` };
  });
}

/** The graded urges of upkeep this bot has switched on. */
export function medullaUrges(settings: MedullaSettings): ReflexRule[] {
  return [...(settings.needAir > 0 ? [needAir(settings.needAir)] : []), ...(settings.eatToHeal > 0 ? [eatToHeal(settings.eatToHeal)] : []), ...(settings.cure > 0 ? [cure(settings.cure)] : []), ...(settings.starving > 0 ? [eatWhenStarving(settings.starving)] : [])];
}

/** The names of every upkeep urge, for goals that hold one back. */
export const MEDULLA_URGES = ["need_air", "eat_to_heal", "cure", "eat_when_starving"];
