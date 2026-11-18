import type { Proposal, Region, State, Workspace } from "@familiar/contracts";
import { createLoadedResponses, LOADED_URGENCY, type Thing } from "./loaded.js";
import type { BrainstemSettings } from "./settings.js";
import { AROUSAL_SIGNAL, LOADED_SIGNAL, SORE_SIGNAL, STARTLE_SIGNAL, STUCK_SIGNAL, UNSTEADY_SIGNAL, UPPER_PAUSED_SIGNAL } from "./signals.js";

/** What a detector looks at: the last tick's state, this tick's, and the workspace. */
export interface BrainstemMoment {
  before: State;
  after: State;
  ws: Workspace;
}

/** One kind of sudden event. Returns its source (a thing to face, or null if unknown) when it happens. */
export interface StartleDetector {
  name: string;
  check(moment: BrainstemMoment): { source: Thing | null } | null;
}

/** What the brainstem needs to know of the body right now. (Its vital signs are the medulla's to report.) */
export interface Body {
  /** Health as a share of full health: a drop in it is a hurt, which wakes a sleeping body. */
  health: number;
  /** The legs are stuck right now (trying to get free, or just gave up). Default: false. */
  stuck?: boolean;
  /** How sore: 1 just after pulling away from pain, fading to 0. Default: 0. */
  sore?: number;
  /** How unsteady: 0 firm on its feet, 1 about to be hurt by a fall. Default: not shared. */
  unsteady?: number;
}

export interface BrainstemOptions {
  settings: BrainstemSettings;
  /** Alarm as last shared, 0 to 1. */
  alarmOf(ws: Workspace): number;
  /** Whether a hard reflex fired this tick. Default: never. */
  hardReflex?(ws: Workspace): boolean;
  /** b: the sudden events that startle. */
  startle: StartleDetector[];
  /** d: everything in view, for matching loaded responses. */
  thingsOf(state: State): Thing[];
  /** d: why a loaded response may not use a skill (unknown, a primitive, reflex-only), or null if it may. */
  responseProblem(skill: string): string | null;
  /** d: whether a skill can be aimed at a target right now. */
  acceptsTarget(skill: string, target: string): boolean;
  /** d: the names a goal may hold back (soft reflexes and the skills they propose). */
  holdable: string[];
  /** e: in bed, asleep. */
  asleep(ws: Workspace): boolean;
  /** e: night, safe and idle. */
  drowsy(ws: Workspace): boolean;
  /** f: the body's levels, or null before the first state. */
  body(state: State): Body | null;
  /** f: what the body's balance and posture did this tick, for the trace. Asked once a tick. Default: nothing. */
  postureNotes?(state: State): Record<string, unknown> | null;
  /** The skill proposed for a startle. (Turning to look at things is the colliculus's job.) */
  skills: { brace: string };
  /** Default: "brainstem". */
  name?: string;
  /** Default: 0 (runs inside every tick). */
  layer?: number;
}

/** At most one startle per this long. */
const STARTLE_GAP_MS = 5000;
/** Pain fades with this time constant: about gone after 10 seconds. */
const PAIN_TAU_SECONDS = 3.3;
/** Being stuck fades from the signal with this time constant: about gone after 5 seconds. */
const STUCK_TAU_SECONDS = 1.7;
/** Losing this share of full health at once is full pain. */
const FULL_PAIN = 1 / 3;
/** Below these, the bot is undisturbed enough to stay asleep with the upper layers paused. */
const CALM = { pain: 0.05, alarm: 0.2 };
const AROUSAL = { asleep: 0.05, drowsy: 0.3, awake: 0.5 };
/** While the upper layers are paused, staying with the running skill (sleep) is proposed at this urgency. */
const STAY_ASLEEP_URGENCY = 0.5;

/**
 * The brainstem: keeps the body going and reacts before the rest of the brain has noticed. It
 * proposes little; mostly it shares signals. (It also supplies the reflex gains: see `createReflexGain`.)
 *   b) startle: on a sudden event, shares `startle` for one tick and proposes bracing once
 *      (urgency 1) toward where it came from, at most once per 5 s;
 *   (c, orienting, moved to the colliculus region);
 *   d) loaded responses: fires a response the goal loaded in advance the moment its thing appears;
 *      reports loaded responses and hold-backs it had to ignore;
 *   e) arousal gate: shares `arousal`; while asleep and undisturbed, shares `upper_paused` so the
 *      deciding layers above make no calls. A startle, damage, a hard reflex or alarm ends it at once;
 *   f) body signals: shares `stuck`, `sore` and `unsteady` (the vital signs are the medulla's).
 * Everything it does is in the trace.
 */
export function createBrainstemRegion(options: BrainstemOptions): Region {
  const { settings, skills, name = "brainstem", layer = 0 } = options;
  const loaded = createLoadedResponses(options.responseProblem);
  let before: State | null = null;
  let pain = 0;
  let stuck = 0;
  let lastStartle = -Infinity;
  let checkedGoal: number | null = null;

  return {
    name,
    layer,
    everyMs: 0,
    run(ws) {
      const after = ws.state;
      const now = after.timestamp;
      const moment = before ? { before, after, ws } : null;
      const proposals: Proposal[] = [];
      const trace: Record<string, unknown> = {};

      // f) Body. Recent pain is tracked here only for the arousal gate; the medulla shares the vital signs.
      const body = options.body(after);
      const was = before ? options.body(before) : null;
      const dt = before ? Math.max(0, now - before.timestamp) / 1000 : 0;
      const hurt = body && was ? Math.max(0, was.health - body.health) : 0;
      pain = Math.min(1, pain * Math.exp(-dt / PAIN_TAU_SECONDS) + hurt / FULL_PAIN);
      if (settings.bodySignals > 0 && body) {
        // 1 while the legs are stuck, then fading.
        stuck = body.stuck ? 1 : stuck * Math.exp(-dt / STUCK_TAU_SECONDS);
        ws.setSignal(STUCK_SIGNAL, stuck);
        ws.setSignal(SORE_SIGNAL, body.sore ?? 0);
        if (body.unsteady !== undefined) ws.setSignal(UNSTEADY_SIGNAL, body.unsteady);
        trace.body = { stuck, sore: body.sore ?? 0, ...(body.unsteady === undefined ? {} : { unsteady: body.unsteady }) };
      }
      const posture = options.postureNotes?.(after);
      if (posture) trace.posture = posture;

      // b) Startle.
      let startled: { by: string; source: Thing | null } | null = null;
      if (settings.startle > 0) {
        if (moment && now - lastStartle >= STARTLE_GAP_MS) {
          for (const detector of options.startle) {
            const hit = detector.check(moment);
            if (hit) {
              startled = { by: detector.name, source: hit.source };
              break;
            }
          }
        }
        ws.setSignal(STARTLE_SIGNAL, startled ? 1 : 0);
        if (startled) {
          lastStartle = now;
          trace.startle = startled;
          proposals.push({ action: { skill: skills.brace, ...(startled.source ? { target: startled.source.id } : {}) }, urgency: 1, reason: `startled: ${startled.by}` });
        }
      }

      // d) Loaded responses, and hold-backs the goal asked for that cannot be honoured.
      if (settings.loadedResponses > 0) {
        const { fire, dropped } = loaded.observe(ws.goal, options.thingsOf(after), now, startled?.source);
        if (dropped) trace.droppedResponses = dropped;
        ws.setSignal(LOADED_SIGNAL, fire ? 1 : 0);
        if (fire) {
          const target = options.acceptsTarget(fire.rule.skill, fire.thing.id) ? { target: fire.thing.id } : {};
          trace.loadedResponse = { when: fire.rule.when, skill: fire.rule.skill, thing: fire.thing.id };
          proposals.push({ action: { skill: fire.rule.skill, ...target }, urgency: LOADED_URGENCY, reason: `loaded response: ${fire.rule.when} appeared` });
        }
      }
      if (ws.goal && ws.goal.setAt !== checkedGoal) {
        checkedGoal = ws.goal.setAt;
        const ignored = ws.goal.holdBack.filter((n) => !options.holdable.includes(n));
        if (ignored.length) trace.ignoredHoldBack = ignored;
        const held = settings.holdBack > 0 ? ws.goal.holdBack.filter((n) => options.holdable.includes(n)) : [];
        if (held.length) trace.holdingBack = held;
      }

      // e) Arousal gate.
      const alarm = options.alarmOf(ws);
      const disturbed = startled !== null || hurt > 0 || pain > CALM.pain || alarm >= CALM.alarm || (options.hardReflex?.(ws) ?? false);
      const asleep = options.asleep(ws) && !disturbed;
      const rest = asleep ? AROUSAL.asleep : options.drowsy(ws) ? AROUSAL.drowsy : AROUSAL.awake;
      const arousal = rest + (1 - rest) * alarm;
      ws.setSignal(AROUSAL_SIGNAL, arousal);
      trace.arousal = arousal;
      if (settings.arousalGate > 0) {
        ws.setSignal(UPPER_PAUSED_SIGNAL, asleep ? 1 : 0);
        if (asleep) {
          trace.upperPaused = true;
          // With the deciding layers quiet, nothing else would speak for staying asleep.
          if (ws.current) {
            proposals.push({ action: { skill: ws.current.skill, ...(ws.current.target ? { target: ws.current.target } : {}) }, urgency: STAY_ASLEEP_URGENCY, reason: "asleep and undisturbed" });
          }
        } else if (options.asleep(ws)) {
          trace.woken = startled ? "startle" : hurt > 0 || pain > CALM.pain ? "damage" : alarm >= CALM.alarm ? "alarm" : "hard reflex";
        }
      }

      before = after;
      return { proposals, trace };
    },
  };
}
