import type { Proposal, Region, State, Workspace } from "@familiar/contracts";
import type { Thing } from "../dopamine/cues.js";
import { createCuePulse } from "./cue-pulse.js";
import { createFocus, CUE_SIGNAL, FOCUS_SIGNAL, LOW_FOCUS } from "./focus.js";
import type { FocusSettings } from "./settings.js";

/** One thing that moves focus: above 0 pushes it up (what the bot knows is not to be trusted here), below 0 pulls it down (it is). From -1 to 1. */
export interface FocusInput {
  name: string;
  read(ws: Workspace, now: number): number;
}

/** A run this surprising counts as a prediction that failed outright. */
const FAILED_AT = 0.5;
/** What the bot last saw of its predictions counts for less as it ages: half as much after this long. */
const EVIDENCE_HALF_LIFE_MS = 120_000;

/**
 * How well the bot's predictions have been holding: each run that ends says how far the outcome
 * was from what was expected (`surpriseOf`, read once per run). Up while they are failing
 * (look closely, learn this now), down while they hold (assume, as usual). Recent runs count
 * most, and with no run lately there is no evidence either way (0).
 */
export function predictionsFailing(surpriseOf: (ws: Workspace) => { size: number; at: number } | null): FocusInput {
  let seenAt = -1;
  let failing = 0;
  let lastAt: number | null = null;
  return {
    name: "predictions_failing",
    read(ws, now) {
      const surprise = surpriseOf(ws);
      if (surprise && surprise.at !== seenAt && surprise.size > 0) {
        seenAt = surprise.at;
        const size = Math.min(1, surprise.size / FAILED_AT);
        failing = lastAt === null ? size : (failing + size) / 2;
        lastAt = now;
      }
      return lastAt === null ? 0 : 0.5 ** ((now - lastAt) / EVIDENCE_HALF_LIFE_MS) * (2 * failing - 1);
    },
  };
}

/** A thing that stood out this strongly or more raises focus, for this long (fading). */
const NOTICED = { atLeast: 0.5, ms: 5000 };

/**
 * Something just stood out (the colliculus's `orienting`, 0 to 1, read by `happened`): look
 * closely for a moment. Only a strong one counts, and it fades over a few seconds.
 */
export function justNoticed(happened: (ws: Workspace) => number): FocusInput {
  let last = { strength: 0, at: -Infinity };
  return {
    name: "just_noticed",
    read(ws, now) {
      const strength = happened(ws);
      if (strength >= NOTICED.atLeast && strength >= last.strength * Math.max(0, 1 - (now - last.at) / NOTICED.ms)) last = { strength, at: now };
      return last.strength * Math.max(0, 1 - (now - last.at) / NOTICED.ms);
    },
  };
}

export interface FocusOptions {
  /** What moves focus. Add or remove one to change what the bot pays attention to. */
  inputs: FocusInput[];
  settings: Pick<FocusSettings, "resting" | "timeConstantSeconds">;
  /** Whether the bot is asleep: focus is then forced to its lowest. Default: never. */
  asleep?(ws: Workspace): boolean;
  /** Whether the bot moved between two states, for the stale-world warning. Default: never. */
  moved?(before: State, after: State): boolean;
  /** Effect e: the things in view the bot has been looking for. Default: none (no cue pulses). */
  watched?(ws: Workspace): Thing[];
  /** Effect e: the skills that would act on a watched thing right now. Default: none. */
  skillsToward?(thing: Thing): string[];
  /** Extra notes for the log, e.g. remembered values used or rejected this tick. */
  notes?(): Record<string, unknown>;
  /** Default: "acetylcholine". */
  name?: string;
  /** Default: 0 (runs inside every tick). */
  layer?: number;
}

/** A cue's boost: the urgency its skill is proposed with, and for how long. */
const CUE_URGENCY = 0.6;
const CUE_BOOST_MS = 5000;
/** Guardrail: warn when focus stays under 0.2 this long while the bot is awake and moving. */
const STALE_AFTER_MS = 300_000;

/**
 * Acetylcholine: each tick it reads the focus inputs and moves focus toward them, sharing it as a
 * signal and logging every input. When something the bot was looking for is confirmed in view it
 * fires a cue pulse: a signal, and for a few seconds a proposal for the skill that acts on it.
 * Everything else focus changes is read from the signal by the parts it affects.
 */
export function createFocusRegion(options: FocusOptions): Region {
  const { inputs, settings, asleep = () => false, moved = () => false, watched, skillsToward = () => [], notes, name = "acetylcholine", layer = 0 } = options;
  const focus = createFocus(settings);
  const pulse = createCuePulse();
  let before: State | null = null;
  let staleSince: number | null = null;
  let boost: { thing: Thing; skill: string; until: number } | null = null;

  return {
    name,
    layer,
    everyMs: 0,
    run(ws) {
      const now = ws.state.timestamp;
      const read: Record<string, number> = {};
      for (const input of inputs) read[input.name] = Math.min(1, Math.max(-1, input.read(ws, now)));
      const sleeping = asleep(ws);
      const level = focus.update(Object.values(read).reduce((sum, v) => sum + v, 0), sleeping, now);
      ws.setSignal(FOCUS_SIGNAL, level);

      // Guardrail: running on assumptions. Low focus is fine at rest, not while out and about.
      const moving = before !== null && moved(before, ws.state);
      before = ws.state;
      if (level >= LOW_FOCUS || sleeping) staleSince = null;
      else if (moving) staleSince ??= now;
      const stale = staleSince !== null && now - staleSince >= STALE_AFTER_MS;

      // Effect e: the cue pulse.
      const inView = watched?.(ws) ?? [];
      const cue = pulse.observe(inView);
      const skill = cue && skillsToward(cue)[0];
      if (cue && skill) boost = { thing: cue, skill, until: now + CUE_BOOST_MS };
      if (boost && (now > boost.until || !inView.some((t) => t.id === boost!.thing.id))) boost = null;
      ws.setSignal(CUE_SIGNAL, cue ? 1 : 0);
      // A cue is not a wake event: it never gets a sleeping bot out of bed.
      const proposals: Proposal[] = boost && !sleeping
        ? [{ action: { skill: boost.skill, target: boost.thing.id }, urgency: CUE_URGENCY, reason: `spotted the ${boost.thing.kind} it was looking for` }]
        : [];

      return {
        proposals,
        trace: {
          focus: level,
          inputs: read,
          ...(sleeping ? { asleep: true } : {}),
          ...(cue ? { cue: cue.kind } : {}),
          ...(stale ? { warning: "focus has been very low for 5 minutes while awake and moving: the bot is running on assumptions" } : {}),
          ...notes?.(),
        },
      };
    },
  };
}
