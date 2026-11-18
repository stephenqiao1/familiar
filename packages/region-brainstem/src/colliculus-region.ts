import type { Proposal, Region, Workspace } from "@familiar/contracts";
import { type ColliculusSettings, type Features } from "./colliculus-settings.js";
import { createHabituation } from "./habituation.js";
import { partsOf, type Sense } from "./salience.js";
import { LOOMING_SIGNAL, ORIENTING_SIGNAL } from "./signals.js";

/** One thing on the map this tick. */
export interface Percept {
  /** A target the head can turn to (the thing, or the place a sound came from). */
  id: string;
  /** What kind of thing: for the goal's watched kinds, for getting used to it, and for the log. Never for salience. */
  kind: string;
  /** A rough place, so the same kind of thing in the same spot is got used to as one. Default: none. */
  place?: string;
  /** Which way it lies: "ahead", "left", "right" or "behind". */
  bearing: string;
  via: Sense;
  /** Its physical features, each 0 to 1. The only thing salience is worked out from. */
  features: Features;
  /** It just did something new (started moving, came at the bot, changed): it is no longer something to be used to. */
  fresh?: boolean;
}

export interface ColliculusOptions {
  settings: ColliculusSettings;
  /** Everything seen, heard and felt right now. */
  percepts(ws: Workspace): Percept[];
  /** Whether the layers above are looking for this kind of thing. Default: the goal's `watchFor` names it. */
  watched?(kind: string, ws: Workspace): boolean;
  /** Alarm, 0 to 1. Default: 0. */
  alarmOf?(ws: Workspace): number;
  /** Arousal, 0 to 1. Default: 0.5. */
  arousalOf?(ws: Workspace): number;
  /** In bed, asleep: only touch and loud sounds can win. Default: never. */
  asleep?(ws: Workspace): boolean;
  /** The running skill is a hard reflex's ("reflex") or marks itself demanding: only touch and looming may turn the head. Default: neither. */
  busy?(ws: Workspace): "reflex" | "demanding" | null;
  /** Something followed since the last tick (damage, a reward): what is attended was worth the look. Default: never. */
  eventful?(ws: Workspace): boolean;
  /** Nothing is running, or only idling: a look may simply take over. */
  idle(ws: Workspace): boolean;
  /** A look would run alongside the running skill instead of competing with it. Default: never. */
  looksAlongside?(ws: Workspace): boolean;
  /** Something faster already spoke this tick (a reflex, a startle, a loaded response): a look does not take over. Default: never. */
  spoken?(ws: Workspace): boolean;
  /** With nothing standing out and the body at rest: somewhere not looked at lately to glance toward, or null. Default: no scanning. */
  scan?(ws: Workspace): string | null;
  /** The skill that turns the head. */
  lookSkill: string;
  /** The urgency of a look that takes over from idling. Default: graded by salience like any other. */
  idleLookUrgency?: number;
  /** Default: "colliculus". */
  name?: string;
  /** Default: 0 (runs inside every tick). */
  layer?: number;
}

/** A watched kind gets this much added. */
const WATCH_BOOST = 0.4;
/** How far alarm and arousal lower the threshold, and a demanding skill raises it. */
const THRESHOLD = { alarm: 0.25, arousal: 0.2, demanding: 0.3, floor: 0.05 };
/** Asleep, a sound must be at least this loud to get through. */
const WAKING_LOUDNESS = 0.5;
/** A winner is held at least this long, and let go after this long unless it is still the most striking. */
const HOLD_MS = { least: 1000, most: 2000 };
/** The thing just looked at cannot win again for this long, unless it looms or touches. */
const NO_RETURN_MS = 3000;
/** At most one new look per this long. */
const LOOK_GAP_MS = 1000;
/** A look's urgency runs from here to here as salience rises to `full`. */
const URGENCY = { from: 0.35, to: 0.7, full: 1.5 };
/** Glances come this far apart. */
const SCAN_EVERY_MS = 4000;
/** A feature this strong makes a thing one that may interrupt (looming, touch). */
const PRESSING = 0.5;
export const COLLICULUS_LIMIT_MS = 2;

interface Scored extends Percept {
  salience: number;
  parts: Features;
  damped: number;
  pressing: boolean;
}

/**
 * The colliculus: the fast "where is it, and how sudden" map. Every tick it places everything
 * seen, heard and felt on one map, scores each by physical features only (never by what it is),
 * and turns the head to the most striking thing, before the rest of the brain has worked out
 * what that is. It never calls a model.
 *   a) the map: salience = suddenness + motion + looming + nearness + loudness + touch (weighted);
 *   b) bias from above: watched kinds get a boost; the threshold falls with alarm and arousal
 *      and rises during a demanding skill; asleep, only touch and loud sounds get through;
 *   c) habituation: a thing that wins and brings nothing counts for less next time (for about a
 *      minute, or until it does something new); what was just looked at cannot win straight back;
 *   d) one winner, written to the workspace as `attended` and held for 1 to 2 seconds;
 *   e) it proposes a look at the winner, shares `orienting` (a new winner) and `looming`;
 *   f) with nothing standing out and the body at rest, it glances somewhere not looked at lately.
 * Everything is in the trace.
 */
export function createColliculusRegion(options: ColliculusOptions): Region {
  const { settings, name = "colliculus", layer = 0 } = options;
  const habituation = createHabituation();
  const watched = options.watched ?? ((kind, ws) => ws.goal?.watchFor.includes(kind) ?? false);
  let held: { percept: Percept; since: number; eventful: boolean } | null = null;
  let lastLooked: { id: string; at: number } | null = null;
  let lastLookAt = -Infinity;
  let lastScanAt = 0;
  let worstMs = 0;
  const keysOf = (p: Percept) => [`thing ${p.id}`, ...(p.place ? [`${p.kind} at ${p.place}`] : [])];

  /** Lets go of what was attended; if nothing followed while it was, it counts for less next time. */
  function release(now: number): void {
    if (!held) return;
    if (!held.eventful && settings.habituation > 0) habituation.damp(keysOf(held.percept), now);
    lastLooked = { id: held.percept.id, at: now };
    held = null;
  }

  return {
    name,
    layer,
    everyMs: 0,
    run(ws) {
      const started = performance.now();
      const now = ws.state.timestamp;
      const trace: Record<string, unknown> = {};
      const proposals: Proposal[] = [];
      const busy = options.busy?.(ws) ?? null;
      const asleep = options.asleep?.(ws) ?? false;

      // a) The map.
      const scored: Scored[] = options.percepts(ws).map((p) => {
        if (p.fresh) habituation.restore(keysOf(p));
        const parts = partsOf(p.features, p.via, settings);
        const boost = settings.topDown > 0 && watched(p.kind, ws) ? WATCH_BOOST * settings.topDown : 0;
        const kept = settings.habituation > 0 ? 1 - settings.habituation * (1 - habituation.factor(keysOf(p), now)) : 1;
        const raw = Object.values(parts).reduce((sum, part) => sum + part, 0) + boost;
        return { ...p, parts, salience: raw * kept, damped: kept, pressing: parts.touch > 0 || (p.features.looming >= PRESSING && parts.looming > 0) };
      });
      scored.sort((a, b) => b.salience - a.salience);
      const looming = Math.max(0, ...scored.map((s) => (s.parts.looming > 0 ? s.features.looming : 0)));
      if (settings.looming > 0) ws.setSignal(LOOMING_SIGNAL, looming * settings.looming);

      // b) The threshold in force.
      const lowered = settings.topDown * (THRESHOLD.alarm * (options.alarmOf?.(ws) ?? 0) + THRESHOLD.arousal * ((options.arousalOf?.(ws) ?? 0.5) - 0.5));
      const threshold = Math.max(THRESHOLD.floor, settings.threshold - lowered + (busy === "demanding" ? settings.topDown * THRESHOLD.demanding : 0));

      // c) Who may win.
      const mayWin = (s: Scored) => {
        if (s.salience < threshold) return false;
        if (asleep && !(s.parts.touch > 0 || s.features.loudness >= WAKING_LOUDNESS)) return false;
        if (busy && !s.pressing) return false;
        const justLooked = settings.habituation > 0 && lastLooked !== null && lastLooked.id === s.id && now - lastLooked.at < NO_RETURN_MS;
        return !justLooked || s.pressing;
      };
      const best = scored.find(mayWin) ?? null;

      // d) One winner, held for a moment.
      if (held && options.eventful?.(ws)) held.eventful = true;
      const heldFor = held ? now - held.since : 0;
      const stillBest = held !== null && best !== null && best.id === held.percept.id;
      let fresh: Scored | null = null;
      if (!held) fresh = best;
      else if (best && !stillBest && (heldFor >= HOLD_MS.least || best.pressing)) fresh = best;
      else if (!stillBest && heldFor >= HOLD_MS.most) release(now);
      if (fresh && now - lastLookAt < LOOK_GAP_MS && !fresh.pressing) fresh = null;
      if (fresh) {
        release(now);
        held = { percept: fresh, since: now, eventful: false };
        lastLookAt = now;
        ws.setAttended({ id: fresh.id, kind: fresh.kind, bearing: fresh.bearing, salience: round(fresh.salience), since: now });
      } else if (!held && ws.attended) {
        ws.setAttended(null);
      }
      ws.setSignal(ORIENTING_SIGNAL, fresh ? 1 : 0);

      // e) Turn to it.
      const alongside = options.looksAlongside?.(ws) ?? false;
      const takeOver = !alongside && options.idle(ws) && !(options.spoken?.(ws) ?? false);
      const propose = (target: string, graded: number, reason: string) => {
        const urgency = takeOver ? (options.idleLookUrgency ?? graded) : graded;
        proposals.push({ action: { skill: options.lookSkill, target }, urgency, reason });
        return { target, urgency: round(urgency), how: alongside ? "alongside" : takeOver ? "takes over" : "competes" };
      };
      if (fresh) {
        const strength = Math.min(1, Math.max(0, (fresh.salience - threshold) / (URGENCY.full - threshold)));
        const why = `${fresh.via}: ${strongest(fresh.parts)}`;
        trace.winner = { id: fresh.id, kind: fresh.kind, via: fresh.via, bearing: fresh.bearing, salience: round(fresh.salience), why };
        trace.look = propose(fresh.id, URGENCY.from + (URGENCY.to - URGENCY.from) * strength, `striking (${why}), ${fresh.bearing}`);
      }

      // f) Nothing stands out: glance around, if the body is at rest.
      if (!fresh && !held && !busy && !asleep && settings.scanning > 0 && options.scan && (alongside || options.idle(ws)) && now - lastScanAt >= SCAN_EVERY_MS / settings.scanning) {
        const target = options.scan(ws);
        if (target) {
          lastScanAt = now;
          trace.scan = propose(target, URGENCY.from, "glancing around");
        }
      }

      trace.threshold = round(threshold);
      trace.top = scored.slice(0, 3).map((s) => ({ id: s.id, kind: s.kind, via: s.via, bearing: s.bearing, salience: round(s.salience), parts: rounded(s.parts), ...(s.damped < 1 ? { damped: round(s.damped) } : {}) }));
      const damped = habituation.damped(now);
      if (Object.keys(damped).length) trace.damped = damped;
      if (held) trace.attended = held.percept.id;
      const ms = performance.now() - started;
      if (ms > worstMs) {
        worstMs = ms;
        trace.worstMs = Math.round(ms * 1000) / 1000;
      }
      return { proposals, trace };
    },
  };
}

const round = (n: number) => Math.round(n * 100) / 100;
const rounded = (parts: Features) => Object.fromEntries(Object.entries(parts).filter(([, v]) => v > 0).map(([k, v]) => [k, round(v)]));
/** The feature that counted most, in words. */
function strongest(parts: Features): string {
  return Object.entries(parts).sort((a, b) => b[1] - a[1])[0]![0];
}
