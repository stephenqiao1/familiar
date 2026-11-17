// What the bot knows about how surfaces behave: which blocks fall when nothing holds them up
// (loose), which it slides on (slippery) and which hold it back (slow). One per bot. It is born
// knowing a few loose blocks and learns the rest from what happens to its own body. The balance
// sense and the posture check ask it; nothing here reads a file or the world.

/** How a surface behaves under the body. */
export type SurfaceKind = "loose" | "slippery" | "slow";

/** What the bot has learned so far: for each kind, block type → how many separate times it showed. */
export type SurfaceCounts = Record<SurfaceKind, Record<string, number>>;

export interface SurfacesOptions {
  /** The blocks the bot is born knowing are loose. */
  innateLoose: string[];
  /** What it has learned so far. */
  learned?: Partial<SurfaceCounts>;
  /** 0: learns nothing. Default: 1. */
  learn?: number;
}

/** What one observation came to. */
export interface SurfaceLesson {
  block: string;
  kind: SurfaceKind;
  /** How many separate times it has shown so far. */
  count: number;
  /** It has just become known. */
  learned: boolean;
}

export interface Surfaces {
  /** How a block type behaves, as far as the bot knows; null for ordinary ground. */
  kindOf(name: string): SurfaceKind | null;
  /** Notes that a block type behaved this way (it came down when dug under; the body slid on it; it held the body back). */
  saw(name: string, kind: SurfaceKind, now: number): SurfaceLesson | null;
  /** What has been learned since this was last asked. */
  justLearned(): SurfaceLesson[];
  /** What it has learned, for saving. */
  entries(): SurfaceCounts;
}

/** What a bot is born knowing is loose, unless its settings say otherwise. */
export const INNATE_LOOSE = [
  "sand", "red_sand", "gravel",
  ...["white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray", "light_gray", "cyan", "purple", "blue", "brown", "green", "red", "black"].map((c) => `${c}_concrete_powder`),
];

/** A block type is known once it has shown itself this many separate times. */
export const SIGHTINGS_TO_LEARN: Record<SurfaceKind, number> = { loose: 2, slippery: 3, slow: 3 };
/** Sightings closer together than this are one incident. */
const SAME_INCIDENT_MS = 2000;
const NEVER = new Set(["air", "cave_air", "void_air", "water", "lava"]);
const KINDS: SurfaceKind[] = ["loose", "slippery", "slow"];

export function createSurfaces(options: SurfacesOptions): Surfaces {
  const born = new Set(options.innateLoose);
  const learn = options.learn ?? 1;
  const counts = Object.fromEntries(KINDS.map((kind) => [kind, new Map(Object.entries(options.learned?.[kind] ?? {}))])) as Record<SurfaceKind, Map<string, number>>;
  const lastSeen = new Map<string, number>();
  let fresh: SurfaceLesson[] = [];
  const known = (name: string, kind: SurfaceKind) => (counts[kind].get(name) ?? 0) >= SIGHTINGS_TO_LEARN[kind];

  return {
    kindOf(name) {
      if (born.has(name)) return "loose";
      return KINDS.find((kind) => known(name, kind)) ?? null;
    },

    saw(name, kind, now) {
      if (learn <= 0 || NEVER.has(name) || (kind === "loose" && born.has(name)) || known(name, kind)) return null;
      const key = `${kind}:${name}`;
      if (now - (lastSeen.get(key) ?? -Infinity) < SAME_INCIDENT_MS) return null;
      lastSeen.set(key, now);
      const count = (counts[kind].get(name) ?? 0) + 1;
      counts[kind].set(name, count);
      const lesson = { block: name, kind, count, learned: known(name, kind) };
      if (lesson.learned) fresh.push(lesson);
      return lesson;
    },

    justLearned() {
      const out = fresh;
      fresh = [];
      return out;
    },

    entries: () => Object.fromEntries(KINDS.map((kind) => [kind, Object.fromEntries(counts[kind])])) as SurfaceCounts,
  };
}

const BORN_LOOSE = new Set(INNATE_LOOSE);
/** Each bot's own knowledge of surfaces, given by `setKnownSurfaces`. */
const known = new WeakMap<object, (name: string) => SurfaceKind | null>();

/** Tells the balance sense and the posture check what this bot knows about surfaces. */
export function setKnownSurfaces(bot: object, kindOf: (name: string) => SurfaceKind | null): void {
  known.set(bot, kindOf);
}

/** How a block behaves under the body, as far as this bot knows (a bot never told otherwise knows the innate loose blocks). */
export function surfaceKind(bot: object, name: string): SurfaceKind | null {
  const kindOf = known.get(bot);
  return kindOf ? kindOf(name) : BORN_LOOSE.has(name) ? "loose" : null;
}
