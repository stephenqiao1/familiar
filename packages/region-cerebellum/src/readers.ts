import { widthOf } from "./mismatch.js";
import type { ModelStore } from "./model.js";
import { predict } from "./predict.js";
import type { CerebellumSettings } from "./settings.js";

// What the readers take from the models. Each is the bot's fixed number moved toward the learned
// one by the reader's strength, and the fixed number alone while the model is not trusted.

/** A learned limit is kept between these shares of the fixed one. */
export const LIMIT_BOUNDS = { least: 0.25, most: 3 };
/** A limit is the usual value and this many spreads. */
export const SPREADS = 3;

/** `fixed` moved toward `learned` by `strength`. */
export const toward = (fixed: number, learned: number, strength: number) => fixed + Math.min(1, Math.max(0, strength)) * (learned - fixed);

/** The longest something usually takes: its predicted value and three spreads. */
export const limitOf = (p: { value: number; spread: number }) => p.value + SPREADS * widthOf(p.value, p.spread);

export interface GiveUpBase {
  ms: number;
  /** The skill's usual time and spread, when the base came from them. */
  learned?: { seconds: number; spread: number };
}

/** The give-up clock's base for a skill: its own usual time and three spreads, kept between a quarter and three times the fixed base. */
export function giveUpBase(store: ModelStore, skill: string, fixedMs: number, now: number, settings: CerebellumSettings): GiveUpBase {
  const p = settings.giveUp > 0 ? predict(store, "skill", skill, [""], "seconds", now, settings) : null;
  if (!p) return { ms: fixedMs };
  const learned = Math.min(LIMIT_BOUNDS.most * fixedMs, Math.max(LIMIT_BOUNDS.least * fixedMs, limitOf(p) * 1000));
  return { ms: toward(fixedMs, learned, settings.giveUp), learned: { seconds: p.value, spread: p.spread } };
}
