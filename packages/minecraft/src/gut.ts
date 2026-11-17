// What the bot has learned about food: which foods make it sick. One per bot. It learns the way
// pain.ts learns which blocks hurt: from what happens to its own body.

export interface GutOptions {
  /** The foods the bot is born knowing are bad for it. */
  innate: string[];
  /** What it has learned so far: food → how many separate times an illness followed eating it. */
  learned?: Record<string, number>;
  /** 0: learns nothing. Default: 1. */
  learnBadFoods?: number;
}

/** What the gut made of an illness that started. */
export interface Lesson {
  /** The food it blames, if any. */
  blamed: string | null;
  /** The food has just become known to be bad. */
  learned: boolean;
  /** How many separate times illness has now followed this food. */
  count?: number;
  /** Why nothing was blamed or learned, when that is worth saying. */
  note?: string;
}

export interface Gut {
  /** Whether a food is known to be bad (innate or learned). */
  knowsBad(food: string): boolean;
  /** Notes that the bot is eating something: call it as the meal begins and again as it ends. */
  ate(food: string, now: number): void;
  /**
   * Notes that a harmful effect has just started. `fresh`: the body did not already have it.
   * `hostileNear`: something hostile was close enough to have caused it.
   */
  fellIll(effect: string, now: number, fresh: boolean, hostileNear: boolean): Lesson;
  /** Foods learned to be bad since this was last asked (for remembering them). */
  justLearned(): string[];
  /** What it has learned, for saving: food → count. */
  entries(): Record<string, number>;
}

/** A food is known bad once illness has followed eating it this many separate times. */
export const MEALS_TO_LEARN = 2;
/** The only food the bot has ever eaten needs one more: the evidence is thin when there is nothing to compare it with. */
const MEALS_IF_ONLY_FOOD = 3;
/** An illness is blamed on a meal that ended no longer ago than this. */
const BLAME_WITHIN_MS = 5000;
/** Illnesses closer together than this are one incident (one meal counts once). */
const SAME_INCIDENT_MS = 30_000;

export function createGut(options: GutOptions): Gut {
  const { innate, learnBadFoods = 1 } = options;
  const born = new Set(innate);
  const counts = new Map(Object.entries(options.learned ?? {}));
  const eaten = new Set<string>(counts.keys());
  const lastIncident = new Map<string, number>();
  let lastMeal: { food: string; at: number } | null = null;
  let fresh: string[] = [];
  const needed = (food: string) => (eaten.size <= 1 && eaten.has(food) ? MEALS_IF_ONLY_FOOD : MEALS_TO_LEARN);
  const learned = (food: string) => (counts.get(food) ?? 0) >= needed(food);

  return {
    knowsBad: (food) => born.has(food) || learned(food),

    ate(food, now) {
      eaten.add(food);
      lastMeal = { food, at: now };
    },

    fellIll(effect, now, isFresh, hostileNear) {
      const meal = lastMeal;
      if (!meal || now - meal.at > BLAME_WITHIN_MS) return { blamed: null, learned: false };
      // Only an illness that started just after the meal says anything about the food: not one the
      // body already had, and not one something hostile could have given it.
      if (!isFresh) return { blamed: null, learned: false, note: `already had ${effect} before eating ${meal.food}` };
      if (hostileNear) return { blamed: null, learned: false, note: `${effect} after eating ${meal.food}, but something hostile was near: not blamed on the food` };
      const food = meal.food;
      if (learnBadFoods <= 0 || born.has(food) || learned(food)) return { blamed: food, learned: false };
      if (now - (lastIncident.get(food) ?? -Infinity) < SAME_INCIDENT_MS) return { blamed: food, learned: false };
      lastIncident.set(food, now);
      const before = counts.get(food) ?? 0;
      counts.set(food, before + 1);
      if (learned(food)) {
        fresh.push(food);
        return { blamed: food, learned: true, count: before + 1 };
      }
      const waiting = before + 1 >= MEALS_TO_LEARN ? `${food} made it ill ${before + 1} times, but it is the only food it has ever eaten: waiting for one more before calling it bad` : undefined;
      return { blamed: food, learned: false, count: before + 1, ...(waiting ? { note: waiting } : {}) };
    },

    justLearned() {
      const out = fresh;
      fresh = [];
      return out;
    },

    entries: () => Object.fromEntries(counts),
  };
}
