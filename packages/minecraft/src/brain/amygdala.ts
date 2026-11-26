import type { Workspace } from "@familiar/contracts";
import type { Cue, Outcome } from "@familiar/region-amygdala";
import { createPlayerHits } from "../defence/threat-record.js";
import type { MinecraftStateData } from "../encode/state-data.js";
import { namedCauses } from "../pain.js";
import { minecraftDataOf, sightedOf } from "./read-state.js";
import { selfCaused } from "./startle.js";

// What the amygdala is offered from the game: the cues around, and what happens to the body.
// Add a kind of cue: write a reader and list it in CUE_READERS. Every number is a first guess.

export interface AmygdalaSenses {
  /** What the bot is born fearing: kinds of creature (or "game": whatever the game flags hostile), blocks and foods. */
  innateThreats: "game" | readonly string[];
  innateHurts: readonly string[];
  innateBadFoods: readonly string[];
  /** A player's name from a target id (the state does not carry it). Default: every player is "player". */
  nameOf?(id: string): string | null;
  /** The last thing eaten, and when. Default: nothing is known of meals. */
  meal?(): { food: string; at: number } | null;
  /** Signs happening now: events that have been found to lead to something. Default: none. */
  signs?(now: number): string[];
  /** How sick an effect makes the body, 0 to 1 (0: no harm). Default: no effect is an illness. */
  sickness?(effect: string): number;
  /** Whether a cue is already feared (a player who is, is no longer given the benefit of the doubt). Default: never. */
  feared?(key: string, now: number): boolean;
}

/** How much each kind of cue stands out. The thing attended to stands out most. */
const STANDS_OUT = { attended: 1, seen: 0.3, near: 0.3, touched: 0.15, hazard: 0.15, food: 0.8, area: 0.2, time: 0.1, sound: 0.6, sign: 0.5 };
/** What the bot is born believing of an inborn fear: a creature (as the threat record starts), a block, a food. */
export const BORN = { threat: 0.5, hurt: 0.8, badFood: 0.8 };
/** A meal is blamed for what follows for this long. */
const MEAL_LINGERS_MS = 60_000;
const NEAR_BLOCKS = 16;
/** A blow is felt for this long. */
const FELT_MS = 1000;
const NOT_A_BLOCK = new Set(["air", "cave_air", "void_air", ""]);
const FULL_HEALTH = 20;
/**
 * How large a hurt is felt to be, 0 to 1: the square root of the share of health lost. So a
 * small hurt is still plainly a hurt (1 health of 20 is felt as 0.22, 5 as 0.5, all 20 as 1),
 * and something that only ever pricks can still come to be known as harmful.
 */
export const feltSize = (lost: number) => Math.sqrt(Math.min(1, Math.max(0, lost) / FULL_HEALTH));
/** Hurts that come of the body's own state, not of anything around it: nothing around is to blame, so nothing is learned from them. */
const OWN_DOING = new Set(["fall", "fly_into_wall", "drown", "starve"]);
/** A need must drop this far in one tick to count as something good. */
const NEED_DROP = 0.1;
/** A meal this recent is what a need dropping came through. */
const JUST_ATE_MS = 4000;
/** Nothing good is read from the body for this long after a death (a new body starts fed). */
const AFTER_DEATH_MS = 5000;

/** The cue for a block, a food, and a kind of creature as the threat record names it ("zombie", "player:Ann"). */
export const CUE_OF = { block: (name: string) => `block:${name}`, food: (name: string) => `food:${name}`, kind: (kind: string) => `kind:${kind}`, area: (area: string) => `area:${area}`, sign: (label: string) => `sign:${label}` };

/** What the bot is born believing, for the amygdala to hold from the start (a "game" threat is only known when met). */
export function inbornFears(senses: Pick<AmygdalaSenses, "innateThreats" | "innateHurts" | "innateBadFoods">): Record<string, { harm: number }> {
  const of = (type: string, names: readonly string[], harm: number) => names.map((name) => [`${type}:${name}`, { harm }] as const);
  return Object.fromEntries([...of("kind", senses.innateThreats === "game" ? [] : senses.innateThreats, BORN.threat), ...of("block", senses.innateHurts, BORN.hurt), ...of("food", senses.innateBadFoods, BORN.badFood)]);
}

export const kindKey = (type: string, id: string, senses: Pick<AmygdalaSenses, "nameOf">) => (type === "player" ? `kind:player:${senses.nameOf?.(id) ?? "unknown"}` : `kind:${type}`);

/** The part of the day, in four bands. */
export function timeBand(time: MinecraftStateData["time"]): string {
  const tick = time.dayTick;
  if (tick === undefined) return time.isNight ? "night" : "day";
  return tick < 12_000 ? "day" : tick < 13_800 ? "dusk" : tick < 22_200 ? "night" : "dawn";
}

type Reader = (d: MinecraftStateData, ws: Workspace, senses: AmygdalaSenses) => Cue[];

/** The kind of each thing in view: creatures and players (the one attended to, or that just struck, most), and the useful blocks. */
const thingsSeen: Reader = (d, ws, senses) => {
  const creatures = [...d.nearby.mobs.map((m) => ({ ...m, innate: senses.innateThreats === "game" ? m.hostile : senses.innateThreats.includes(m.type) })), ...d.nearby.players.map((p) => ({ ...p, innate: false }))];
  // A creature that has just struck is felt, seen or not.
  const felt = (id: string) => d.self.lastHurt?.by === id && d.self.lastHurt.msAgo <= FELT_MS;
  return [
    ...creatures.filter((t) => sightedOf(t).seen || felt(t.id)).map((t) => ({
      key: kindKey(t.type, t.id, senses),
      salience: ws.attended?.id === t.id || felt(t.id) ? STANDS_OUT.attended : STANDS_OUT.seen + STANDS_OUT.near * Math.max(0, 1 - t.dist / NEAR_BLOCKS),
      ...(t.innate ? { born: { harm: BORN.threat } } : {}),
    })),
    ...d.nearby.blocks.filter((b) => sightedOf(b).seen).map((b) => ({ key: `kind:${b.type}`, salience: ws.attended?.id === b.id ? STANDS_OUT.attended : STANDS_OUT.seen })),
  ];
};

/**
 * The blocks the body touches, and the hazards close by. A block harms only by contact
 * (`direct`): it is blamed for a hurt only when the game names it, never for being underfoot
 * when something else hurt the bot (or the ground itself would come to be feared).
 */
const blocksTouched: Reader = (d, _ws, senses) => {
  const t = d.self.touching;
  const born = (name: string) => (senses.innateHurts.includes(name) ? { born: { harm: BORN.hurt } } : {});
  return [
    ...[t.feet, t.head, t.below, ...t.sides].filter((name) => !NOT_A_BLOCK.has(name)).map((name) => ({ key: `block:${name}`, salience: STANDS_OUT.touched, direct: true, ...born(name) })),
    // A hazard a few steps off: no harm from there says nothing about touching it.
    ...d.nearby.hazards.map((h) => ({ key: `block:${h.type}`, salience: STANDS_OUT.hazard, direct: true, apart: true, ...born(h.type) })),
  ];
};

/** The food just eaten: it stays around for a minute, and is blamed only for what comes through the gut. */
const foodEaten: Reader = (_d, ws, senses) => {
  const meal = senses.meal?.();
  if (!meal || ws.state.timestamp - meal.at > JUST_ATE_MS || ws.state.timestamp < meal.at) return [];
  return [{ key: `food:${meal.food}`, salience: STANDS_OUT.food, through: "gut", lingerMs: MEAL_LINGERS_MS, ...(senses.innateBadFoods.includes(meal.food) ? { born: { harm: BORN.badFood } } : {}) }];
};

const where: Reader = (_d, ws) => (ws.place ? [{ key: `area:${ws.place.area}`, salience: STANDS_OUT.area }] : []);
const when: Reader = (d) => [{ key: `time:${timeBand(d.time)}`, salience: STANDS_OUT.time }];
const sounds: Reader = (d) => d.nearby.heard.filter((h) => (h.msAgo ?? 0) <= 1000).map((h) => ({ key: `sound:${h.type}`, salience: STANDS_OUT.sound * h.loudness }));
const signs: Reader = (_d, ws, senses) => (senses.signs?.(ws.state.timestamp) ?? []).map((sign) => ({ key: `sign:${sign}`, salience: STANDS_OUT.sign }));

export const CUE_READERS: readonly Reader[] = [thingsSeen, blocksTouched, foodEaten, where, when, sounds, signs];

/** The cues around this tick, one per name (the most striking sighting of each). */
export function playerCues(senses: AmygdalaSenses): (ws: Workspace) => Cue[] {
  return (ws) => {
    const d = minecraftDataOf(ws.state);
    if (!d) return [];
    const best = new Map<string, Cue>();
    for (const cue of CUE_READERS.flatMap((read) => read(d, ws, senses))) if (cue.salience > (best.get(cue.key)?.salience ?? 0)) best.set(cue.key, cue);
    return [...best.values()];
  };
}

/**
 * What happened to the body since the last tick. Harm: health lost (as a share of full health),
 * an illness starting, death. Good: a need that is not about danger dropping. Not outcomes: a
 * hurt the bot caused itself (a fall, hunger, drowning, its own blast), and a first, possibly accidental, hit from another player.
 */
export function playerOutcomes(senses: AmygdalaSenses): (ws: Workspace) => Outcome[] {
  const hits = createPlayerHits();
  let was: { health: number; deaths: number; effects: Set<string>; needs: Map<string, number>; hurtAt: number } | null = null;
  let diedAt = -Infinity;
  /** Whether the last hit from a player counted. */
  let counted = true;
  return (ws) => {
    const d = minecraftDataOf(ws.state);
    if (!d) return [];
    const now = ws.state.timestamp;
    const before = was;
    const hurt = d.self.lastHurt;
    const hurtAt = hurt ? now - hurt.msAgo : -Infinity;
    const needs = new Map((ws.needs?.readings ?? []).filter((r) => r.rank <= 0).map((r) => [r.name, r.level]));
    was = { health: d.self.health, deaths: d.self.deaths, effects: new Set(d.self.effects), needs, hurtAt };
    if (!before) return [];
    const out: Outcome[] = [];

    const attacker = hurt?.by ? [...d.nearby.mobs, ...d.nearby.players].find((t) => t.id === hurt.by) : undefined;
    const by = attacker ? kindKey(attacker.type, attacker.id, senses) : null;
    const points = hurt && now - hurtAt <= 5000 ? (by ? [by] : hurt.by ? [] : namedCauses({ kind: hurt.kind, touching: d.self.touching }).map((name) => `block:${name}`)) : [];
    const died = d.self.deaths > before.deaths;
    const lost = before.health - d.self.health;
    // A hurt the bot brought on itself (a fall, going hungry, its own blast) is not the world's doing.
    const own = hurt !== null && hurt.by === null && now - hurtAt <= 5000 && (OWN_DOING.has(hurt.kind ?? "") || selfCaused(d, ws, hurt.at));
    if (died) diedAt = now;
    if (died && !own) {
      out.push({ sign: "harm", size: 1, final: true, what: `died${by ? ` to ${by.slice(5)}` : hurt?.kind ? ` (${hurt.kind})` : ""}`, points });
    } else if (lost > 0 && !died) {
      // One hit from a player may be an accident.
      if (by !== null && attacker?.type === "player" && Math.abs(hurtAt - before.hurtAt) > 50) counted = (senses.feared?.(by, now) ?? false) || hits.counts(by, now);
      const accident = by !== null && attacker?.type === "player" && !counted;
      if (!accident && !own) out.push({ sign: "harm", size: feltSize(lost), what: `lost ${Math.round(lost * 10) / 10} health${by ? ` to ${by.slice(5)}` : hurt?.kind ? ` (${hurt.kind})` : ""}`, points });
    }

    for (const effect of d.self.effects) {
      const sick = before.effects.has(effect) ? 0 : (senses.sickness?.(effect) ?? 0);
      if (sick > 0) out.push({ sign: "harm", size: sick * 0.5, what: `fell ill (${effect})`, through: "gut" });
    }

    if (now - diedAt > AFTER_DEATH_MS) {
      const meal = senses.meal?.();
      const ate = meal !== null && meal !== undefined && now - meal.at <= JUST_ATE_MS;
      for (const [name, level] of needs) {
        const drop = (before.needs.get(name) ?? level) - level;
        if (drop >= NEED_DROP) out.push({ sign: "good", size: Math.min(1, Math.round(drop * 1000) / 1000), what: `${name} eased by ${Math.round(drop * 100) / 100}`, ...(ate ? { through: "gut" } : {}) });
      }
    }
    return out;
  };
}
