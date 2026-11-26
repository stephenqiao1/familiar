import { goodOf, harmOf, typeOf, type Association, type AssociationStore } from "./association.js";

// Spreading: a cue never met before starts from what similar cues predict. How alike two cues
// are is the game's side's to say, from physical facts; nothing here knows what a cue is.

/** A new cue starts with this share of a similar cue's value, times how alike they are. */
export const SPREAD = 0.5;

/**
 * The association a cue starts with: what it is born believing, or (if stronger) half of what
 * the most similar known cue of its type predicts, times how alike they are.
 */
export function startOf(key: string, born: { harm?: number; good?: number } | undefined, store: AssociationStore, alike: ((a: string, b: string) => number) | undefined, strength: number, now: number): Association {
  const start: Association = { harm: born?.harm ?? 0, good: born?.good ?? 0, sure: 1, at: now, ...(born ? { born: { harm: born.harm ?? 0, good: born.good ?? 0 } } : {}) };
  if (!alike || strength <= 0) return start;
  for (const other of store.keys()) {
    if (other === key || typeOf(other) !== typeOf(key)) continue;
    const a = store.get(other)!;
    const near = Math.min(1, Math.max(0, alike(key, other))) * SPREAD * strength;
    if (near <= 0) continue;
    const [harm, good] = [near * harmOf(a, null, now, 0), near * goodOf(a, now)];
    if (harm > start.harm) Object.assign(start, { harm, from: other });
    if (good > start.good) Object.assign(start, { good, from: start.from ?? other });
  }
  return start;
}
