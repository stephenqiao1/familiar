import type { MemoryStore } from "@familiar/memory";
import { BORN_FEARING, createAlike, createShadow, CUE_OF, inbornFears, kindKey, KNOWN_HARM, playerCues, playerOutcomes, sicknessOf, type AmygdalaSenses, type Gut, type KindFacts, type Pain, type ThreatRecord, type ThreatSenseOptions } from "@familiar/minecraft";
import { DEFAULT_AMYGDALA, harmOf, startOf, type AmygdalaOptions, type AmygdalaSettings, type AssociationStore } from "@familiar/region-amygdala";

// Puts the amygdala together for a Minecraft bot: the cues and outcomes from the game, how alike
// two kinds are, the comparison with the older learning rules, and what each reader is handed.

/** The part of the bot this reads: who a creature is, and the game's facts about each kind. */
export interface AmygdalaBody {
  entities: Record<string, { username?: string | undefined } | undefined>;
  registry: {
    entitiesByName: Record<string, { height?: number | null; width?: number | null; type?: string; category?: string } | undefined>;
    foodsByName: Record<string, unknown>;
  };
}

export interface AmygdalaParts {
  bot: AmygdalaBody;
  store: AssociationStore;
  /** What the bot is born fearing (from bots.json: the defence's, the reflexes' and the medulla's lists). */
  innateThreats: "game" | readonly string[];
  innateHurts: readonly string[];
  innateBadFoods: readonly string[];
  gut: Pick<Gut, "lastMeal" | "knowsBad">;
  pain: Pick<Pain, "knows">;
  threats: Pick<ThreatRecord, "isThreat" | "danger" | "shoots">;
  memory: Pick<MemoryStore, "signs">;
  /** The game flags this kind hostile. */
  hostile(kind: string): boolean;
  /** The area the bot is in, as the hippocampus last said. Default: not known. */
  area?(): string | null;
  /** Blocks never taken to hurt, whatever was learned (the base's own). Default: none. */
  neverHurts?(block: string): boolean;
  settings?: AmygdalaSettings;
}

/** What the amygdala's readers outside the brain's own list are handed. */
export interface PlayerAmygdala {
  options: AmygdalaOptions;
  /** Whether a block is known to hurt, and a food to be bad: the amygdala's word, or the old rule's with that reader at 0. */
  knowsHurt(block: string): boolean;
  knowsBadFood(food: string): boolean;
  /** For the threat sense: a kind's harm, and what is feared with nothing in view. */
  fear: NonNullable<ThreatSenseOptions["fear"]>;
  dread?: NonNullable<ThreatSenseOptions["dread"]>;
  /** How feared a thing in the state is, 0 to 1, for the thalamus (already scaled by that reader's strength). */
  fearOfThing(kind: string, id: string): number;
}

/** A cue predicting this much harm is one the amygdala fears. */
export const FEARED = 0.3;

export function playerAmygdala(parts: AmygdalaParts): PlayerAmygdala {
  const { bot, store, settings = DEFAULT_AMYGDALA } = parts;
  const { readers } = settings;
  const harm = (cue: string, area: string | null, now: number) => harmOf(store.get(cue), area, now, settings.safeHere);
  const inborn = inbornFears(parts);
  const alike = createAlike((kind) => factsOf(kind));
  /** What a cue is born with: listed, or a kind the game flags hostile for a bot that trusts the game. */
  const bornOf = (cue: string) => inborn[cue] ?? (parts.innateThreats === "game" && cue.startsWith("kind:") && parts.hostile(cue.slice(5)) ? { harm: BORN_FEARING.threat } : undefined);
  /**
   * The harm a cue predicts where the bot now is, 0 to 1. A cue the amygdala has not met yet is
   * rated as it would begin: by what it is born with, or by what the most similar known cue predicts.
   */
  const here = (cue: string, now = Date.now()) => {
    const known = store.get(cue);
    return Math.min(1, Math.max(0, known ? harm(cue, parts.area?.() ?? null, now) : startOf(cue, bornOf(cue), store, alike, settings.spread, now).harm));
  };
  const senses: AmygdalaSenses = {
    innateThreats: parts.innateThreats,
    innateHurts: parts.innateHurts,
    innateBadFoods: parts.innateBadFoods,
    nameOf: (id) => bot.entities[id.replace("entity:", "")]?.username ?? null,
    meal: () => parts.gut.lastMeal(),
    signs: (now) => parts.memory.signs(now),
    sickness: sicknessOf,
    feared: (cue, now) => harm(cue, null, now) >= FEARED,
  };
  const factsOf = (kind: string): KindFacts | null => {
    const e = bot.registry.entitiesByName[kind];
    return e ? { height: e.height ?? 1, width: e.width ?? 1, hostile: parts.hostile(kind), moves: e.category ?? e.type ?? "", shoots: parts.threats.shoots(kind) } : null;
  };
  const old = { isThreat: parts.threats.isThreat, danger: parts.threats.danger, knowsHurt: parts.pain.knows, knowsBadFood: parts.gut.knowsBad, isFood: (item: string) => bot.registry.foodsByName[item] !== undefined };
  /** The cue for the thing attended to: its kind, or (a sound with no body) the sound. */
  const cueOf: AmygdalaOptions["cueOf"] = (thing) => [kindKey(thing.kind, thing.id, senses), `sound:${thing.kind}`].find((cue) => store.get(cue)) ?? null;
  /** What is feared with nothing in view: the place itself, or a sign of harm to come. */
  const dread = (now: number) => {
    const area = parts.area?.() ?? null;
    const around: [string, string][] = [...(area === null ? [] : [[CUE_OF.area(area), "a place it has come to fear"] as [string, string]]), ...parts.memory.signs(now).map((sign): [string, string] => [CUE_OF.sign(sign), `a sign of harm (${sign})`])];
    const [worst] = around.map(([cue, words]) => ({ words, harm: here(cue, now) })).sort((a, b) => b.harm - a.harm);
    return worst && readers.wary * worst.harm >= KNOWN_HARM ? worst.words : null;
  };
  return {
    options: { store, settings, born: inborn, cues: playerCues(senses), outcomes: playerOutcomes(senses), alike, cueOf, shadow: createShadow(old, harm, senses) },
    // The inborn hurts stay fixed here: the hard reflexes (about to touch, falling right) are built on this same check, and they never read the amygdala.
    knowsHurt: (block) => (readers.blocks > 0 ? parts.innateHurts.includes(block) || (!parts.neverHurts?.(block) && readers.blocks * here(CUE_OF.block(block)) >= KNOWN_HARM) : parts.pain.knows(block)),
    knowsBadFood: (food) => (readers.foods > 0 ? readers.foods * here(CUE_OF.food(food)) >= KNOWN_HARM : parts.gut.knowsBad(food)),
    fear: { harmOf: (kind, now) => here(CUE_OF.kind(kind), now), strength: readers.defence },
    ...(readers.wary > 0 ? { dread } : {}),
    fearOfThing: (kind, id) => readers.thalamus * here(kindKey(kind, id, senses)),
  };
}
