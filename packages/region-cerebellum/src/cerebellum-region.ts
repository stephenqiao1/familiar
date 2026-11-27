import type { Region, Workspace } from "@familiar/contracts";
import { learnChanges, learnMeasure, shareOf } from "./learn.js";
import { faded, mismatchOf, MISMATCH_SIGNAL, missedChange, spreadsOff } from "./mismatch.js";
import { modelId, type ModelStore, type Movement } from "./model.js";
import { predict, trustedModel } from "./predict.js";
import { DEFAULT_CEREBELLUM, type CerebellumSettings } from "./settings.js";

export interface CerebellumOptions {
  /** What has been learned (kept between runs by whoever made it). */
  store: ModelStore;
  /** The movements that ended since the last tick. Add a kind of movement or a measure on the game's side: nothing here changes. */
  movements(ws: Workspace, now: number): Movement[];
  settings?: CerebellumSettings;
  /** How far behind its predicted pace the movement under way is, in spreads (0: on time, or nothing under way). Default: never behind. */
  behind?(ws: Workspace, now: number): number;
  /** More for the log (what is due soon). Default: nothing. */
  notes?(now: number): Record<string, unknown>;
  /** Default: "cerebellum". */
  name?: string;
}

/** A tick taking longer than this is logged as slow. */
const SLOW_MS = 1;
const round = (n: number) => Math.round(n * 1000) / 1000;

/** One measure of one run, as logged: what was predicted (from which key), what happened, and the signed error. */
export interface MeasureTrace {
  measure: string;
  predicted: number | null;
  spread: number | null;
  /** The key the prediction came from; null with no trusted model (the bot's fixed rule would be used). */
  from: string | null;
  actual: number;
  /** actual − predicted; null with nothing predicted. */
  error: number | null;
}

/**
 * The cerebellum: for each movement the body makes, it learns what that movement comes to in
 * that situation (how long, how far, which changes), from the signed error between what it
 * predicted and what happened. It learns from error, not reward, and from the bot's own finished
 * movements only. It proposes no action and calls no model: it supplies numbers, and one signal,
 * `mismatch`, for a movement that came out far from what it predicted.
 */
export function createCerebellumRegion(options: CerebellumOptions): Region {
  const { store, settings = DEFAULT_CEREBELLUM, name = "cerebellum" } = options;
  let worstMs = 0;
  /** The last movement that came out far from its prediction. */
  let felt = { size: 0, at: 0 };

  /** Predicts, then learns, one movement. Every key from specific to general learns from the run; the prediction is the trusted one. */
  function take(m: Movement) {
    const measures: MeasureTrace[] = Object.entries(m.measures).map(([measure, actual]) => {
      const p = predict(store, m.kind, m.name, m.keys, measure, m.at, settings);
      return { measure, predicted: p && round(p.value), spread: p && round(p.spread), from: p && p.key, actual: round(actual), error: p && round(actual - p.value) };
    });
    const found = m.changes ? trustedModel(store, m.kind, m.name, m.keys, m.at, settings) : null;
    const expected = found && { key: found.key, changes: Object.keys(found.model.changes).filter((c) => shareOf(found.model, c) >= settings.expectedAt).sort() };
    const missing = expected && m.changes ? expected.changes.filter((c) => !m.changes!.includes(c)) : [];
    // How wrong it went: the measure furthest from its prediction, or an expected change that did not follow.
    // Only a prediction made for a particular situation counts: a general guess being off is not something gone wrong.
    const off = Math.max(0, ...measures.filter((t) => t.from && t.error !== null).map((t) => spreadsOff(t.error!, t.predicted!, t.spread!)));
    const mismatch = m.cutShort ? 0 : Math.max(mismatchOf(off), found?.key ? Math.max(0, ...missing.map((c) => missedChange(found.model, c))) : 0);
    if (mismatch > 0 && mismatch >= faded(felt.size, m.at - felt.at)) felt = { size: mismatch, at: m.at };
    if (settings.learn > 0 && !m.cutShort) {
      for (const key of m.keys) {
        const id = modelId(m.kind, m.name, key);
        const before = store.get(id);
        const learned: Record<string, ReturnType<typeof learnMeasure>["estimate"]> = { ...before?.measures };
        for (const [measure, actual] of Object.entries(m.measures)) learned[measure] = learnMeasure(before?.measures[measure], actual, m.at, settings, settings.bounds[measure]).estimate;
        const counted = m.changes ? learnChanges(before, m.changes, m.at, settings) : { runs: before?.runs ?? 0, changes: before?.changes ?? {} };
        store.set(id, { measures: learned, ...counted, at: m.at });
      }
    }
    return {
      movement: `${m.kind}:${m.name}`,
      key: m.keys[0] ?? "",
      ...(m.cutShort ? { cutShort: true } : {}),
      measures,
      ...(m.changes ? { changes: m.changes } : {}),
      ...(expected ? { expected: expected.changes, expectedFrom: expected.key } : {}),
      ...(missing.length ? { missing } : {}),
      ...(mismatch > 0 ? { mismatch: round(mismatch) } : {}),
      ...(m.today ? { today: m.today } : {}),
    };
  }

  return {
    name,
    layer: 0,
    everyMs: 0,
    run(ws) {
      const started = performance.now();
      const now = ws.state.timestamp;
      const runs = options.movements(ws, now).map(take);
      // The signal: the last mismatch while it fades, or a movement under way that is well behind its pace.
      const behind = settings.mismatch > 0 ? mismatchOf(options.behind?.(ws, now) ?? 0) : 0;
      const level = settings.mismatch * Math.max(faded(felt.size, now - felt.at), behind);
      if (level > 0 || (ws.signals[MISMATCH_SIGNAL]?.value ?? 0) > 0) ws.setSignal(MISMATCH_SIGNAL, level);
      const notes = options.notes?.(now) ?? {};
      const ms = performance.now() - started;
      worstMs = Math.max(worstMs, ms);
      if (!runs.length && ms <= SLOW_MS && level <= 0 && !Object.keys(notes).length) return { proposals: [] };
      return { proposals: [], trace: { ...(runs.length ? { runs } : {}), ...(level > 0 ? { mismatch: round(level), ...(behind > 0 ? { behind: round(behind) } : {}) } : {}), ...notes, models: store.ids().length, ...(ms > SLOW_MS ? { slowMs: round(ms) } : {}), worstMs: round(worstMs) } };
    },
  };
}
