import type { Proposal, Region, Workspace } from "@familiar/contracts";
import { asleepLevel, bandOf, BANDS, depthOf, GROGGY, rateOf, restful, sleepDrive, sleepyOf, stepArousal, targetOf, URGENT, wakeDrive, wakes, type Band } from "./arousal.js";
import type { ArousalSettings } from "./arousal-settings.js";
import { createBedtime, type Bed } from "./bedtime.js";
import { FULL } from "./startle.js";
import { AROUSAL_SIGNAL, DEPTH_SIGNAL, FRAZZLED_SIGNAL, PAIN_SIGNAL, QUIET_SIGNAL, RECOVERING_SIGNAL, SLEEPY_SIGNAL, STARTLE_SIGNAL, THREAT_SIGNAL, TIRED_SIGNAL, UPPER_PAUSED_SIGNAL, UPPER_RATE_SIGNAL, URGE_SIGNAL } from "./signals.js";

/** What the reticular formation needs to know of the moment. */
export interface Moment {
  night: boolean;
  /** How far through the night it is, 0 (dusk) to 1 (dawn). */
  nightProgress: number;
  /** Nothing threatening in view. */
  safe: boolean;
  /** Nothing to do: no skill running, or only resting. */
  idle: boolean;
  /** Not moving. */
  still: boolean;
  /** In bed, eyes shut. */
  asleep: boolean;
  /** A demanding skill is under way. */
  demanding: boolean;
  /** A risky skill is under way. */
  risky: boolean;
  /** Health as a share of full: a drop in it is a hurt, which always wakes. */
  health: number;
}

export interface ReticularOptions {
  settings: ArousalSettings;
  /** Alarm as last shared, 0 to 1. */
  alarmOf(ws: Workspace): number;
  /** Whether a hard reflex fired this tick. Default: never. */
  hardReflex?(ws: Workspace): boolean;
  /** The moment, or null before the first state. */
  moment(ws: Workspace): Moment | null;
  /** The skill that is going to bed, and why it cannot be started right now (or null if it can). Default: bed is never proposed. */
  bed?: Bed;
  /** Default: "reticular". */
  name?: string;
  /** Default: 0 (runs inside every tick). */
  layer?: number;
}

/** A threat at least this pressing (coming) leaves no room for sleepiness; one at least this pressing (seen) is not safe. */
const THREAT = { coming: 0.8, seen: 0.5 };
/** Something that drew the attention this recently is novel. */
const NOVEL_MS = 2000;
/** The band may change once in this long, except upward for danger. */
const BAND_HOLD_MS = 3000;
/** Drowsy, safe and still for this long is quiet rest. */
const QUIET_AFTER_MS = 60_000;
/** While asleep, staying asleep is proposed at 0.3 + 0.4 × depth. */
const STAY_ASLEEP = { base: 0.3, perDepth: 0.4 };
/** Grogginess is over once arousal is this close to where it is heading. */
const GROGGY_DONE = 0.03;

/**
 * The reticular formation: one continuous arousal level that says how awake the body is.
 *   - A wake drive (danger, pain, sudden events, body needs, novelty, demanding work) pushes it
 *     up fast; a sleep drive (sleep pressure × how restful the moment is) lets it sink slowly.
 *   - It shares `arousal`, `sleepy`, and while asleep `depth`.
 *   - Bedtime: sleepy enough, with nothing pressing, it proposes going to bed (see bedtime.ts).
 *   - Asleep it still listens: an event wakes it when its strength is above depth × 0.6. A hurt,
 *     a full startle or a hard reflex always wakes. A calm waking leaves it groggy for a while.
 *   - The graded gate: `upper_rate` says how often the deciding layers may be called (0 asleep,
 *     about 0.3 drowsy, 1 awake); `upper_paused` is "the rate is 0".
 *   - `quiet` after a minute drowsy, safe and still; `frazzled` while over-aroused.
 * Left out of the brain, arousal reads as 0.5 everywhere and nothing is ever paused.
 */
export function createReticularRegion(options: ReticularOptions): Region {
  const { settings, name = "reticular", layer = 0 } = options;
  const bedtime = createBedtime();
  let arousal = settings.resting;
  let at: number | null = null;
  let health: number | null = null;
  let band: Band = bandOf(arousal);
  let bandSince = -Infinity;
  let sleptSince: number | null = null;
  let groggy = false;
  let quietSince: number | null = null;

  return {
    name,
    layer,
    everyMs: 0,
    run(ws) {
      const moment = options.moment(ws);
      if (!moment) return { proposals: [] };
      const now = ws.state.timestamp;
      const seconds = at === null ? 0 : Math.max(0, now - at) / 1000;
      at = now;
      const level = (signal: string) => ws.signals[signal]?.value ?? 0;
      const proposals: Proposal[] = [];
      const hurt = health !== null && moment.health < health;
      health = moment.health;
      const hardReflex = options.hardReflex?.(ws) ?? false;

      // The two drives.
      const threat = level(THREAT_SIGNAL);
      const startle = level(STARTLE_SIGNAL);
      const novel = ws.attended !== null && now - ws.attended.since <= NOVEL_MS;
      const wake = wakeDrive({ alarm: options.alarmOf(ws), threat, startle, pain: level(PAIN_SIGNAL), urge: level(URGE_SIGNAL), novel, demanding: moment.demanding });
      const strength = wakeDrive({ alarm: options.alarmOf(ws), threat, startle, pain: level(PAIN_SIGNAL), urge: level(URGE_SIGNAL) });
      const sleepy = sleepyOf(level(TIRED_SIGNAL), moment.night, threat >= THREAT.coming, settings.sleepPressure);
      const safe = moment.safe && threat < THREAT.seen;
      const rest = restful({ night: moment.night, safe, idle: moment.idle, recovering: level(RECOVERING_SIGNAL) > 0 });
      const sleep = sleepDrive(sleepy, rest);

      // Asleep, it still listens: what is strong enough wakes it.
      const depth = moment.asleep ? depthOf(moment.nightProgress) : 0;
      const forced = hurt ? "a hurt" : hardReflex ? "a hard reflex" : startle >= FULL ? "a startle" : null;
      const wokenBy = moment.asleep ? (forced ?? (wakes(strength.value, depth, settings.wakeThreshold) ? strength.by : null)) : null;
      const asleep = moment.asleep && wokenBy === null;
      const danger = forced !== null || wake.value > URGENT;
      let waking: Record<string, unknown> | undefined;
      if (asleep) sleptSince ??= now;
      else if (sleptSince !== null) {
        // Woken by something, or simply up (morning, or whatever got it out of bed).
        // The world may have got it out of bed already (a hurt throws a sleeper out): what did it still counts.
        waking = { by: wokenBy ?? forced ?? "getting up", strength: round(forced ? 1 : strength.value), depth: round(depth), sleptMs: now - sleptSince, calm: !danger };
        sleptSince = null;
        // Sleep inertia: groggy after a calm waking; danger brings it straight up.
        groggy = !danger && settings.inertia > 0;
        arousal = danger ? Math.max(arousal, settings.resting, targetOf(wake.value, sleep, settings.resting)) : settings.resting - settings.inertia * (settings.resting - GROGGY);
      }

      // The level.
      const target = asleep ? asleepLevel(depth) : targetOf(wake.value, sleep, settings.resting);
      if (groggy && (danger || asleep || arousal >= target - GROGGY_DONE)) groggy = false;
      if (!waking) arousal = stepArousal(arousal, target, seconds, groggy);
      // No flicker: the band changes at most once in 3 seconds, except upward for danger.
      const next = bandOf(arousal);
      const upward = [BANDS.drowsy, BANDS.awake, BANDS.alert, BANDS.overAroused].filter((b) => arousal >= b).length > ["asleep", "drowsy", "awake", "alert", "over-aroused"].indexOf(band);
      if (next !== band && (now - bandSince >= BAND_HOLD_MS || (upward && danger) || waking)) {
        band = next;
        bandSince = now;
      }
      ws.setSignal(AROUSAL_SIGNAL, arousal);
      ws.setSignal(SLEEPY_SIGNAL, sleepy);
      ws.setSignal(DEPTH_SIGNAL, asleep ? depth : 0);

      // The graded gate.
      const rate = 1 - settings.gate * (1 - rateOf(arousal, wake.value, asleep, settings.resting));
      ws.setSignal(UPPER_RATE_SIGNAL, rate);
      ws.setSignal(UPPER_PAUSED_SIGNAL, rate <= 0 ? 1 : 0);
      // With the deciding layers quiet, nothing else would speak for staying asleep: a light sleeper is easier to rouse.
      if (asleep && settings.gate > 0 && ws.current) {
        proposals.push({ action: { skill: ws.current.skill, ...(ws.current.target ? { target: ws.current.target } : {}) }, urgency: STAY_ASLEEP.base + STAY_ASLEEP.perDepth * depth, reason: `asleep (depth ${round(depth)}) and undisturbed` });
      }

      // Bedtime.
      const pressing = threat >= THREAT.seen ? "a threat is in view" : moment.risky ? "a risky skill is under way" : wake.value >= URGENT ? `something presses (${wake.by})` : null;
      const bed = settings.bedtime > 0 ? bedtime.step({ sleepy, wake: wake.value, pressing, inBed: moment.asleep, bed: options.bed ?? null, ws, now }) : null;
      if (bed?.proposal) proposals.push({ ...bed.proposal, urgency: bed.proposal.urgency * settings.bedtime });

      // Rest without sleep, and the far side of the inverted U.
      const drowsyAndStill = arousal < BANDS.awake && safe && moment.still && !danger;
      quietSince = drowsyAndStill ? (quietSince ?? now) : null;
      const quiet = settings.quietRest > 0 && quietSince !== null && now - quietSince >= QUIET_AFTER_MS;
      const frazzled = settings.frazzled > 0 && band === "over-aroused";
      ws.setSignal(QUIET_SIGNAL, quiet ? 1 : 0);
      ws.setSignal(FRAZZLED_SIGNAL, frazzled ? 1 : 0);

      const trace: Record<string, unknown> = {
        wake: { value: round(wake.value), by: wake.by },
        sleep: { value: round(sleep), sleepy: round(sleepy), restful: round(Math.min(1, rest)) },
        target: round(target),
        arousal: round(arousal),
        band,
        sleepy: round(sleepy),
        rate: round(rate),
        ...(asleep ? { asleep: true, depth: round(depth) } : {}),
        ...(groggy ? { groggy: true } : {}),
        ...(waking ? { waking } : {}),
        ...(bed?.note ? { bedtime: bed.note } : {}),
        ...(quiet ? { quiet: true } : {}),
        ...(frazzled ? { frazzled: true } : {}),
      };
      return { proposals, trace };
    },
  };
}


const round = (n: number) => Math.round(n * 100) / 100;
