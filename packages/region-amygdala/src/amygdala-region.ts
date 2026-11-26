import type { Attended, Region, Workspace } from "@familiar/contracts";
import { goodOf, harmOf, typeOf, type AssociationStore } from "./association.js";
import { learnHarmless, learnOutcome, type Change, type Moment, type Outcome } from "./learn.js";
import { createPresence, type Cue } from "./presence.js";
import { DEFAULT_AMYGDALA, type AmygdalaSettings } from "./settings.js";
import { APPEAL_SIGNAL, FEAR_SIGNAL, MATTERS_SIGNAL } from "./signals.js";
import { startOf } from "./spread.js";

export interface AmygdalaOptions {
  /** What has been learned (kept between runs by whoever made it). */
  store: AssociationStore;
  /** The cues around this tick. Add a kind of cue on the game's side: nothing here changes. */
  cues(ws: Workspace): Cue[];
  /** What happened to the body since the last tick: harm (damage, illness, death) and good (a need dropping). */
  outcomes(ws: Workspace): Outcome[];
  /** What the bot is born believing, whether or not the cue has ever been around: cue → harm and good. Default: nothing. */
  born?: Readonly<Record<string, { harm?: number; good?: number }>>;
  /** How alike two cues of one type are, 0 to 1, from physical facts. Default: nothing is alike. */
  alike?(a: string, b: string): number;
  settings?: AmygdalaSettings;
  /** The area the bot is in. Default: the hippocampus's (`ws.place`). */
  area?(ws: Workspace): string | null;
  /** The cue that stands for the thing attended to, so that it can be told how much harm that thing predicts. Default: it is not told. */
  cueOf?(thing: Attended, ws: Workspace): string | null;
  /** How its reading compares with the older learning rules, for the log. */
  shadow?(ws: Workspace): unknown;
  /** Default: "amygdala". */
  name?: string;
  /** Default: 0 (runs inside every tick). */
  layer?: number;
}

/** A tick taking longer than this is logged as slow. */
const SLOW_MS = 1;
/** At most this many cues are listed in the log. */
const LISTED = 6;
/** A fear that is this much stronger than when the cue was last around, with no new harm, has come back. */
const CAME_BACK = 0.1;
/** A cue's harm moving less than this in an outcome was not blamed for it. */
const NOT_BLAMED = 0.005;
const round = (n: number) => Math.round(n * 1000) / 1000;
const shown = (c: Change) => ({ ...c, from: round(c.from), to: round(c.to) });

/**
 * The amygdala: the one place that learns what predicts harm and what predicts good. Each tick
 * it takes the cues around (offered by the game's side), says how much harm and good they
 * predict together, and learns from what then happens to the body: by surprise (learn.ts), by
 * place ("safe here"), and by likeness (spread.ts). It shares `fear` (the strongest harm any
 * cue around predicts), `appeal` (the same for good) and `matters` (the larger), and tells the
 * thing attended to how much harm it predicts. It proposes no action and calls no model.
 */
export function createAmygdalaRegion(options: AmygdalaOptions): Region {
  const { store, settings = DEFAULT_AMYGDALA, name = "amygdala", layer = 0 } = options;
  const presence = createPresence();
  let worstMs = 0;
  let seeded = false;
  /** Each cue as it was when last around: what it expressed, what was stored, and where. */
  const last = new Map<string, { harm: number; stored: number; area: string | null }>();

  return {
    name,
    layer,
    everyMs: 0,
    run(ws) {
      const started = performance.now();
      const now = ws.state.timestamp;
      const m: Moment = { area: options.area ? options.area(ws) : (ws.place?.area ?? null), now, settings };
      // Inborn beliefs are held from the first tick, met or not.
      if (!seeded) for (const [key, born] of Object.entries(options.born ?? {})) if (!store.get(key)) store.set(key, startOf(key, born, store, undefined, 0, now));
      seeded = true;
      const offered = options.cues(ws).filter((c) => typeOf(c.key) !== "sign" || settings.signs > 0);
      const begun: Record<string, unknown>[] = [];
      for (const cue of offered) {
        if (store.get(cue.key)) continue;
        const start = startOf(cue.key, cue.born, store, options.alike, settings.spread, now);
        store.set(cue.key, start);
        if (start.harm !== 0 || start.good !== 0) begun.push({ cue: cue.key, harm: round(start.harm), good: round(start.good), ...(cue.born ? { born: true } : {}), ...(start.from ? { like: start.from } : {}) });
      }
      presence.note(offered, now);
      const around = presence.around(now);
      // What the cues predict now, before anything is learned from this tick.
      const expressed = (key: string) => harmOf(store.get(key), m.area, now, settings.safeHere);
      // Fear and appeal are of what is here now (a cue only lingers for blame).
      // A sign of safety (a cue below zero) takes that much off the strongest fear.
      const safety = offered.reduce((sum, c) => sum + Math.min(0, expressed(c.key)), 0);
      const fear = Math.min(1, Math.max(0, Math.max(0, ...offered.map((c) => expressed(c.key))) + safety));
      const appeal = Math.min(1, Math.max(0, ...offered.map((c) => goodOf(store.get(c.key), now))));
      ws.setSignal(FEAR_SIGNAL, fear);
      ws.setSignal(APPEAL_SIGNAL, appeal);
      ws.setSignal(MATTERS_SIGNAL, Math.max(fear, appeal));
      const attendedCue = ws.attended && options.cueOf ? options.cueOf(ws.attended, ws) : null;
      const harm = attendedCue === null ? undefined : round(expressed(attendedCue));
      if (ws.attended && harm !== undefined && harm !== ws.attended.harm) ws.setAttended({ ...ws.attended, harm });

      // A fear that has come back: stronger than when the cue was last around, though no harm was learned since.
      const returned: Record<string, unknown>[] = [];
      for (const c of offered) {
        const [now_, stored, was] = [expressed(c.key), store.get(c.key)?.harm ?? 0, last.get(c.key)];
        if (was && stored <= was.stored && now_ - was.harm >= CAME_BACK) returned.push({ cue: c.key, from: round(was.harm), to: round(now_), why: was.area !== m.area ? `another place (it was found safe in ${was.area ?? "a place not known"})` : "time has passed since it was found safe here" });
        last.set(c.key, { harm: now_, stored, area: m.area });
      }

      const learned: Record<string, unknown>[] = [];
      for (const outcome of options.outcomes(ws)) {
        // What the cues it points at were rated before it taught anything.
        const rated = outcome.sign === "harm" && outcome.points?.length ? { rated: round(Math.max(...outcome.points.map(expressed))) } : {};
        const result = learnOutcome(store, around, outcome, m);
        if (outcome.sign === "harm") presence.harmed(now);
        const blamed = new Set(result.changes.filter((c) => c.what === outcome.sign && Math.abs(c.to - c.from) >= NOT_BLAMED).map((c) => c.cue));
        learned.push({ after: outcome.what, sign: outcome.sign, size: round(outcome.size), predicted: round(result.predicted), ...rated, changes: result.changes.map(shown), spared: around.filter((c) => !blamed.has(c.key)).length });
      }
      for (const meeting of presence.harmless(now)) {
        const changes = learnHarmless(store, meeting, around, m);
        if (changes.length) learned.push({ after: `${meeting.key} around ${Math.round(meeting.ms / 1000)} s, no harm`, changes: changes.map(shown) });
      }

      const listed = around
        .map((c) => ({ cue: c.key, harm: round(harmOf(store.get(c.key), m.area, now, settings.safeHere)), good: round(goodOf(store.get(c.key), now)) }))
        .filter((c) => c.harm !== 0 || c.good !== 0)
        .sort((a, b) => Math.abs(b.harm) + b.good - Math.abs(a.harm) - a.good)
        .slice(0, LISTED);
      const shadow = options.shadow?.(ws);
      const ms = performance.now() - started;
      worstMs = Math.max(worstMs, ms);
      return {
        proposals: [],
        trace: {
          area: m.area,
          fear: round(fear),
          appeal: round(appeal),
          cues: listed,
          around: around.length,
          ...(harm === undefined ? {} : { attended: { cue: attendedCue, harm } }),
          ...(begun.length ? { begun } : {}),
          ...(returned.length ? { returned } : {}),
          ...(learned.length ? { learned } : {}),
          ...(shadow === undefined || shadow === null ? {} : { shadow }),
          ...(ms > SLOW_MS ? { slow: `this tick took ${round(ms)} ms (the limit is ${SLOW_MS})` } : {}),
          worstMs: Math.round(worstMs * 100) / 100,
        },
      };
    },
  };
}
