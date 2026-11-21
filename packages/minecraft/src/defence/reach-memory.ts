// Remembering where a threat could not (or could) get to the bot. A route answer is about two
// places: where the creature stood and where the bot stood. Kept by place, not by creature, so
// the same husk in the same pit, or another one that falls into it, is known at first sight
// the next time, with no wait for the route check and no flinch at a guess.

type Spot = { x: number; y: number; z: number };
interface Known {
  them: Spot;
  me: Spot;
  canReach: boolean;
}

/** An answer holds for a creature and a bot each within this many blocks of where they were. */
const SAME_PLACE = 2;
/** The most answers kept: the oldest goes first. */
const MOST = 64;

const near = (a: Spot, b: Spot) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) <= SAME_PLACE;

export interface ReachMemory {
  /** Keeps a route check's answer for these two places (replacing what was known of them). */
  note(them: Spot, me: Spot, canReach: boolean): void;
  /** What was found for a creature there and the bot here, or null if nothing is known. */
  recall(them: Spot, me: Spot): boolean | null;
}

export function createReachMemory(): ReachMemory {
  let known: Known[] = [];
  const same = (k: Known, them: Spot, me: Spot) => near(k.them, them) && near(k.me, me);
  return {
    note(them, me, canReach) {
      known = [...known.filter((k) => !same(k, them, me)), { them: { ...them }, me: { ...me }, canReach }].slice(-MOST);
    },
    recall: (them, me) => [...known].reverse().find((k) => same(k, them, me))?.canReach ?? null,
  };
}
