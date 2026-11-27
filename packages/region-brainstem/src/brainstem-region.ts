import type { Proposal, Region, State, Workspace } from "@familiar/contracts";
import { createLoadedResponses, LOADED_URGENCY, type Thing } from "./loaded.js";
import type { Choice, Threat } from "./defence.js";
import { createDefenceState } from "./defence-state.js";
import { createStartle } from "./startle.js";
import type { BrainstemSettings } from "./settings.js";
import { ANALGESIA_SIGNAL, LOADED_SIGNAL, RECOVERING_SIGNAL, THREAT_SIGNAL, WARY_SIGNAL, SORE_SIGNAL, STARTLE_FROM, STARTLE_SIGNAL, STUCK_SIGNAL, UNSTEADY_SIGNAL } from "./signals.js";

/** What a detector looks at: the last tick's state, this tick's, and the workspace. */
export interface BrainstemMoment {
  before: State;
  after: State;
  ws: Workspace;
}

/** A sudden event, as a detector reports it. */
export interface StartleHit {
  /** The thing to face, or null if unknown. */
  source: Thing | null;
  /** How sudden and strong it was, 0 to 1. */
  intensity: number;
  /** What kind of event, for getting used to it. Default: the source's kind, else the detector's name. */
  kind?: string;
  /** Roughly where it came from. Default: nowhere (an event that travels with the body). */
  place?: string;
  /** It was seen coming, 0 to 1. Default: 0. */
  foreseen?: number;
  /** The body did it itself. Default: false. */
  selfCaused?: boolean;
  /** The alarm trigger that the same event also sets off, if any (alarm then takes the larger of the two, not their sum). */
  cause?: string;
  /** How long ago the raw event happened, in ms (for timing the reaction). Default: 0. */
  msAgo?: number;
}

/** One kind of sudden event. Returns what happened, and how strongly, when it happens. */
export interface StartleDetector {
  name: string;
  check(moment: BrainstemMoment): StartleHit | null;
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
  /** b: how dark it is here and how strongly this place is remembered as bad, each 0 to 1. Default: neither. */
  surroundings?(state: State): { dark: number; badPlace: number };
  /** d: everything in view, for matching loaded responses. */
  thingsOf(state: State): Thing[];
  /** d: why a loaded response may not use a skill (unknown, a primitive, reflex-only), or null if it may. */
  responseProblem(skill: string): string | null;
  /** d: whether a skill could be started right now with no target (a prepared response that cannot is not released). Default: always. */
  canStart?(skill: string): boolean;
  /** d: whether a skill can be aimed at a target right now. */
  acceptsTarget(skill: string, target: string): boolean;
  /** d: the names a goal may hold back (soft reflexes and the skills they propose). */
  holdable: string[];
  /** b: how awake the body is, 0 to 1 (the reticular formation's arousal, as last shared): a drowsy body startles a little less, an over-aroused one a little more. Default: 0.5. */
  arousalOf?(ws: Workspace): number;
  /** f: the body's levels, or null before the first state. */
  body(state: State): Body | null;
  /** f: what the body's balance and posture did this tick, for the trace. Asked once a tick. Default: nothing. */
  postureNotes?(state: State): Record<string, unknown> | null;
  /**
   * g: the defence chosen for this state, each threat as it was sized up, and anything else to
   * log (what was learned, what the checks cost). Null before the first state. Default: no defence signals.
   */
  defence?(state: State): { choice: Choice; threats: Threat[]; notes?: Record<string, unknown> } | null;
  /** g: the skills that are a flight or a fight: while one runs, the body is still defending whatever this tick's mode. Default: none. */
  activeDefences?: string[];
  /** g: how far pain is dulled while defending (0 never), and whether the body rests to recover after. Default: both on. */
  defenceStrengths?: { analgesia: number; recuperate: number };
  /** The skills proposed for a full startle and for a flinch. (Turning to look at things is the colliculus's job.) */
  skills: { brace: string; flinch: string };
  /** Default: "brainstem". */
  name?: string;
  /** Default: 0 (runs inside every tick). */
  layer?: number;
}

/** A flinch is proposed below 1, so it can never take over from a hard reflex's skill. */
const FLINCH_URGENCY = 0.9;
/** Being stuck fades from the signal with this time constant: about gone after 5 seconds. */
const STUCK_TAU_SECONDS = 1.7;
/** How far arousal moves a startle's strength: down to this much less when drowsy, and this much more when over-aroused. */
const AROUSAL_STARTLE = { drowsy: 0.2, overAroused: 0.1, drowsyBelow: 0.35, overAbove: 0.9, resting: 0.5 };

/** A startle's strength is scaled by how awake the body is. Alarm already enlarges a startle (potentiation), so the upper side is small and starts only above 0.9. */
export function arousalStartleFactor(arousal: number, strength = 1): number {
  const { drowsy, overAroused, drowsyBelow, overAbove, resting } = AROUSAL_STARTLE;
  if (arousal < resting) return 1 - strength * drowsy * Math.min(1, (resting - arousal) / (resting - drowsyBelow));
  return arousal > overAbove ? 1 + strength * overAroused * Math.min(1, (arousal - overAbove) / (1 - overAbove)) : 1;
}

/**
 * The brainstem: keeps the body going and reacts before the rest of the brain has noticed. It
 * proposes little; mostly it shares signals. (It also supplies the reflex gains: see `createReflexGain`.)
 *   b) startle: a sudden event gives a startle sized by how strong it was and by the state the
 *      body is in (see startle.ts). A small one is a flinch (a moment's freeze, then carry on);
 *      a big one a full brace toward where it came from, or the release of a response the goal
 *      prepared. `startle` is shared as its size for that tick;
 *   (c, orienting, moved to the colliculus region);
 *   d) loaded responses: fires a response the goal loaded in advance the moment its thing appears;
 *      reports loaded responses and hold-backs it had to ignore;
 *   (e, the arousal gate, moved to the reticular region);
 *   f) body signals: shares `stuck`, `sore` and `unsteady` (the vital signs are the medulla's);
 *   g) defence signals: shares `threat` and `wary` from the defence chosen this tick (the defence
 *      reflexes themselves fire in the reflex region), `analgesia` while fleeing or fighting, and
 *      `recovering` while resting after.
 * Everything it does is in the trace.
 */
export function createBrainstemRegion(options: BrainstemOptions): Region {
  const { settings, skills, name = "brainstem", layer = 0 } = options;
  const loaded = createLoadedResponses(options.responseProblem);
  let before: State | null = null;
  let stuck = 0;
  const startle = createStartle(settings);
  const defence = createDefenceState(options.defenceStrengths);
  let startleCause: string | null = null;
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

      // f) Body. (The medulla shares the vital signs.)
      const body = options.body(after);
      const was = before ? options.body(before) : null;
      const dt = before ? Math.max(0, now - before.timestamp) / 1000 : 0;
      const hurt = body && was ? Math.max(0, was.health - body.health) : 0;
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

      // g) Defence: how pressing the danger is, and what defending does to the body.
      let defending = false;
      const reading = options.defence?.(after);
      if (reading) {
        const { choice, threats, notes } = reading;
        const felt = defence.step(choice, body?.health ?? 1, now, ws.current !== null && (options.activeDefences ?? []).includes(ws.current.skill));
        defending = felt.active;
        ws.setSignal(THREAT_SIGNAL, choice.threat);
        ws.setSignal(WARY_SIGNAL, choice.mode === "wary" || choice.mode === "avoid" ? 1 : 0);
        ws.setSignal(ANALGESIA_SIGNAL, felt.analgesia);
        ws.setSignal(RECOVERING_SIGNAL, felt.recovering ? 1 : 0);
        if (choice.mode !== "none" || felt.analgesia > 0.01 || felt.recovering || notes) {
          trace.defence = { mode: choice.mode, why: choice.why, target: choice.target, threat: choice.threat, flightDistance: choice.flightDistance, cornered: choice.cornered, coming: choice.coming, threats, analgesia: round(felt.analgesia), recovering: felt.recovering, ...notes };
        }
      }

      // b) Startle: the strongest sudden event this tick, sized.
      let startled: { by: string; source: Thing | null; size: "flinch" | "full"; magnitude: number } | null = null;
      if (startleCause) ws.setSignal(STARTLE_FROM + startleCause, 0);
      startleCause = null;
      if (settings.startle > 0) {
        const hits = moment ? options.startle.flatMap((detector) => { const hit = detector.check(moment); return hit ? [{ by: detector.name, hit }] : []; }) : [];
        const strongest = hits.sort((a, b) => b.hit.intensity - a.hit.intensity)[0];
        const awake = arousalStartleFactor(options.arousalOf?.(ws) ?? 0.5, settings.arousalStartle);
        const event = strongest && { kind: strongest.hit.kind ?? strongest.hit.source?.kind ?? strongest.by, intensity: Math.min(1, strongest.hit.intensity * awake), ...(strongest.hit.place ? { place: strongest.hit.place } : {}), foreseen: strongest.hit.foreseen ?? 0, selfCaused: strongest.hit.selfCaused ?? false };
        // Harm since the last tick: whatever startled lately was worth it (unless this is that same event again).
        if (hurt > 0) startle.harmed(now, event);
        if (strongest && event) {
          const edge = { alarm: options.alarmOf(ws), sore: defending ? 0 : (body?.sore ?? 0), ...(options.surroundings?.(after) ?? { dark: 0, badPlace: 0 }) };
          const judged = startle.judge(event, edge, hurt > 0, now);
          const { hit, by } = strongest;
          const eventToDecideMs = Math.max(0, Math.round(Date.now() - (now - (hit.msAgo ?? 0))));
          const report = { by, kind: event.kind, source: hit.source, intensity: round(hit.intensity), ...(awake === 1 ? {} : { arousal: round(awake) }), potentiation: round(judged.potentiation), warning: round(judged.warning), habituated: round(judged.habituated), selfCaused: judged.selfCaused, magnitude: round(judged.magnitude), ...(hit.cause ? { cause: hit.cause } : {}), eventAt: now - (hit.msAgo ?? 0), eventToDecideMs };
          // A flinch never cuts across a hard reflex's skill.
          const flinchBarred = judged.size === "flinch" && (options.hardReflex?.(ws) ?? false);
          if (judged.size === "none" || flinchBarred) trace.startleQuiet = { ...report, why: flinchBarred ? "a hard reflex is acting" : judged.silenced };
          else {
            startled = { by, source: hit.source, size: judged.size, magnitude: judged.magnitude };
            trace.startle = { ...report, size: judged.size };
            if (hit.cause) ws.setSignal(STARTLE_FROM + (startleCause = hit.cause), judged.magnitude);
          }
        }
        ws.setSignal(STARTLE_SIGNAL, startled?.magnitude ?? 0);
      }
      const facing = startled?.source ? { target: startled.source.id } : {};

      // d) Loaded responses, and hold-backs the goal asked for that cannot be honoured.
      let released = false;
      if (settings.loadedResponses > 0) {
        const { fire, dropped } = loaded.observe(ws.goal, options.thingsOf(after), now, startled?.source, startled?.size === "full" && settings.startReact > 0, (rule) => options.canStart?.(rule.skill) ?? true);
        if (dropped) trace.droppedResponses = dropped;
        ws.setSignal(LOADED_SIGNAL, fire ? 1 : 0);
        if (fire) {
          const target = fire.thing && options.acceptsTarget(fire.rule.skill, fire.thing.id) ? { target: fire.thing.id } : {};
          released = fire.released ?? false;
          trace.loadedResponse = { when: fire.rule.when, skill: fire.rule.skill, thing: fire.thing?.id ?? null, ...(released ? { releasedByStartle: true } : {}) };
          // A response released by a startle goes off in the startle's place, at its urgency.
          proposals.push({ action: { skill: fire.rule.skill, ...target }, urgency: released ? 1 : LOADED_URGENCY, reason: released ? `startled (${startled!.by}): releasing the prepared ${fire.rule.skill}` : `loaded response: ${fire.rule.when} appeared` });
          if (released) (trace.startle as Record<string, unknown>).released = fire.rule.skill;
        }
      }
      if (startled && !released) {
        const full = startled.size === "full";
        proposals.push({ action: { skill: full ? skills.brace : skills.flinch, ...facing }, urgency: full ? 1 : FLINCH_URGENCY, reason: `${full ? "startled" : "flinched"}: ${startled.by} (${round(startled.magnitude)})` });
      }
      if (ws.goal && ws.goal.setAt !== checkedGoal) {
        checkedGoal = ws.goal.setAt;
        const ignored = ws.goal.holdBack.filter((h) => !options.holdable.includes(h.name)).map((h) => h.name);
        if (ignored.length) trace.ignoredHoldBack = ignored;
        const held = settings.holdBack > 0 ? ws.goal.holdBack.filter((h) => options.holdable.includes(h.name)) : [];
        // A hold-back in full with no end is logged by its name, as before; one with a strength or an end in full.
        if (held.length) trace.holdingBack = held.map((h) => (h.strength === 1 && h.until === undefined ? h.name : { name: h.name, strength: h.strength, ...(h.until === undefined ? {} : { until: h.until }) }));
      }

      before = after;
      return { proposals, trace };
    },
  };
}

const round = (n: number) => Math.round(n * 100) / 100;
