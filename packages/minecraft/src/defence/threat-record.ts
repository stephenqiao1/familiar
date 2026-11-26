import type { DefenceSettings } from "./settings.js";

// What the bot has learned about each kind of threat from what happened to it. Kept by kind
// (a mob's name, or "player:<name>"), saved in data/<bot>/threats.json. No game objects here.
// Change how danger is learned here. Every number is a first guess.

/** One kind's history. */
export interface ThreatCounts {
  /** Encounters (one per creature met). */
  seen: number;
  /** Times it hurt the bot, and the health lost in all. */
  hurts: number;
  damage: number;
  /** Times the bot killed one, and died to one. */
  kills: number;
  deaths: number;
  /** Encounters that cost half the bot's health or more without the bot winning. */
  badLosses: number;
  /** Times it hurt the bot from beyond arm's reach. */
  rangedHurts: number;
  /** How dangerous it has been, 0 to 1. */
  danger: number;
  /** Learned to be a threat although the game does not flag it hostile. */
  threat?: boolean;
}

export type ThreatEntries = Record<string, ThreatCounts>;

/** A kind never met gets this danger. */
export const MIDDLING = 0.5;
/** Danger never falls below this by harmless encounters; a learned threat that falls to it is forgotten. */
const FLOOR = 0.1;
/** A harmless encounter moves danger this share of the way down to the floor. */
const CALMING = 0.05;
/** Losing all health at once moves danger this share of the way up to 1; a death always does. */
const HARM_STEP = 0.5;
const FULL_HEALTH = 20;
/** Hurt from beyond this many blocks is from beyond arm's reach; twice, and the kind shoots. */
export const ARMS_REACH = 4.5;
const SHOOTS_AFTER = 2;
/** An encounter that cost this much health without a kill is a bad loss. */
const BAD_LOSS = FULL_HEALTH / 2;
/** A player becomes a threat on a second hit at least this long after the first, within this long. */
const PLAYER_HITS = { apartMs: 2000, withinMs: 60_000 };
/** A kind born never-to-fight starts this far behind; any other starts one ahead. */
const PRIOR = { neverFight: -2, other: 1 };
/** Crossing this danger is worth saying. */
const DANGEROUS = 0.7;

export interface ThreatRecord {
  /** Whether this kind is a threat for this bot (innate, or learned). `gameHostile`: the game flags it hostile. */
  isThreat(kind: string, gameHostile: boolean): boolean;
  danger(kind: string): number;
  beatable(kind: string): boolean;
  /** Hits from afar: it counts as able to reach whenever it has a clear line. */
  shoots(kind: string): boolean;
  /** A creature of this kind was met. */
  met(kind: string): void;
  /** It hurt the bot: by how much, from how far, and whether the game flags it hostile. */
  hurtBy(kind: string, amount: number, distance: number, gameHostile: boolean, now: number): void;
  killed(kind: string): void;
  diedTo(kind: string): void;
  /** An encounter ended: the health it cost, and whether the bot killed the creature. */
  parted(kind: string, damage: number, won: boolean): void;
  /** Changes of mind since last asked ("skeleton was found to shoot"). */
  justLearned(): string[];
  /** For saving. */
  entries(): ThreatEntries;
}

export const isPlayer = (kind: string) => kind.startsWith("player:");

/** Something predicting this much harm (as the amygdala has learned) is known to bring harm: a kind is a threat, a block hurts, a food is bad. */
export const KNOWN_HARM = 0.12;

/** Whether the bot is born treating this kind as a threat. `gameHostile`: the game flags it hostile. */
export const bornThreat = (settings: Pick<DefenceSettings, "innateThreats">, kind: string, gameHostile: boolean) => (settings.innateThreats === "game" ? gameHostile : settings.innateThreats.includes(kind));

/**
 * The two-hit rule: one hit from another player may be an accident, so only a second, a little
 * later, counts at all. `counts` notes a hit and says whether it counts.
 */
export function createPlayerHits(): { counts(kind: string, now: number): boolean } {
  const firstHit = new Map<string, number>();
  return {
    counts(kind, now) {
      const first = firstHit.get(kind);
      if (first !== undefined && now - first <= PLAYER_HITS.withinMs) return now - first >= PLAYER_HITS.apartMs;
      firstHit.set(kind, now);
      return false;
    },
  };
}
const fresh = (): ThreatCounts => ({ seen: 0, hurts: 0, damage: 0, kills: 0, deaths: 0, badLosses: 0, rangedHurts: 0, danger: MIDDLING });

/** `settings.learnThreats` 0: nothing is recorded, and every kind keeps its innate standing. */
export function createThreatRecord(settings: Pick<DefenceSettings, "innateThreats" | "innateNeverFight" | "learnThreats">, saved: ThreatEntries = {}): ThreatRecord {
  const kinds = new Map<string, ThreatCounts>(Object.entries(saved).map(([kind, c]) => [kind, { ...fresh(), ...c }]));
  const learns = settings.learnThreats > 0;
  const notes: string[] = [];
  const hits = createPlayerHits();
  const of = (kind: string) => kinds.get(kind) ?? fresh();
  const innate = (kind: string, gameHostile: boolean) => bornThreat(settings, kind, gameHostile);
  const score = (c: ThreatCounts, kind: string) => c.kills - c.deaths - c.badLosses + (settings.innateNeverFight.includes(kind) ? PRIOR.neverFight : PRIOR.other);
  const shoots = (c: ThreatCounts) => c.rangedHurts >= SHOOTS_AFTER;

  /** Applies a change, and notes each change of mind it causes. */
  function change(kind: string, apply: (c: ThreatCounts) => void): void {
    if (!learns) return;
    const c = kinds.get(kind) ?? fresh();
    const was = { dangerous: c.danger >= DANGEROUS, beatable: score(c, kind) > 0, shoots: shoots(c), threat: c.threat ?? false };
    apply(c);
    c.danger = Math.min(1, Math.max(0, c.danger));
    kinds.set(kind, c);
    if (!was.dangerous && c.danger >= DANGEROUS) notes.push(`${kind} became dangerous (${c.danger.toFixed(2)})`);
    if (was.dangerous && c.danger < DANGEROUS) notes.push(`${kind} is no longer so dangerous (${c.danger.toFixed(2)})`);
    if (was.beatable !== score(c, kind) > 0) notes.push(score(c, kind) > 0 ? `${kind} became beatable (${c.kills} kills, ${c.deaths + c.badLosses} losses)` : `${kind} is no longer beatable (${c.kills} kills, ${c.deaths + c.badLosses} losses)`);
    if (!was.shoots && shoots(c)) notes.push(`${kind} was found to shoot (hurt from afar ${c.rangedHurts} times)`);
    if (!was.threat && c.threat) notes.push(`${kind} became a threat (it hurt the bot)`);
    if (was.threat && !c.threat) notes.push(`${kind} is no longer a threat (harmless too often)`);
  }

  return {
    isThreat: (kind, gameHostile) => innate(kind, gameHostile) || (of(kind).threat ?? false),
    danger: (kind) => of(kind).danger,
    beatable: (kind) => score(of(kind), kind) > 0,
    shoots: (kind) => shoots(of(kind)),
    met: (kind) => change(kind, (c) => void c.seen++),
    hurtBy(kind, amount, distance, gameHostile, now) {
      // One hit from another player may be an accident: only a second, a little later, counts at all.
      if (isPlayer(kind) && !of(kind).threat && !hits.counts(kind, now)) return;
      change(kind, (c) => {
        c.hurts++;
        c.damage += amount;
        if (distance > ARMS_REACH) c.rangedHurts++;
        c.danger += (1 - c.danger) * HARM_STEP * Math.min(1, amount / FULL_HEALTH);
        if (!innate(kind, gameHostile)) c.threat = true;
      });
    },
    killed: (kind) => change(kind, (c) => void c.kills++),
    diedTo: (kind) =>
      change(kind, (c) => {
        c.deaths++;
        c.danger += (1 - c.danger) * HARM_STEP;
      }),
    parted(kind, damage, won) {
      change(kind, (c) => {
        if (damage >= BAD_LOSS && !won) c.badLosses++;
        if (damage > 0) return;
        c.danger -= (c.danger - FLOOR) * CALMING;
        // A learned threat that has been harmless long enough is let go.
        if (c.threat && c.danger <= FLOOR + 0.05) c.threat = false;
      });
    },
    justLearned: () => notes.splice(0),
    entries: () => Object.fromEntries(kinds),
  };
}
