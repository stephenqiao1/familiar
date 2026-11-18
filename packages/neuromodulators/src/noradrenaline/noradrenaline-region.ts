import type { Region, SkillEvent, State, Workspace } from "@familiar/contracts";
import { createAlarm } from "./alarm.js";
import { createSearch, createSearchInputs, noveltyBump, type SearchInput } from "./search.js";
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

/** What an alarm trigger looks at: the last tick's state, this tick's, and the workspace. */
export interface AlarmMoment {
  before: State;
  after: State;
  ws: Workspace;
}

/** One thing that raises alarm: how much to add right now (0 to 1), or 0. */
export interface AlarmTrigger {
  name: string;
  check(moment: AlarmMoment): number;
  /**
   * The name of another trigger that this one shares its cause with on this tick, or null. The two
   * are then one event: alarm takes the larger of them, not their sum. Default: never.
   */
  sameCauseAs?(moment: AlarmMoment): string | null;
}

export interface NoradrenalineOptions {
  /** What raises alarm. Add or remove one to change what alarms the bot. */
  triggers: AlarmTrigger[];
  /** Whether a threat is present right now; alarm does not fade while one is. */
  threatPresent(state: State): boolean;
  settings: NoradrenalineSettings;
  /** What moves search. Default: reward trend, failed predictions and goal progress. */
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

// Alarm effect a: who is in charge.
const OFFLINE_ABOVE = 0.8;
const BACK_ONLINE_BELOW = 0.5;
/** The planner's weight comes back over about this long, not at once. */
const RECOVERY_SECONDS = 10;
// Alarm effect b: interrupt and re-plan.
const JUMP = 0.5;
const JUMP_WINDOW_MS = 1000;
const INTERRUPT_GAP_MS = 20_000;
const CALM_BELOW = 0.5;
// Search effect c: tell the planner.
const RETHINK_ABOVE = 0.7;
const RETHINK_AFTER_MS = 30_000;
const RETHINK_COOLDOWN_MS = 120_000;
// Guardrails.
const PANIC_AFTER_MS = 60_000;
const GUARD_WINDOW_MS = 300_000;
const MAX_INTERRUPTS = 5;
const JUMPY_THRESHOLD = 0.7;
const MAX_SWITCHES = 4;
const SWITCHING_ABOVE = 0.6;

/**
 * Noradrenaline: two dials, shared as signals each tick.
 *
 * Alarm (fast): raised at once by its triggers, fading once no threat is present. It
 *   a) takes the planner out of charge: weight = 1 − alarm²; above 0.8 the planner goes offline
 *      until alarm is back under 0.5, and its weight then returns over about 10 seconds;
 *   b) on a jump of more than 0.5 within a second, fires an interrupt (at most one per 20 s): the
 *      goal is cleared, and once alarm is under 0.5 the planner is asked to plan afresh;
 *   and its level and jumps are read by the loop (faster ticks), memory and patience.
 *
 * Search (slow): pushed up when the current goal stops paying off, pulled down by steady success.
 *   It eases switching away from the running skill, widens the options offered, and after 30 s
 *   above 0.7 tells the planner to rethink (at most once per 2 minutes).
 *
 * Guardrails: a retreat goal after a minute of very high alarm; a higher jump threshold after too
 * many interrupts; half the switching effect after too many switches. It never proposes an action,
 * and nothing here touches a full-urgency reflex.
 */
export function createNoradrenalineRegion(options: NoradrenalineOptions): Region {
  const { triggers, threatPresent, settings, searchInputs = createSearchInputs(), name = NORADRENALINE, layer = 0 } = options;
  const retreatGoal = options.retreatGoal ?? { text: "Retreat to safety: get away from the danger and somewhere secure.", steps: [] };
  const alarm = createAlarm(settings);
  const search = createSearch(settings);
  const novelty = noveltyBump();
  const on = (effect: number) => effect > 0;

  let before: State | null = null;
  let lastAt: number | null = null;
  let recent: { at: number; level: number }[] = [];
  let offline = false;
  let weight = 1;
  let interrupts: number[] = [];
  let jumpyUntil = -Infinity;
  let pendingReplan = false;
  let veryHighSince: number | null = null;
  let panicked = false;
  let searchHighSince: number | null = null;
  let rethinkAt = -Infinity;
  let rethinking: { goalSetAt: number | null } | null = null;
  let switches: number[] = [];
  let hoppingUntil = -Infinity;
  const seenEvents = new WeakSet<SkillEvent>();

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

      // Alarm.
      const raisedBy: Record<string, number> = {};
      const sameCause: Record<string, string> = {};
      if (before) {
        const moment = { before, after, ws };
        for (const trigger of triggers) {
          const bump = trigger.check(moment);
          if (bump > 0) raisedBy[trigger.name] = bump;
        }
        // Two triggers set off by one event count once, at the larger: the second adds only what it has over the first.
        for (const trigger of triggers) {
          const other = raisedBy[trigger.name] !== undefined ? trigger.sameCauseAs?.(moment) : null;
          if (!other || raisedBy[other] === undefined) continue;
          const over = raisedBy[trigger.name]! - raisedBy[other];
          if (over > 0) raisedBy[trigger.name] = over;
          else delete raisedBy[trigger.name];
          sameCause[trigger.name] = other;
        }
      }
      before = after;
      const threat = threatPresent(after);
      const level = alarm.update(Object.values(raisedBy).reduce((sum, b) => sum + b, 0), threat, now);

      // A jump: alarm rose by more than the threshold within the last second.
      recent = [...recent.filter((r) => now - r.at <= JUMP_WINDOW_MS), { at: now, level }];
      const threshold = now < jumpyUntil ? JUMPY_THRESHOLD : JUMP;
      const jumped = level - Math.min(...recent.map((r) => r.level)) > threshold;
      if (jumped) recent = [{ at: now, level }];

      // Effect b: interrupt, then re-plan once calm.
      interrupts = interrupts.filter((at) => now - at <= GUARD_WINDOW_MS);
      const interrupt = on(settings.interrupt) && jumped && now - (interrupts.at(-1) ?? -Infinity) >= INTERRUPT_GAP_MS;
      if (interrupt) {
        interrupts.push(now);
        // A goal that prepared for trouble (it loaded a response or holds a reflex back) is kept:
        // cancelling it at the first fright would undo the very thing it was set up for.
        const prepared = ws.goal !== null && (ws.goal.ifThen.length > 0 || ws.goal.holdBack.length > 0);
        if (prepared) notes.keptGoal = "the goal prepared for this (loaded response or hold-back), so it stays";
        else ws.clearGoal();
        pendingReplan = true;
        if (interrupts.length > MAX_INTERRUPTS) {
          jumpyUntil = now + GUARD_WINDOW_MS;
          notes.jumpy = `${interrupts.length} interrupts in 5 minutes: needing a bigger jump for the next 5`;
        }
      }
      if (pendingReplan && ws.goal !== null) pendingReplan = false;

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

      // Guardrail: goal-hopping. Count skills dropped for another while search is high.
      const fresh = ws.recentEvents.filter((e) => !seenEvents.has(e));
      for (const e of fresh) seenEvents.add(e);
      const dropped = fresh.filter((e) => e.type === "interrupted").length;
      switches = switches.filter((at) => now - at <= GUARD_WINDOW_MS);
      if (searching > SWITCHING_ABOVE) for (let i = 0; i < dropped; i++) switches.push(now);
      if (switches.length > MAX_SWITCHES && now >= hoppingUntil) {
        hoppingUntil = now + GUARD_WINDOW_MS;
        switches = [];
        notes.goalHopping = "over 4 switches in 5 minutes with search high: halving its effect on switching for 5 minutes";
      }
      const switching = settings.switching * (now < hoppingUntil ? 0.5 : 1);

      ws.setSignal(ALARM_SIGNAL, level);
      ws.setSignal(SEARCH_SIGNAL, searching);
      ws.setSignal(PLANNER_WEIGHT_SIGNAL, weight);
      ws.setSignal(PLANNER_OFFLINE_SIGNAL, plannerOffline ? 1 : 0);
      ws.setSignal(ALARM_JUMP_SIGNAL, jumped ? 1 : 0);
      ws.setSignal(INTERRUPT_SIGNAL, interrupt ? 1 : 0);
      const asked = options.replanWhen?.(ws) ?? false;
      if (asked) notes.replanAsked = true;
      ws.setSignal(REPLAN_SIGNAL, (pendingReplan && level < CALM_BELOW) || rethinking || asked ? 1 : 0);
      ws.setSignal(RETHINK_SIGNAL, rethinking ? 1 : 0);
      ws.setSignal(SWITCHING_SIGNAL, NEUTRAL_SEARCH + (searching - NEUTRAL_SEARCH) * switching);

      return {
        proposals: [],
        trace: {
          alarm: level,
          ...(Object.keys(raisedBy).length ? { raisedBy } : {}),
          ...(Object.keys(sameCause).length ? { sameCause } : {}),
          threat,
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
