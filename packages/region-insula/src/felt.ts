import type { Felt } from "@familiar/contracts";

// The list of feelings. A feeling appears once its reading passes a low level and goes only
// when the reading has fallen well below it, so the list does not flicker on a reading that hovers.

/** A reading at or above this is felt. */
export const FELT_AT = 0.25;
/** Once felt, it stays until the reading is under this. */
export const GONE_UNDER = 0.15;

/** One of the body's readings as the game's side gives it: the word for the feeling, how strong the reading is (0 to 1), and where it comes from. */
export interface Reading {
  word: string;
  level: number;
  from: string;
}

/** Keeps which feelings are present from tick to tick. */
export function createFelt(): (readings: readonly Reading[]) => Felt[] {
  const present = new Set<string>();
  return (readings) => {
    const felt: Felt[] = [];
    for (const { word, level, from } of readings) {
      if (level >= FELT_AT || (present.has(word) && level >= GONE_UNDER)) {
        present.add(word);
        felt.push({ word, strength: Math.min(1, Math.max(0, level)), from });
      } else present.delete(word);
    }
    return felt.sort((a, b) => b.strength - a.strength);
  };
}

/**
 * How good the body's state is overall, 0 to 1: pulled down mostly by the strongest feeling, and
 * a little by each of the others.
 */
export function comfortOf(felt: readonly Pick<Felt, "strength">[]): number {
  const [worst = 0, ...rest] = felt.map((f) => f.strength).sort((a, b) => b - a);
  return Math.min(1, Math.max(0, 1 - worst - 0.25 * rest.reduce((sum, s) => sum + s, 0)));
}
