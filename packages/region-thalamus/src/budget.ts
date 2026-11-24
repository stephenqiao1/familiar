// The budget: how many characters of JSON a reader's view may take, and how it is shared out.
// Arousal sets the size; focus sets the shape.

/** Below `drowsy` the limit is `drowsyShare` of the usual; it is whole from `awake` up. Above `frazzled` only the top few items get any form. */
export const AROUSAL = { drowsy: 0.3, awake: 0.5, drowsyShare: 1 / 3, frazzled: 0.9, frazzledTop: 3 };

/** The limit in force for this arousal. `strength` 0: arousal does not matter. */
export function limitFor(limit: number, arousal: number, strength: number): number {
  const share = arousal >= AROUSAL.awake ? 1 : arousal <= AROUSAL.drowsy ? AROUSAL.drowsyShare : AROUSAL.drowsyShare + ((1 - AROUSAL.drowsyShare) * (arousal - AROUSAL.drowsy)) / (AROUSAL.awake - AROUSAL.drowsy);
  return Math.round(limit * (1 - strength * (1 - share)));
}

/** How many items may get any form at all: the top few when over-aroused, else no cap. */
export function mostItems(arousal: number, strength: number): number {
  return strength > 0 && arousal > AROUSAL.frazzled ? AROUSAL.frazzledTop : Infinity;
}

/**
 * The share of the room that may go to full forms; the rest is for brief ones. High focus: few
 * things, in full, the rest counted. Low focus: many things, mostly brief. `strength` 0: no
 * shape (full while there is room, then brief).
 */
export function fullShare(focus: number, strength: number): number {
  return strength > 0 ? Math.min(1, Math.max(0, 0.5 + strength * (focus - 0.5))) : 1;
}
