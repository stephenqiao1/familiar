// How alike two kinds of creature are, from physical facts alone: size, how it moves, whether it
// shoots, and whether the game flags it hostile. No list of families: a creature never met
// before is like another only as far as these facts agree.

export interface KindFacts {
  /** In blocks. */
  height: number;
  width: number;
  /** The game flags it hostile. */
  hostile: boolean;
  /** How it gets about, in the game's own word for its sort ("animal", "water_creature", "ambient"). */
  moves: string;
  /** It has been found to hurt from afar. */
  shoots: boolean;
}

/** A fact that differs leaves this much of the likeness. */
const DIFFERS = { hostile: 0.3, moves: 0.6, shoots: 0.7 };

const closeness = (a: number, b: number) => (Math.max(a, b) <= 0 ? 1 : Math.min(a, b) / Math.max(a, b));

/** 0 (nothing alike) to 1 (the same in every fact). */
export function alikeKinds(a: KindFacts, b: KindFacts): number {
  const size = (closeness(a.height, b.height) + closeness(a.width, b.width)) / 2;
  return size * (a.hostile === b.hostile ? 1 : DIFFERS.hostile) * (a.moves === b.moves ? 1 : DIFFERS.moves) * (a.shoots === b.shoots ? 1 : DIFFERS.shoots);
}

/**
 * How alike two cues are, for the amygdala's spreading. Only kinds of creature can be compared
 * so far (`factsOf` gives a kind's facts, or null if it has none: a player, a block).
 * To compare another type of cue, add its facts here.
 */
export function createAlike(factsOf: (kind: string) => KindFacts | null): (a: string, b: string) => number {
  return (a, b) => {
    if (!a.startsWith("kind:") || !b.startsWith("kind:")) return 0;
    const [x, y] = [factsOf(a.slice(5)), factsOf(b.slice(5))];
    return x && y ? alikeKinds(x, y) : 0;
  };
}
