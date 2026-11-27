import { shareOf } from "./learn.js";
import type { ModelStore } from "./model.js";
import { trustedModel } from "./predict.js";
import type { CerebellumSettings } from "./settings.js";

// Which expectations a movement is checked against: the written list, or what experience says.

/** A written expectation that follows less often than this, in one situation, is disagreed with there. */
const DISAGREES_BELOW = 0.5;

export interface Expectations {
  /** The changes the movement is expected to cause here. */
  expects: string[];
  /** The situation key they were learned in. */
  key: string;
  why: string;
}

/** How often a written expectation has followed: by its own word, or the same change with a direction ("drops" is met by "drops+"). */
const followed = (model: Parameters<typeof shareOf>[0], written: string) => Math.max(shareOf(model, written), shareOf(model, `${written}+`), shareOf(model, `${written}-`));

/**
 * The learned expectations to use instead of the written ones, or null to keep the written ones.
 * An empty written list is filled from any trusted model. A written one is replaced only in a
 * particular situation (never by the any-situation model) where a written change mostly fails
 * to follow.
 */
export function learnedExpectations(store: ModelStore, kind: string, name: string, keys: readonly string[], written: readonly string[], now: number, settings: Pick<CerebellumSettings, "trusted" | "forgetAfterMs" | "forgetHalfLifeMs" | "expectedAt" | "expectations">): Expectations | null {
  if (settings.expectations <= 0) return null;
  const found = trustedModel(store, kind, name, keys, now, settings);
  if (!found) return null;
  const expects = Object.keys(found.model.changes).filter((c) => shareOf(found.model, c) >= settings.expectedAt).sort();
  const where = found.key || "any situation";
  if (!written.length) return expects.length ? { expects, key: found.key, why: `learned (${where})` } : null;
  const fails = written.filter((w) => followed(found.model, w) < DISAGREES_BELOW);
  if (found.key === "" || !fails.length) return null;
  return { expects, key: found.key, why: `learned (${where}): ${fails.map((w) => `${w} follows only ${Math.round(followed(found.model, w) * 100)}%`).join(", ")}` };
}
