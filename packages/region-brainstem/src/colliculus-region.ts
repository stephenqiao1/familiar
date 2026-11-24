import type { Proposal, Region, Workspace } from "@familiar/contracts";
import { type ColliculusSettings, type Features } from "./colliculus-settings.js";
import { fieldOf, jumpTo, type Field } from "./field.js";
import { brakeOf } from "./fixation.js";
import { createHabituation } from "./habituation.js";
import { leanOf, type Lean } from "./lean.js";
import { createOrienting } from "./orienting.js";
import { boostOf, type Boost } from "./priority.js";
import { partsOf, type Sense } from "./salience.js";
import { LOOMING_SIGNAL, ORIENTING_SIGNAL } from "./signals.js";
import { FOLLOWS_WITHIN_MS, standing, whyWorth, type Before, type DefenceNow } from "./worth.js";

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
  /** Where it is on the map, in degrees: from straight ahead (left is positive), and above eye level. Default: 0 and 0. */
  angle?: number;
  elevation?: number;
  /** How well lit it is where it stands, 0 (dark) to 1 (daylight). Default: 1. */
  light?: number;
  /** Plain physical facts for the lean (see lean.ts). Default: none, so no lean. */
  shape?: { dist: number; across: number; closing: number; height?: number; /** How big it looks, in degrees of the view. */ size?: number };
  /** The bot's own doing (something it just dug, placed or struck): looked at like anything else, but no `orienting` signal. */
  own?: boolean;
}

export interface ColliculusOptions {
  settings: ColliculusSettings;
  /** Everything seen, heard and felt right now. */
  percepts(ws: Workspace): Percept[];
  /** Whether the layers above are looking for this kind of thing. Default: the goal's `watchFor` names it. */
  watched?(kind: string, ws: Workspace): boolean;
  /** How much the bot wants this kind of thing right now, given its needs, 0 to 1. Default: 0. */
  wantOf?(kind: string, ws: Workspace): number;
  /** The thing the running skill is aimed at: the gaze is held on it. Default: the running skill's target, unless the skill is the look itself. */
  fixated?(ws: Workspace): string | null;
  /** A need for safety presses: nothing is worth a closer look. Default: a need of kind "safety" presses. */
  safetyPresses?(ws: Workspace): boolean;
  /** The defence chosen right now and the thing it is about, for telling whether a look was worth it. Default: unknown. */
  defenceOf?(ws: Workspace): DefenceNow | null;
  /** How far up (positive) or down the head points now, in degrees. Default: 0. */
  pitchOf?(ws: Workspace): number;
  /** Alarm, 0 to 1. Default: 0. */
  alarmOf?(ws: Workspace): number;
  /** Arousal, 0 to 1. Default: 0.5. */
  arousalOf?(ws: Workspace): number;
  /** How wary the body is, 0 to 1: a wary body turns to slighter things. Default: 0. */
  waryOf?(ws: Workspace): number;
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

/** How far alarm and arousal lower the threshold, and a demanding skill raises it. */
const THRESHOLD = { alarm: 0.25, arousal: 0.2, wary: 0.1, demanding: 0.3, floor: 0.05 };
/** Asleep, a sound must be at least this loud to get through. */
const WAKING_LOUDNESS = 0.5;
/** A winner is held at least this long, and let go after this long unless it is still the most striking. */
const HOLD_MS = { least: 1000, most: 2000, closerLook: 3000 };
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
  boost: Boost;
  field: Field;
}

/**
 * The colliculus: the fast "where is it, and how sudden" map. Every tick it places everything
 * seen, heard and felt on one map, scores each by physical features only (never by what it is),
 * and turns the head to the most striking thing, before the rest of the brain has worked out
 * what that is. It never calls a model.
 *   a) the map, in two dimensions: salience = suddenness + motion + looming + nearness + loudness
 *      + touch (weighted), what is seen scaled by the light where it stands (darkness.ts); each
 *      thing has an angle, an elevation and a field (field.ts);
 *   b) priority: watched and wanted kinds get a boost (priority.ts); the threshold falls with
 *      alarm and arousal and rises during a demanding skill; while the running skill is aimed at
 *      a thing the gaze is held there and others must be stronger (fixation.ts); asleep, only
 *      touch and loud sounds get through;
 *   c) habituation: a thing that wins and brings nothing counts for less next time (for about a
 *      minute, or until it does something new); what was just looked at cannot win straight
 *      back; a look that was worth it is not got used to (worth.ts);
 *   d) one winner, written to the workspace as `attended` with its place and its lean (lean.ts),
 *      and held for 1 to 2 seconds (3 for a closer look);
 *   e) it proposes a look at the winner, shares `orienting` (graded, fading in half a second;
 *      orienting.ts) and `looming`;
 *   f) with nothing standing out and the body at rest, it glances somewhere not looked at lately.
 * Everything is in the trace.
 */
export function createColliculusRegion(options: ColliculusOptions): Region {
  const { settings, name = "colliculus", layer = 0 } = options;
  const habituation = createHabituation();
  const watched = options.watched ?? ((kind, ws) => ws.goal?.watchFor.includes(kind) ?? false);
  const orienting = createOrienting();
  type Look = { percept: Percept; since: number; worth: string | null; before: Before; most: number };
  let held: Look | null = null;
  /** Looks that ended lately and were got used to: what follows soon after still counts for them. */
  let ended: (Look & { until: number })[] = [];
  let lastLooked: { id: string; at: number } | null = null;
  let lastLookAt = -Infinity;
  let lastScanAt = 0;
  let worstMs = 0;
  const keysOf = (p: Percept) => [`thing ${p.id}`, ...(p.place ? [`${p.kind} at ${p.place}`] : [])];

  /** Lets go of what was attended; if nothing followed while it was, it counts for less next time. */
  function release(now: number, trace: Record<string, unknown>): void {
    if (!held) return;
    if (!held.worth && settings.habituation > 0) {
      habituation.damp(keysOf(held.percept), now);
      if (settings.followUp > 0) ended.push({ ...held, until: now + FOLLOWS_WITHIN_MS });
    }
    trace.released = { id: held.percept.id, worth: held.worth !== null, why: held.worth ?? "nothing followed" };
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
        const parts = partsOf(p.features, p.via, settings, p.light ?? 1);
        const boost = settings.topDown > 0 ? boostOf(watched(p.kind, ws), settings.wants > 0 ? (options.wantOf?.(p.kind, ws) ?? 0) : 0, settings) : { boost: 0, from: null };
        const kept = settings.habituation > 0 ? 1 - settings.habituation * (1 - habituation.factor(keysOf(p), now)) : 1;
        const raw = Object.values(parts).reduce((sum, part) => sum + part, 0) + boost.boost;
        const field = settings.elevation > 0 ? fieldOf(p.elevation ?? 0) : "level";
        return { ...p, parts, boost, field, salience: raw * kept, damped: kept, pressing: parts.touch > 0 || (p.features.looming >= PRESSING && parts.looming > 0) };
      });
      scored.sort((a, b) => b.salience - a.salience);
      const looming = Math.max(0, ...scored.map((s) => (s.parts.looming > 0 ? s.features.looming : 0)));
      if (settings.looming > 0) ws.setSignal(LOOMING_SIGNAL, looming * settings.looming);

      // b) The threshold in force.
      const lowered = settings.topDown * (THRESHOLD.alarm * (options.alarmOf?.(ws) ?? 0) + THRESHOLD.arousal * ((options.arousalOf?.(ws) ?? 0.5) - 0.5) + THRESHOLD.wary * (options.waryOf?.(ws) ?? 0));
      const raised = busy === "demanding" ? settings.topDown * THRESHOLD.demanding : 0;
      const threshold = Math.max(THRESHOLD.floor, settings.threshold - lowered + raised);
      // The brake: the gaze is held on what the running skill is aimed at.
      const fixated = settings.fixation > 0 ? (options.fixated ?? ((w: Workspace) => (w.current && w.current.skill !== options.lookSkill ? (w.current.target ?? null) : null)))(ws) : null;
      const brake = brakeOf(fixated !== null, raised, settings.fixation);

      // c) Who may win.
      const mayWin = (s: Scored, braked = true) => {
        if (fixated !== null && s.id === fixated) return false;
        if (s.salience < threshold + (braked && !s.pressing ? brake : 0)) return false;
        if (asleep && !(s.parts.touch > 0 || s.features.loudness >= WAKING_LOUDNESS)) return false;
        if (busy && !s.pressing) return false;
        const justLooked = settings.habituation > 0 && lastLooked !== null && lastLooked.id === s.id && now - lastLooked.at < NO_RETURN_MS;
        return !justLooked || s.pressing;
      };
      let best = scored.find((s) => mayWin(s)) ?? null;
      // A want raises priority, but never past a pressing thing (touch, strong looming).
      if (best && !best.pressing && best.boost.from === "wanted") best = scored.find((s) => s.pressing && mayWin(s)) ?? best;
      const unbraked = brake > 0 ? (scored.find((s) => mayWin(s, false)) ?? null) : null;
      if (unbraked && unbraked.id !== best?.id) trace.brake = { stopped: unbraked.id, kind: unbraked.kind, salience: round(unbraked.salience), needed: round(threshold + brake), heldOn: fixated };

      // d) One winner, held for a moment.
      const eventful = held || ended.length ? (options.eventful?.(ws) ?? false) : false;
      const defence = settings.followUp > 0 ? (options.defenceOf?.(ws) ?? null) : null;
      const worthOf = (look: Look) => (eventful ? "the body was hurt or rewarded" : settings.followUp > 0 ? whyWorth(look.before, ws, defence, look.percept.id, options.lookSkill) : null);
      if (held && !held.worth) held.worth = worthOf(held);
      // What follows just after a look still counts: the thing gets back what it had lost.
      ended = ended.filter((look) => {
        const why = look.until >= now ? worthOf(look) : null;
        if (why) {
          habituation.restore(keysOf(look.percept));
          trace.worthAfter = { id: look.percept.id, why };
        }
        return !why && look.until >= now;
      });
      const heldFor = held ? now - held.since : 0;
      const stillBest = held !== null && best !== null && best.id === held.percept.id;
      let fresh: Scored | null = null;
      if (!held) fresh = best;
      else if (best && !stillBest && (heldFor >= HOLD_MS.least || best.pressing)) fresh = best;
      else if (!stillBest && heldFor >= held!.most) release(now, trace);
      if (fresh && now - lastLookAt < LOOK_GAP_MS && !fresh.pressing) fresh = null;
      // Sky and ground: what a thing's place and movement lean the body toward.
      const leanFor = (s: Scored): Lean | null => (settings.fields > 0 && s.shape ? leanOf({ ...s.shape, field: s.field, looming: s.parts.looming > 0 ? s.features.looming : 0, safetyPresses: (options.safetyPresses ?? safetyNeedPresses)(ws) }) : null);
      const attend = (s: Scored, since: number, lean: Lean | null) => {
        const where = s.angle === undefined ? {} : { angle: Math.round(s.angle), elevation: Math.round(s.elevation ?? 0), field: s.field };
        ws.setAttended({ id: s.id, kind: s.kind, bearing: s.bearing, salience: round(s.salience), since, ...where, ...(lean ? { lean } : {}) });
      };
      let lean: Lean | null = null;
      if (fresh) {
        release(now, trace);
        lean = leanFor(fresh);
        held = { percept: fresh, since: now, worth: null, before: standing(ws, defence), most: lean === "approach" ? HOLD_MS.closerLook : HOLD_MS.most };
        lastLookAt = now;
        attend(fresh, now, lean);
      } else if (held) {
        // Still held: the lean follows what the thing is doing now (a thing passing over may start to dive).
        const seen = scored.find((s) => s.id === held!.percept.id);
        lean = seen ? leanFor(seen) : ((ws.attended?.lean as Lean | undefined) ?? null);
        if (seen && lean !== (ws.attended?.lean ?? null)) {
          attend(seen, held.since, lean);
          if (lean === "approach") held.most = HOLD_MS.closerLook;
          trace.lean = lean ?? "none";
        }
      } else if (ws.attended) {
        ws.setAttended(null);
      }
      // The fast "something happened" signal. What the bot caused itself sends none.
      if (fresh && !fresh.own) orienting.fire(fresh.salience, now);
      const happened = settings.event > 0 ? round(settings.event * orienting.level(now)) : fresh ? 1 : 0;
      ws.setSignal(ORIENTING_SIGNAL, happened);

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
        const jump = fresh.angle === undefined ? {} : { jump: jumpTo({ angle: fresh.angle, elevation: fresh.elevation ?? 0 }, options.pitchOf?.(ws) ?? 0) };
        trace.winner = { id: fresh.id, kind: fresh.kind, via: fresh.via, bearing: fresh.bearing, salience: round(fresh.salience), why, field: fresh.field, ...jump, ...(lean ? { lean } : {}), ...(fresh.boost.from ? { drawnBy: fresh.boost.from } : {}), ...(fresh.own ? { own: true } : {}) };
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
      trace.top = scored.slice(0, 3).map((s) => ({
        id: s.id,
        kind: s.kind,
        via: s.via,
        bearing: s.bearing,
        salience: round(s.salience),
        parts: rounded(s.parts),
        ...(s.damped < 1 ? { damped: round(s.damped) } : {}),
        ...(s.angle === undefined ? {} : { angle: Math.round(s.angle), elevation: Math.round(s.elevation ?? 0) }),
        field: s.field,
        ...(s.via === "sight" && s.light !== undefined ? { light: round(s.light) } : {}),
        ...(s.boost.from ? { boost: round(s.boost.boost), boostFrom: s.boost.from } : {}),
      }));
      if (happened > 0) trace.orienting = happened;
      if (fixated !== null) trace.fixated = fixated;
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

const safetyNeedPresses = (ws: Workspace) => ws.needs?.readings.some((r) => r.kind === "safety" && r.pressing > 0) ?? false;
const round = (n: number) => Math.round(n * 100) / 100;
const rounded = (parts: Features) => Object.fromEntries(Object.entries(parts).filter(([, v]) => v > 0).map(([k, v]) => [k, round(v)]));
/** The feature that counted most, in words. */
function strongest(parts: Features): string {
  return Object.entries(parts).sort((a, b) => b[1] - a[1])[0]![0];
}
