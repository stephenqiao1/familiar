// What the bot has learned hurts, and how sore it is. One per bot. The reflexes and the safety
// checks read it; the `withdraw` skill tells it about each withdrawal.

/** The moment of a hurt, as the body felt it. */
export interface Hurt {
  /** When, in ms. */
  at: number;
  /** The attacker (a target id), or null if there was none. */
  by: string | null;
  /** The game's own name for the damage ("cactus", "hot_floor", "fall"), or null if it did not say. */
  kind: string | null;
  /** The whole-block position where it happened. */
  where: { x: number; y: number; z: number };
  /** The blocks the body was touching: at the feet, at the head, under the feet and on the four sides. */
  touching: Touching;
}

export interface Touching {
  feet: string;
  head: string;
  below: string;
  sides: string[];
}

export interface PainOptions {
  /** What the bot is born knowing hurts. */
  innate: string[];
  /** What it has learned so far: block type → how many separate times it hurt. */
  learned?: Record<string, number>;
  /** Block types never learned as harmful, whatever the evidence (the base's own blocks). Air and water never are. */
  neverLearn?(name: string): boolean;
  /** 0: learns nothing. Default: 1. */
  learnHurts?: number;
  /** 0: never sore. Default: 1. */
  sensitise?: number;
}

/** What a withdrawal made of the hurt behind it. */
export interface Withdrawal {
  /** The block types it blames. */
  causes: string[];
  /** Block types that have just become known to hurt. */
  learned: string[];
  /** Block types the evidence pointed at that are never learned. */
  refused: string[];
  /** How far to pull away: 2 blocks, then 4, then 6 if hurt again at the same place. */
  radius: number;
}

export interface Pain {
  /** Whether a block type is known to hurt (innate or learned). */
  knows(name: string): boolean;
  /** Notes a withdrawal from a hurt: blames a cause, learns from it, and starts the soreness. */
  withdrew(hurt: Hurt, now: number): Withdrawal;
  /** How sore: 1 just after a withdrawal, fading to 0 over 30 seconds. */
  sore(now: number): number;
  /** Block types learned since this was last asked (for remembering them). */
  justLearned(): string[];
  /** What it has learned, for saving: block type → count. */
  entries(): Record<string, number>;
}

/** A block type is known to hurt once it has hurt this many separate times. */
export const INCIDENTS_TO_LEARN = 2;
/** Hurts closer together than this are one incident. */
const SAME_INCIDENT_MS = 2000;
const SORE_MS = 30_000;
const RADII = [2, 4, 6];
/** A hurt this soon after the last withdrawal, this close to it, means the withdrawal was not far enough. */
const AGAIN = { ms: 10_000, blocks: 3 };
const NEVER = new Set(["air", "cave_air", "void_air", "water"]);
/** Kinds of damage that name where the harm is, instead of the block itself. */
const KIND_POINTS_AT: Record<string, (t: Touching) => string[]> = { hot_floor: (t) => [t.below] };

/** The blocks being touched, each once. */
const touched = (t: Touching) => [...new Set([t.feet, t.head, t.below, ...t.sides])];

/** The block types the hurt itself points at: the block the game names, if it is one of those being touched. None if it names none. */
export function namedCauses(hurt: Pick<Hurt, "kind" | "touching">): string[] {
  const kind = hurt.kind ?? "";
  if (touched(hurt.touching).includes(kind)) return [kind];
  return KIND_POINTS_AT[kind]?.(hurt.touching) ?? [];
}

/**
 * Works out which block types a hurt was probably caused by: the block the game names if it
 * names one of those being touched, else every block being touched.
 */
export function likelyCauses(hurt: Pick<Hurt, "kind" | "touching">): string[] {
  const named = namedCauses(hurt);
  return named.length ? named : touched(hurt.touching);
}

export function createPain(options: PainOptions): Pain {
  const { innate, neverLearn = () => false, learnHurts = 1, sensitise = 1 } = options;
  const born = new Set(innate);
  const counts = new Map(Object.entries(options.learned ?? {}));
  const lastIncident = new Map<string, number>();
  let fresh: string[] = [];
  let soreSince = -Infinity;
  let last: { where: Hurt["where"]; at: number; step: number } | null = null;
  const learned = (name: string) => (counts.get(name) ?? 0) >= INCIDENTS_TO_LEARN;

  return {
    knows: (name) => born.has(name) || learned(name),

    withdrew(hurt, now) {
      const repeat = last !== null && now - last.at <= AGAIN.ms && Math.hypot(hurt.where.x - last.where.x, hurt.where.y - last.where.y, hurt.where.z - last.where.z) <= AGAIN.blocks;
      const step = repeat ? Math.min(RADII.length - 1, last!.step + 1) : 0;
      last = { where: hurt.where, at: now, step };
      if (sensitise > 0) soreSince = now;

      const result: Withdrawal = { causes: [], learned: [], refused: [], radius: RADII[step]! };
      // Only damage with no attacker teaches anything: a zombie's blow says nothing about the ground.
      if (hurt.by !== null) return result;
      for (const name of likelyCauses(hurt)) {
        if (NEVER.has(name) || neverLearn(name)) {
          if (!NEVER.has(name)) result.refused.push(name);
          continue;
        }
        result.causes.push(name);
        if (learnHurts <= 0 || born.has(name) || learned(name)) continue;
        // One burst of damage is one incident.
        if (now - (lastIncident.get(name) ?? -Infinity) < SAME_INCIDENT_MS) continue;
        lastIncident.set(name, now);
        counts.set(name, (counts.get(name) ?? 0) + 1);
        if (learned(name)) {
          result.learned.push(name);
          fresh.push(name);
        }
      }
      return result;
    },

    sore: (now) => Math.min(1, Math.max(0, 1 - (now - soreSince) / SORE_MS)),

    justLearned() {
      const out = fresh;
      fresh = [];
      return out;
    },

    entries: () => Object.fromEntries(counts),
  };
}
