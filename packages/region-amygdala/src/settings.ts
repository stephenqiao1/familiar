/** How far each reader takes its number from the amygdala, 0 to 1. At 0 the reader uses what it used before. */
export interface AmygdalaReaders {
  /** The defence circuit: a kind's danger, and which kinds are threats. 0: the threat record. */
  defence: number;
  /** A feared place or sign with nothing in view makes danger "possible". 0: the bad memory near. */
  wary: number;
  /** Noradrenaline: fear raises alarm. 0: it does not. */
  alarm: number;
  /** The hippocampus: a fresh memory is stamped by how much the moment matters. 0: by alarm alone. */
  memory: number;
  /** The thalamus: a feared thing is passed on in full. 0: fear does not count. */
  thalamus: number;
  /** The hypothalamus: lasting fear counts toward stress. 0: it does not. */
  stress: number;
  /** Acetylcholine: what promises good draws focus. 0: it does not. */
  focus: number;
  /** Which blocks are known to hurt. 0: hurts.json. */
  blocks: number;
  /** Which foods are known to be bad. 0: bad-foods.json. */
  foods: number;
}

/** The strength of each part of the amygdala's learning, 0 to 1 (from bots.json). At 0 the part is off. */
export interface AmygdalaSettings {
  /** How fast associations move. 0: nothing is learned. */
  learn: number;
  /** How far cues share one surprise (what was already predicted is not learned again). 0: each cue learns from the outcome on its own. */
  surprise: number;
  /** How far harm is unlearned by place ("safe here"). 0: a fear is never let go. */
  safeHere: number;
  /** How far a new cue starts from what similar cues predict. 0: every cue starts from nothing. */
  spread: number;
  /** How far signs (what an event has been found to lead to) count as cues. 0: they are not offered. */
  signs: number;
  readers: AmygdalaReaders;
}

const ALL = (value: number): AmygdalaReaders => ({ defence: value, wary: value, alarm: value, memory: value, thalamus: value, stress: value, focus: value, blocks: value, foods: value });
/** Every reader on its old source: the amygdala only watches. */
export const NO_READERS = ALL(0);
export const DEFAULT_AMYGDALA: AmygdalaSettings = { learn: 1, surprise: 1, safeHere: 1, spread: 1, signs: 1, readers: ALL(1) };

/** What is wrong with an `amygdala` block, or null. */
export function amygdalaProblem(s: AmygdalaSettings): string | null {
  const bad = (v: unknown) => typeof v !== "number" || !(v >= 0 && v <= 1);
  for (const key of ["learn", "surprise", "safeHere", "spread", "signs"] as const) if (bad(s[key])) return `amygdala.${key} must be a number from 0 to 1`;
  if (s.readers === null || typeof s.readers !== "object") return "amygdala.readers must be a block of strengths";
  for (const key of Object.keys(NO_READERS) as (keyof AmygdalaReaders)[]) if (bad(s.readers[key])) return `amygdala.readers.${key} must be a number from 0 to 1`;
  return null;
}
