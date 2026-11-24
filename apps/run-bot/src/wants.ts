import type { Cue } from "@familiar/neuromodulators";

// What the bot wants in view right now, by kind of thing: dopamine works it out (its cues), and
// the colliculus reads it here to let a wanted kind draw the eye. Wanting is worked out once.

export interface WantsInView {
  /** Dopamine's cues for this tick. */
  set(cues: Cue[]): void;
  /** How much this kind of thing is wanted right now, 0 to 1 (0 if nothing of that kind is wanted). */
  of(kind: string): number;
}

export function createWantsInView(): WantsInView {
  let wants = new Map<string, number>();
  return {
    set(cues) {
      wants = new Map();
      for (const cue of cues) wants.set(cue.thing.kind, Math.min(1, Math.max(wants.get(cue.thing.kind) ?? 0, cue.want)));
    },
    of: (kind) => wants.get(kind) ?? 0,
  };
}
