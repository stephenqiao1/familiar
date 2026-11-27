import { kept, shareOf, sureOf } from "./learn.js";
import { modelId, type Model, type ModelStore } from "./model.js";
import type { CerebellumSettings } from "./settings.js";

// Reading the models: only a trusted one is used. A specific situation with too few runs falls
// back to the more general key, and with none the caller uses today's fixed number.

type Trust = Pick<CerebellumSettings, "trusted" | "forgetAfterMs" | "forgetHalfLifeMs">;

export interface Prediction {
  value: number;
  spread: number;
  /** The situation key the prediction came from (it may be more general than the one asked about). */
  key: string;
  /** How many runs it stands on now. */
  sure: number;
}

/** What a measure of this movement is predicted to be here: from the most specific trusted key, or null. */
export function predict(store: ModelStore, kind: string, name: string, keys: readonly string[], measure: string, now: number, trust: Trust): Prediction | null {
  for (const key of keys) {
    const e = store.get(modelId(kind, name, key))?.measures[measure];
    if (!e) continue;
    const sure = sureOf(e, now, trust);
    if (sure >= trust.trusted) return { value: e.value, spread: e.spread, key, sure };
  }
  return null;
}

/** The most specific model of this movement whose changes have been counted enough to trust, or null. */
export function trustedModel(store: ModelStore, kind: string, name: string, keys: readonly string[], now: number, trust: Trust): { model: Model; key: string } | null {
  for (const key of keys) {
    const model = store.get(modelId(kind, name, key));
    if (model && model.runs * kept(model.at, now, trust) >= trust.trusted) return { model, key };
  }
  return null;
}

/** The changes this movement is expected to cause here (each follows at least `expectedAt` of the time), or null with no trusted model. */
export function expectedChanges(store: ModelStore, kind: string, name: string, keys: readonly string[], now: number, settings: Trust & Pick<CerebellumSettings, "expectedAt">): { changes: string[]; key: string } | null {
  const found = trustedModel(store, kind, name, keys, now, settings);
  if (!found) return null;
  return { key: found.key, changes: Object.keys(found.model.changes).filter((c) => shareOf(found.model, c) >= settings.expectedAt).sort() };
}
