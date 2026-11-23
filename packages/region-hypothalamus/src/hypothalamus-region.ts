import type { BodyClock, NeedReading, Region, State, Workspace } from "@familiar/contracts";
import { AHEAD, createLookAhead } from "./ahead.js";
import { clockGain, readClock, type DayTime } from "./clock.js";
import { createTopDrive, desperateOf } from "./compete.js";
import type { Need } from "./need.js";
import { pressing, readNeeds, tuned } from "./read.js";
import { DRIVES_OFF, type DriveSettings } from "./settings.js";
import { DESPERATE_SIGNAL, STRESS_SIGNAL, UNMET_SIGNAL } from "./signals.js";
import { createStress, loadOf, stressGain, type Load } from "./stress.js";
import { LEARNING, targetNow, type Adjustment, type TargetMemory } from "./targets.js";

export interface HypothalamusOptions {
  /** The body's needs. Add or remove one to change what the bot can come to want. */
  needs: readonly Need[];
  /** Needs that live inside one region (boredom): read and tuned here, shared apart from the rest. Default: none. */
  inner?: readonly Need[];
  /** This bot's drives. Default: every part off (the needs are read as they stand). */
  settings?: DriveSettings;
  /** What loads the body besides its needs: the alarm of the moment, pain, how poor the vital signs are. Default: nothing. */
  load?(ws: Workspace): Partial<Omit<Load, "threat">>;
  /** The time of day. Default: the body has no clock. */
  dayTime?(state: State): DayTime | null;
  /** What moves a target with the moment. Default: nothing. */
  adjustments?: readonly Adjustment<State, BodyClock>[];
  /** What was learned about how much is enough. Default: nothing is. */
  targets?: TargetMemory;
  /** Whether the running skill has been learned to relieve this need. Default: never. */
  relieving?(ws: Workspace, need: string): boolean;
  /** Whether anything the bot has learned relieves this need. Default: not known, so nothing is ever called unmet. */
  relief?(ws: Workspace, need: string): boolean;
  /** A number that changes when the body is a new one (its deaths): nothing is carried across. Default: never. */
  life?(state: State): number | null;
  /** Default: "hypothalamus". */
  name?: string;
  /** Default: 0 (runs inside every tick). */
  layer?: number;
}

/** A tick taking longer than this is logged as slow. */
const SLOW_MS = 2;
const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * The hypothalamus: the one place that owns the body's needs. Each tick it reads every need
 * once and shares the reading as the workspace's `needs`, for every region listed after it to
 * use: dopamine (what a change is worth, and what to want), serotonin (the outlook), noradrenaline
 * (alarm and search), the reticular formation (the clock) and the arbiter. On top of the plain
 * levels it works out
 *   - how much is enough right now (targets.ts), and learns it from running out;
 *   - where each need is heading, so a rising one presses early (ahead.ts);
 *   - the time of day, and what presses when (clock.ts);
 *   - slow stress (stress.ts), shared as `stress`;
 *   - which need the body wants most, whether one is desperate (`desperate`), and whether
 *     nothing learned relieves the top one (`unmet`) (compete.ts).
 * It proposes no action and never calls a model: it says how things stand, and the rest of the
 * brain chooses. Left out, each reader works the plain reading out from the state.
 */
/** A gain as the trace says it: to two places, so that a change too small to show is not given as a reason. */
const said = (gain: number) => Math.round(gain * 100) / 100;

export function createHypothalamusRegion(options: HypothalamusOptions): Region {
  const { needs, inner = [], settings = DRIVES_OFF, name = "hypothalamus", layer = 0 } = options;
  const ahead = createLookAhead();
  const stress = createStress();
  const top = createTopDrive();
  const defined = new Map([...needs, ...inner].map((n) => [n.name, n]));
  let worstMs = 0;
  let life: number | null = null;
  /** The needs that were short last tick (null: not known yet, so nothing is learned from the first look). */
  let wasShort: Set<string> | null = null;

  return {
    name,
    layer,
    everyMs: 0,
    run(ws) {
      const started = performance.now();
      const { state } = ws;
      const now = state.timestamp;
      const notes: Record<string, unknown> = {};
      // A new body carries nothing over: no rates, no top drive, no shortage.
      const lives = options.life?.(state) ?? null;
      const fresh = life !== null && lives !== life;
      life = lives;
      if (fresh) {
        ahead.reset();
        top.reset();
        wasShort = null;
      }

      const dayTime = settings.clock > 0 ? (options.dayTime?.(state) ?? null) : null;
      const clock: BodyClock | null = dayTime && readClock(dayTime);
      const signalOf = (signal: string) => ws.signals[signal]?.value;
      const context = {
        signal: signalOf,
        settings,
        clock,
        targetOf: (need: Need) => {
          const times = (options.adjustments ?? []).filter((a) => a.need === need.name).map((a) => a.times(state, clock));
          return targetNow(need.target ?? 0, times, options.targets?.get(need.name, now) ?? 1, settings);
        },
      };
      const read = readNeeds(needs, state, context);
      const own = readNeeds(inner, state, context);

      // Running out of a thing while the need it is kept for presses teaches that enough was not enough.
      const short = new Set(
        read.filter((r) => {
          const served = read.find((other) => other.name === defined.get(r.name)!.serves);
          return r.target !== undefined && r.level >= 1 && served !== undefined && served.level > LEARNING.pressingAbove;
        }).map((r) => r.name),
      );
      if (settings.learnTargets > 0 && options.targets && !fresh && wasShort) {
        for (const need of short) {
          if (wasShort.has(need)) continue;
          const times = options.targets.shortage(need, now);
          notes.learned = [...((notes.learned as string[] | undefined) ?? []), `${need}: ran out with ${defined.get(need)!.serves} pressing, enough is now ${round(times)}× the usual`];
        }
      }
      wasShort = short;

      // Stress: the slow cost of strain. A threat counts by how close it is (the vital needs).
      const load = loadOf({ alarm: 0, pain: 0, poorVitals: 0, ...options.load?.(ws), threat: Math.max(0, ...read.filter((r) => r.rank > 0).map((r) => r.level)) });
      const stressed = settings.stress > 0 ? settings.stress * stress.update(load.value, now) : 0;

      // How hard each presses: where it is heading, the time of day, stress, and what is already under way.
      const why = new Map<string, string[]>();
      const tune = (r: NeedReading): NeedReading => {
        const need = defined.get(r.name)!;
        const projected = settings.lookAhead > 0 ? ahead.project(r.name, r.level, now, need.coming?.(state, { signal: signalOf, target: r.target ?? 0, clock })) : undefined;
        const relieving = settings.lookAhead > 0 && r.level > 0 && (options.relieving?.(ws, r.name) ?? false);
        const press = tuned(need, r.level, { ...(projected === undefined ? {} : { projected }), clock, stress: stressed, relieving, settings }, AHEAD.easing);
        // (Only for a need that is there to be eased: one at 0 has nothing to say.)
        why.set(r.name, r.level <= 0 && press <= 0 ? [] : [...(press > r.level ? ["looking ahead"] : []), ...(relieving ? [`eased: ${ws.current?.skill} is under way`] : []), ...(said(clockGain(need.by, clock, settings.clock)) < 1 ? [`less by ${need.by === "day" ? "night" : "day"}`] : []), ...(said(stressGain(need.spare, stressed, settings.stress)) < 1 ? ["less under stress"] : [])]);
        return { ...r, ...(projected === undefined ? {} : { projected }), pressing: press, tuned: press };
      };
      const all = pressing([...read, ...own].map(tune));
      for (const r of all) if (r.pressing === 0 && r.level > 0) why.set(r.name, [`silenced by ${all.find((other) => other.rank > r.rank && other.level > 0)?.name}`]);
      const readings = all.slice(0, read.length);
      const innerReadings = all.slice(read.length);

      const leader = top.step(readings, now);
      const desperate = desperateOf(readings);
      // Unmet: the body wants something and has learned nothing that relieves it.
      const unmet = leader !== null && options.relief !== undefined && !options.relief(ws, leader.name);
      if (settings.stress > 0) ws.setSignal(STRESS_SIGNAL, stressed);
      if (settings.desperate > 0) ws.setSignal(DESPERATE_SIGNAL, settings.desperate * desperate.value);
      if (settings.unmet > 0) ws.setSignal(UNMET_SIGNAL, unmet ? settings.unmet * leader.score : 0);
      ws.setNeeds({ readings, ...(inner.length ? { inner: innerReadings } : {}), top: leader, ...(clock ? { clock } : {}), ...(settings.stress > 0 ? { stress: stressed } : {}), desperate: settings.desperate > 0 ? desperate.name : null, ...(settings.unmet > 0 ? { unmet } : {}) });

      const ms = performance.now() - started;
      worstMs = Math.max(worstMs, ms);
      if (ms > SLOW_MS) notes.slow = `this tick took ${round(ms)} ms (the limit is ${SLOW_MS})`;
      const shown = (r: NeedReading) => [r.name, { level: round(r.level), pressing: round(r.pressing), ...(r.projected !== undefined && r.projected > r.level ? { projected: round(r.projected) } : {}), ...(r.target === undefined ? {} : { target: round(r.target) }), ...(why.get(r.name)?.length ? { why: why.get(r.name)!.join("; ") } : {}) }];
      return {
        proposals: [],
        trace: {
          needs: Object.fromEntries(all.map(shown)),
          top: leader && { name: leader.name, kind: leader.kind, score: round(leader.score), ...(unmet ? { unmet: true } : {}) },
          ...(settings.stress > 0 ? { stress: round(stressed), load: round(load.value), loadBy: load.by } : {}),
          ...(clock ? { clock: { phase: round(clock.phase), night: clock.night, dusk: round(clock.dusk), dawn: round(clock.dawn) } } : {}),
          ...(desperate.name ? { desperate: { need: desperate.name, value: round(desperate.value) } } : {}),
          ...notes,
          worstMs: Math.round(worstMs * 100) / 100,
        },
      };
    },
  };
}

