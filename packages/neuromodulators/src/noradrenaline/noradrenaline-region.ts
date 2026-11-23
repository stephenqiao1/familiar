import type { NeedReading, Region, Workspace } from "@familiar/contracts";
import { createAlarm } from "./alarm.js";
import { createSearch, noveltyBump, type SearchInput } from "./search.js";
import type { NoradrenalineSettings } from "./settings.js";
import {
  ALARM_JUMP_SIGNAL,
  ALARM_SIGNAL,
  INTERRUPT_SIGNAL,
  NEUTRAL_SEARCH,
  PLANNER_OFFLINE_SIGNAL,
  PLANNER_WEIGHT_SIGNAL,
  REPLAN_SIGNAL,
  RETHINK_SIGNAL,
  SEARCH_SIGNAL,
  SWITCHING_SIGNAL,
} from "./signals.js";

export interface NoradrenalineOptions {
  /** The bot's needs right now (the same ones dopamine is paid for and patience follows): alarm is read from them. */
  needs(ws: Workspace): Pick<NeedReading, "name" | "level" | "rank" | "weight">[];
  /** The body's startle this tick, 0 to 1 (a bang, a blow out of nowhere). Default: none. */
  startle?(ws: Workspace): number;
  settings: NoradrenalineSettings;
  /** What moves search (see gettingNowhere). Default: nothing, so it rests. */
  searchInputs?: SearchInput[];
  /** Something else that calls for planning again this tick (the body was moved somewhere else, say). Default: nothing. */
  replanWhen?(ws: Workspace): boolean;
  /** The goal set when alarm stays very high for too long. */
  retreatGoal?: { text: string; steps: string[] };
  /** Default: "noradrenaline". */
  name?: string;
  /** Default: 0 (runs inside every tick). */
  layer?: number;
}

/** The region's name, also the `setBy` of the retreat goal it sets (which the planner's weight does not apply to). */
export const NORADRENALINE = "noradrenaline";

/** A startle of full size raises alarm by this (smaller ones in proportion). */
const STARTLED = 0.4;

// Alarm effect a: who is in charge.
const OFFLINE_ABOVE = 0.8;
const BACK_ONLINE_BELOW = 0.5;
/** The planner's weight comes back over about this long, not at once. */
const RECOVERY_SECONDS = 10;
// Alarm effect b: interrupt and re-plan.
const JUMP = 0.5;
const JUMP_WINDOW_MS = 1000;
const INTERRUPT_GAP_MS = 20_000;
// Search effect c: tell the planner.
const RETHINK_ABOVE = 0.7;
const RETHINK_AFTER_MS = 30_000;
const RETHINK_COOLDOWN_MS = 120_000;
// Guardrails.
const PANIC_AFTER_MS = 60_000;
const GUARD_WINDOW_MS = 300_000;
const MAX_INTERRUPTS = 5;
const JUMPY_THRESHOLD = 0.7;

/**
 * Noradrenaline: how much this moment calls for a change of course, read from evidence the
 * brain already has. Two dials, shared as signals each tick.
 *
 * Alarm (fast, "change now") follows the vital needs: it is never below what they press at, a
 *   need suddenly getting worse (or a startle) adds a jump, and it fades within seconds once the
 *   cause has gone. It
 *   a) takes the planner out of charge: weight = 1 − alarm²; above 0.8 the planner goes offline
 *      until alarm is back under 0.5, and its weight then returns over about 10 seconds;
 *   b) on a jump of more than 0.5 within a second, fires an interrupt (at most one per 20 s): the
 *      running skill is stopped. The goal is kept;
 *   and its level and jumps are read by the loop (faster ticks) and memory.
 *
 * Search (slow, "change soon") follows its inputs: up while a need presses and the bot is getting
 *   nowhere, down while things move. It eases switching away from the running skill, widens the
 *   options offered, and after 30 s above 0.7 tells the planner to rethink (at most once per 2
 *   minutes).
 *
 * Guardrails: a retreat goal after a minute of very high alarm; a higher jump threshold after too
 * many interrupts. It never proposes an action, and nothing here touches a full-urgency reflex.
 */
export function createNoradrenalineRegion(options: NoradrenalineOptions): Region {
  const { settings, searchInputs = [], name = NORADRENALINE, layer = 0 } = options;
  const retreatGoal = options.retreatGoal ?? { text: "Retreat to safety: get away from the danger and somewhere secure.", steps: [] };
  const alarm = createAlarm(settings);
  const search = createSearch(settings);
  const novelty = noveltyBump();
  const on = (effect: number) => effect > 0;

  /** Each need's level at the last tick. */
  let levels = new Map<string, number>();
  let lastAt: number | null = null;
  let recent: { at: number; level: number }[] = [];
  let offline = false;
  let weight = 1;
  let interrupts: number[] = [];
  let jumpyUntil = -Infinity;
  let veryHighSince: number | null = null;
  let panicked = false;
  let searchHighSince: number | null = null;
  let rethinkAt = -Infinity;
  let rethinking: { goalSetAt: number | null } | null = null;

  return {
    name,
    layer,
    everyMs: 0,
    run(ws) {
      const after = ws.state;
      const now = after.timestamp;
      const dt = lastAt === null ? 0 : Math.max(0, now - lastAt) / 1000;
      lastAt = now;
      const notes: Record<string, unknown> = {};

      // Alarm: never below what the vital needs press at; a need suddenly worse, or a startle, adds a jump.
      const needs = options.needs(ws);
      const sustained = Math.max(0, ...needs.filter((n) => n.rank > 0).map((n) => n.level));
      const raisedBy: Record<string, number> = {};
      for (const n of needs) {
        const worse = n.weight * (n.level - (levels.get(n.name) ?? n.level));
        if (worse > 0) raisedBy[n.name] = worse;
      }
      levels = new Map(needs.map((n) => [n.name, n.level]));
      const worsened = Math.min(1, Object.values(raisedBy).reduce((sum, w) => sum + w, 0));
      // A startle and the thing that set it off are one event: alarm takes the larger, not their sum.
      const startle = STARTLED * (options.startle?.(ws) ?? 0);
      if (startle > worsened) raisedBy.startle = startle;
      const level = alarm.update(sustained, settings.alarmGain * Math.max(worsened, startle), now);

      // A jump: alarm rose by more than the threshold within the last second.
      recent = [...recent.filter((r) => now - r.at <= JUMP_WINDOW_MS), { at: now, level }];
      const threshold = now < jumpyUntil ? JUMPY_THRESHOLD : JUMP;
      const jumped = level - Math.min(...recent.map((r) => r.level)) > threshold;
      if (jumped) recent = [{ at: now, level }];

      // Effect b: interrupt. The running skill is stopped; the goal is kept, and stands again once alarm falls.
      interrupts = interrupts.filter((at) => now - at <= GUARD_WINDOW_MS);
      const interrupt = on(settings.interrupt) && jumped && now - (interrupts.at(-1) ?? -Infinity) >= INTERRUPT_GAP_MS;
      if (interrupt) {
        interrupts.push(now);
        if (interrupts.length > MAX_INTERRUPTS) {
          jumpyUntil = now + GUARD_WINDOW_MS;
          notes.jumpy = `${interrupts.length} interrupts in 5 minutes: needing a bigger jump for the next 5`;
        }
      }

      // Effect a: who is in charge.
      if (level > OFFLINE_ABOVE) offline = true;
      else if (level < BACK_ONLINE_BELOW) offline = false;
      const wanted = offline ? 0 : 1 - level ** 2;
      weight = on(settings.inCharge) ? Math.min(wanted, weight + dt / RECOVERY_SECONDS) : 1;
      const plannerOffline = on(settings.inCharge) && offline;

      // Guardrail: panic lock.
      veryHighSince = level > OFFLINE_ABOVE ? (veryHighSince ?? now) : null;
      if (veryHighSince === null) panicked = false;
      if (veryHighSince !== null && now - veryHighSince > PANIC_AFTER_MS && !panicked) {
        panicked = true;
        ws.setGoal({ ...retreatGoal, reason: "alarm has stayed very high for over a minute" });
        notes.panicLock = "alarm above 0.8 for over a minute: forcing a retreat to safety";
      }

      // Search.
      const inputs: Record<string, number> = {};
      for (const input of searchInputs) inputs[input.name] = input.read(ws, now);
      const searching = search.update(Object.values(inputs).reduce((sum, v) => sum + v, 0), novelty(ws), now);

      // Effect c: tell the planner the goal isn't paying off.
      searchHighSince = searching > RETHINK_ABOVE ? (searchHighSince ?? now) : null;
      const goalSetAt = ws.goal?.setAt ?? null;
      if (rethinking && goalSetAt !== rethinking.goalSetAt) rethinking = null;
      const due = searchHighSince !== null && now - searchHighSince >= RETHINK_AFTER_MS && now - rethinkAt >= RETHINK_COOLDOWN_MS;
      if (on(settings.tellPlanner) && due && !rethinking) {
        rethinking = { goalSetAt };
        rethinkAt = now;
        notes.rethink = "search above 0.7 for 30 seconds: telling the planner the goal isn't paying off";
      }

      ws.setSignal(ALARM_SIGNAL, level);
      ws.setSignal(SEARCH_SIGNAL, searching);
      ws.setSignal(PLANNER_WEIGHT_SIGNAL, weight);
      ws.setSignal(PLANNER_OFFLINE_SIGNAL, plannerOffline ? 1 : 0);
      ws.setSignal(ALARM_JUMP_SIGNAL, jumped ? 1 : 0);
      ws.setSignal(INTERRUPT_SIGNAL, interrupt ? 1 : 0);
      const asked = options.replanWhen?.(ws) ?? false;
      if (asked) notes.replanAsked = true;
      ws.setSignal(REPLAN_SIGNAL, rethinking || asked ? 1 : 0);
      ws.setSignal(RETHINK_SIGNAL, rethinking ? 1 : 0);
      ws.setSignal(SWITCHING_SIGNAL, NEUTRAL_SEARCH + (searching - NEUTRAL_SEARCH) * settings.switching);

      return {
        proposals: [],
        trace: {
          alarm: level,
          ...(Object.keys(raisedBy).length ? { raisedBy } : {}),
          sustained,
          plannerWeight: weight,
          ...(plannerOffline ? { plannerOffline: true } : {}),
          ...(interrupt ? { interrupt: true } : {}),
          search: searching,
          searchInputs: inputs,
          ...notes,
        },
      };
    },
  };
}
