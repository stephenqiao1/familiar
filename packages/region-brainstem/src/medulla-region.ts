import type { Region, State, Workspace } from "@familiar/contracts";
import { fireRules, type ReflexOptions, type ReflexRule } from "@familiar/region-reflex";
import { AIR_SIGNAL, COLD_SIGNAL, HUNGER_SIGNAL, HURT_SIGNAL, PAIN_SIGNAL, RESERVE_SIGNAL, SICK_SIGNAL, TIRED_SIGNAL, URGE_SIGNAL, VITALS_SIGNAL } from "./signals.js";

/** The body's readings right now. Each is 0 to 1, where 1 is the worst (except `health` and `reserve`, where 1 is full). */
export interface Vitals {
  /** Health as a share of full health. */
  health: number;
  /** How short of breath. */
  air: number;
  /** How hungry. */
  hunger: number;
  /** How sick. */
  sick: number;
  /** How cold, if the body can feel it. */
  cold?: number;
  /** How tired. */
  tired: number;
  /** The food reserve, as a share of its maximum. */
  reserve: number;
  /** How many times the body has died: a new body's signs start afresh. */
  deaths?: number;
}

export interface MedullaOptions {
  /** The body's readings, or null before the first state. */
  vitals(state: State): Vitals | null;
  /** Share the vital signs as signals. On above 0. */
  share: number;
  /**
   * The graded urges of upkeep (the urge to breathe, to eat enough to heal, to take a cure): soft
   * rules, so the layers above can outvote them and a goal can hold them back. Default: none.
   */
  urges?: ReflexRule[];
  /** How strongly each urge fires right now. Default: 1. */
  gainOf?: ReflexOptions["gainOf"];
  /**
   * How far pain is dulled right now, 0 to 1 (the defence circuit's analgesia). Only the shared
   * `pain` signal is scaled: the readings, the urges and the hard reflexes see the damage as it is. Default: 0.
   */
  analgesiaOf?(ws: Workspace): number;
  /** Whether the body is asleep (an urge that fires then may wake it). Default: never. */
  asleep?(ws: Workspace): boolean;
  /** Default: "medulla". */
  name?: string;
  /** Default: 0 (runs inside every tick). */
  layer?: number;
}

/** Pain fades with this time constant: about gone after 10 seconds. */
const PAIN_TAU_SECONDS = 3.3;
/** Losing this share of full health at once is full pain. */
const FULL_PAIN = 1 / 3;
/** How much of the overall number the single worst reading decides; the rest is the average. */
const WORST_WEIGHT = 0.8;

/** One overall number from the readings (each 0 fine to 1 worst): 1 when all is well, pulled down mostly by the worst. */
export function overall(badness: number[]): number {
  if (badness.length === 0) return 1;
  const worst = Math.max(...badness);
  const mean = badness.reduce((sum, b) => sum + b, 0) / badness.length;
  return Math.min(1, Math.max(0, 1 - (WORST_WEIGHT * worst + (1 - WORST_WEIGHT) * mean)));
}

/**
 * The medulla: the body's automatic upkeep, and its report upward. Every tick, whether or not
 * the rest of the brain is paying attention (it keeps running while the bot sleeps), it
 *   - reads the body and shares its vital signs: `air`, `hunger`, `pain`, `hurt`, `sick`,
 *     `cold`, `tired`, `reserve`, and one overall number, `vitals`;
 *   - checks the graded urges of upkeep and proposes what they ask for. They are soft: a goal can
 *     hold one back (holding your breath on purpose), until a hard reflex elsewhere takes over.
 *     The strongest urge is shared as `urge`.
 * It never calls a model and never waits on another region. Everything is in the trace.
 *
 * HOOK(drives): the vital signs are only shared here. A later drives region will read them from
 * the workspace (`ws.signals.vitals`, `ws.signals.hunger`, ...) to decide what the body wants.
 */
export function createMedullaRegion(options: MedullaOptions): Region {
  const { urges = [], name = "medulla", layer = 0 } = options;
  let before: { at: number; health: number; deaths: number } | null = null;
  let pain = 0;

  return {
    name,
    layer,
    everyMs: 0,
    run(ws) {
      const now = ws.state.timestamp;
      const body = options.vitals(ws.state);
      const trace: Record<string, unknown> = {};
      if (body) {
        const deaths = body.deaths ?? 0;
        // A new body starts with no pain.
        if (before && deaths > before.deaths) before = null;
        const dt = before ? Math.max(0, now - before.at) / 1000 : 0;
        const lost = before ? Math.max(0, before.health - body.health) : 0;
        pain = before ? Math.min(1, pain * Math.exp(-dt / PAIN_TAU_SECONDS) + lost / FULL_PAIN) : 0;
        before = { at: now, health: body.health, deaths };
        const hurt = 1 - body.health;
        const signs = { air: body.air, hunger: body.hunger, pain, hurt, sick: body.sick, ...(body.cold === undefined ? {} : { cold: body.cold }), tired: body.tired, reserve: body.reserve };
        const vitals = overall([body.air, body.hunger, hurt, body.sick, body.tired, ...(body.cold === undefined ? [] : [body.cold])]);
        trace.vitals = { ...signs, vitals };
        if (options.share > 0) {
          ws.setSignal(AIR_SIGNAL, body.air);
          ws.setSignal(HUNGER_SIGNAL, body.hunger);
          const dulled = Math.min(1, Math.max(0, options.analgesiaOf?.(ws) ?? 0));
          ws.setSignal(PAIN_SIGNAL, pain * (1 - dulled));
          if (dulled > 0) trace.painDulled = { felt: pain * (1 - dulled), analgesia: dulled };
          ws.setSignal(HURT_SIGNAL, hurt);
          ws.setSignal(SICK_SIGNAL, body.sick);
          if (body.cold !== undefined) ws.setSignal(COLD_SIGNAL, body.cold);
          ws.setSignal(TIRED_SIGNAL, body.tired);
          ws.setSignal(RESERVE_SIGNAL, body.reserve);
          ws.setSignal(VITALS_SIGNAL, vitals);
        }
      }
      const { proposals, fired, errors } = fireRules(urges, ws, options.gainOf);
      // How hard the body is asking: the arbiter uses it to loosen the hold of whatever is running.
      if (urges.length) ws.setSignal(URGE_SIGNAL, Math.max(0, ...proposals.map((p) => p.urgency)));
      if (fired.length) trace.urges = fired.map((f, i) => ({ ...f, why: proposals[i]!.reason }));
      // A need that crosses its threshold during sleep competes as usual, and may wake the body.
      if (fired.length && options.asleep?.(ws)) trace.urgeWhileAsleep = fired.map((f) => f.rule);
      if (Object.keys(errors).length) trace.errors = errors;
      return { proposals, trace };
    },
  };
}
