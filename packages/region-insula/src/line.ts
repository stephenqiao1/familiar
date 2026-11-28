import type { Feeling } from "@familiar/contracts";

// The feeling in a few words, for the deciding layers. It only restates what `ws.feeling` holds.

/** A strength as a word of degree: under 0.45 "a little", from 0.7 "very". */
export function degree(strength: number, word: string): string {
  return strength >= 0.7 ? `very ${word}` : strength < 0.45 ? `a little ${word}` : word;
}

/** Mood this far from even is said. */
export const MOOD_SAID = 0.3;
/** What is said with nothing felt. */
export const AT_EASE = "at ease";

/** "very hungry, a little hurting, uneasy, in low spirits"; "at ease" with nothing to say. */
export function feelingLine(feeling: Pick<Feeling, "feelings" | "mood" | "uneasy">): string {
  const parts = feeling.feelings.map((f) => degree(f.strength, f.word));
  if (feeling.uneasy.level >= 0.25) parts.push(degree(feeling.uneasy.level, "uneasy"));
  const body = parts.length ? parts : [AT_EASE];
  const mood = feeling.mood <= -MOOD_SAID ? ["in low spirits"] : feeling.mood >= MOOD_SAID ? ["in good spirits"] : [];
  return [...body, ...mood].join(", ");
}
