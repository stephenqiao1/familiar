import type { SkillResult } from "@familiar/contracts";
import type { Bot } from "mineflayer";
import type { Vec3 } from "vec3";
import { sleepFor } from "../abort.js";
import { asExpected } from "../primitives/expect.js";
import { releaseKeys } from "../primitives/keys.js";
import { findDoorWay, passDoor } from "./door.js";
import { createStuckSense, recoveryFor } from "./feel.js";
import { canSprint, gaitOf, SPEED } from "./gait.js";
import { awayJourney, followJourney, goToJourney, type Planned } from "./journeys.js";
import { choosePattern } from "./patterns.js";
import { recover } from "./recover.js";
import { createRules, type RuleSets } from "./rules.js";
import { createStuckSpots } from "./spots.js";
import { farFrom, steer } from "./swim.js";
import { installTick } from "./tick.js";
import type { Drive, Gait, HeadOverride, Locomotion, LocomotionStatus, PatternName } from "./types.js";
import { createWalk } from "./walk.js";

export interface LocomotionOptions {
  /** Home: within `CAREFUL_NEAR_HOME` blocks of it the careful rules are used (no digging or placing). */
  home?: Vec3;
  /** Where the controller's notes go (pattern switches, recoveries, slow planning). Default: nowhere. */
  log?: (msg: string) => void;
  /** The two sets of pathing rules. Default: built for this bot (tests pass stand-ins). */
  rules?: (avoid: (pos: { x: number; y: number; z: number }) => boolean) => RuleSets;
}

/** What a journey expects when it works: not to overrun. Checked with the primitives' mechanism. */
const EXPECTS = ["late=false"] as const;
const DEFAULT_DRIVE: Drive = { speed: 0.4, caution: 0.3 };
const CAREFUL_ABOVE = 0.6;
const CAREFUL_NEAR_HOME = 16;
/** Following something, the bot sprints to catch up once it is this far beyond the range asked for. */
const CATCH_UP_BEYOND = 2;
/** How often the body is felt and the pattern checked: walking, and steering (which needs a finer hand). */
const POLL_MS = { walk: 250, steer: 100 };
const FEEL_MS = 250;
const PAUSE_POLL_MS = 25;
/** A journey is late once it has run past this many times its estimate; no estimate is under this long. */
const LATE_FACTOR = 2;
const MIN_ESTIMATE_MS = 2000;
/** Covering this much ground after a stumble means the recovery worked: the tries start again. */
const RECOVERED_AFTER = 3;
/** `stuck` stays up this long after giving up, so a once-a-tick reader sees it. */
const STUCK_SHOWN_MS = 1000;

/** The journey under way. */
interface Active {
  journey: Planned;
  cancel: AbortController;
  pattern: PatternName | null;
  finished: Promise<SkillResult>;
  startedAt: number;
  from: Vec3;
  last: Vec3;
  distance: number;
  switches: number;
  recoveries: string[];
  tries: number;
  stuckAt: Vec3 | null;
  recovering: boolean;
  paused: boolean;
  startGap: number;
  goalSetAt: number;
  doors: Set<string>;
  estimateMs: number | null;
}

/** Creates the bot's locomotion controller. One per bot: it installs itself on the bot's physics tick. */
export function createLocomotion(bot: Bot, options: LocomotionOptions = {}): Locomotion {
  const log = options.log ?? (() => {});
  const spots = createStuckSpots();
  const avoid = (pos: { x: number; y: number; z: number }) => spots.avoid(pos, Date.now());
  const rules = options.rules ? options.rules(avoid) : createRules(bot, avoid);
  const walk = createWalk(bot, log, () => Date.now());
  const sense = createStuckSense();
  let drive: Drive = { ...DEFAULT_DRIVE };
  let active: Active | null = null;
  let head: HeadOverride | null = null;
  let stuckUntil = 0;
  let usingCareful: boolean | null = null;
  let pausedUntil = 0;

  /** Falling this far behind what it follows, the bot sprints to catch up whatever its speed. */
  const fallenBehind = () => {
    const followed = active?.journey.entity;
    return followed !== undefined && followed.position.distanceTo(bot.entity.position) > active!.journey.range + CATCH_UP_BEYOND;
  };
  const gait = (): Gait => (!canSprint(bot.food) ? "walk" : fallenBehind() ? "sprint" : gaitOf(drive.speed));
  const careful = () => drive.caution > CAREFUL_ABOVE;
  /** Uses the careful rules when caution is high or home is close; only touches the pathfinder when that changes. */
  function applyRules(): void {
    const want = careful() || (options.home !== undefined && bot.entity.position.distanceTo(options.home) <= CAREFUL_NEAR_HOME);
    if (want === usingCareful) return;
    usingCareful = want;
    bot.pathfinder.setMovements(want ? rules.careful : rules.normal);
  }
  applyRules();
  installTick(bot, walk, { walking: () => active?.pattern === "walk", gait, careful, head: () => head });

  /** Leaves the body still: no route, no keys held, no dig left half done. */
  function halt(): void {
    walk.stop();
    releaseKeys(bot);
    if (bot.targetDigBlock) bot.stopDigging();
  }

  function setGoal(run: Active): void {
    const goal = run.journey.goal();
    run.goalSetAt = Date.now();
    if (goal) walk.start(goal, run.journey.dynamic);
    else walk.stop();
  }

  function switchTo(run: Active, next: PatternName): void {
    if (run.pattern !== null) {
      run.switches++;
      log(`locomotion: ${run.pattern} → ${next}`);
    }
    halt();
    run.pattern = next;
    sense.reset();
    if (next === "walk") setGoal(run);
  }

  /** The journey's result, with what it did in `changes`. */
  function report(run: Active, status: SkillResult["status"], reason?: string): SkillResult {
    const seconds = (Date.now() - run.startedAt) / 1000;
    const late = run.estimateMs !== null && seconds * 1000 > LATE_FACTOR * run.estimateMs;
    const changes: Record<string, unknown> = {
      distance: Math.round(run.distance * 10) / 10,
      seconds: Math.round(seconds * 10) / 10,
      patternSwitches: run.switches,
      recoveries: run.recoveries.length,
      ...(run.recoveries.length ? { recovered: run.recoveries.join(", ") } : {}),
      late,
    };
    // HOOK(prediction-checker): `late` and `asExpected` are only recorded here, as with the primitives.
    changes.asExpected = status === "done" && asExpected(EXPECTS, changes);
    return { status, ...(reason ? { reason } : {}), changes };
  }

  /** Feels for a stumble and corrects it locally. Returns a reason to give up, or null. */
  async function feel(run: Active, signal: AbortSignal): Promise<string | null> {
    const me = bot.entity.position;
    const expected = run.pattern === "walk" ? walk.expectedToMove() : farFrom(bot, run.journey.aim());
    if (!sense.feel(me, expected, Date.now())) {
      if (run.stuckAt && me.distanceTo(run.stuckAt) >= RECOVERED_AFTER) {
        run.tries = 0;
        run.stuckAt = null;
      }
      return null;
    }
    const kind = recoveryFor(run.tries, run.pattern === "walk" && !run.journey.urgent);
    const where = `${Math.floor(me.x)},${Math.floor(me.y)},${Math.floor(me.z)}`;
    if (!kind) {
      stuckUntil = Date.now() + STUCK_SHOWN_MS;
      if (spots.failedAt(me, Date.now())) log(`locomotion: stuck here three times: avoiding ${where} for 5 minutes`);
      return `stuck at ${where}`;
    }
    run.tries++;
    run.stuckAt ??= me.clone();
    run.recoveries.push(kind);
    log(`locomotion: stuck at ${where}, trying ${kind} (${run.tries} of 3)`);
    run.recovering = true;
    try {
      await recover(kind, bot, () => walk.stop(), signal);
      // Whatever was tried, the route is planned again from where the bot now stands.
      if (run.pattern === "walk" && kind !== "jump") setGoal(run);
    } finally {
      run.recovering = false;
      sense.reset();
    }
    return null;
  }

  async function travel(run: Active, outer: AbortSignal): Promise<SkillResult> {
    const signal = AbortSignal.any([outer, run.cancel.signal]);
    let feltAt = 0;
    try {
      while (true) {
        if (signal.aborted) return report(run, "interrupted");
        // Paused (a flinch): stand still with no key held, then pick the journey up where it was.
        if (Date.now() < pausedUntil) {
          await sleepFor(PAUSE_POLL_MS, signal);
          continue;
        }
        if (run.paused) {
          run.paused = false;
          sense.reset();
          try {
            if (run.pattern === "walk") setGoal(run);
            log("locomotion: carrying on after a pause");
          } catch (error) {
            log(`locomotion: could not carry on after a pause (${error instanceof Error ? error.message : String(error)})`);
            return report(run, "failed", "could not resume after a pause");
          }
        }
        const { journey } = run;
        if (journey.arrived(run.pattern === "walk" && walk.reached(), run.pattern !== null && run.pattern !== "walk")) return report(run, "done");
        const next = choosePattern(bot, journey.urgent, run.pattern);
        if (next !== run.pattern) switchTo(run, next);

        if (run.pattern === "walk") {
          applyRules();
          const noRoute = journey.failsWithoutPath ? walk.failure(Date.now()) : null;
          if (noRoute) return report(run, "failed", noRoute);
          if (journey.replanMs !== undefined && Date.now() - run.goalSetAt >= journey.replanMs) setGoal(run);
          const aim = journey.aim();
          const way = aim && journey.kind === "goTo" ? findDoorWay(bot, aim, run.doors) : null;
          if (way) {
            run.doors.add(String(way.door));
            log(`locomotion: going through the door at ${way.door}`);
            await passDoor(bot, way, walk, signal);
            setGoal(run);
            sense.reset();
          }
          run.estimateMs ??= estimate(run);
        } else {
          await steer(bot, journey.aim(), journey.urgent ? canSprint(bot.food) : gait() !== "walk");
        }

        const me = bot.entity.position;
        run.distance += me.distanceTo(run.last);
        run.last = me.clone();
        if (Date.now() - feltAt >= FEEL_MS) {
          feltAt = Date.now();
          const gaveUp = await feel(run, signal);
          if (gaveUp) return report(run, "failed", gaveUp);
        }
        await sleepFor(run.pattern === "walk" ? POLL_MS.walk : POLL_MS.steer, signal);
      }
    } catch (error) {
      if (signal.aborted) return report(run, "interrupted");
      return report(run, "failed", error instanceof Error ? error.message : String(error));
    } finally {
      halt();
      if (active === run) active = null;
    }
  }

  /** How long the journey should take, once the route is known (a journey with no fixed end has no estimate). */
  function estimate(run: Active): number | null {
    const { journey } = run;
    if (journey.kind !== "goTo" || journey.urgent || walk.pathLength() === null) return null;
    const blocks = Math.max(walk.pathLength()!, run.startGap);
    return Math.max(MIN_ESTIMATE_MS, (blocks / SPEED[gait()]) * 1000);
  }

  /** Starts a journey, cleanly replacing any under way. */
  async function begin(journey: Planned, signal: AbortSignal): Promise<SkillResult> {
    const before = active;
    if (before) {
      before.cancel.abort(new Error("replaced"));
      await before.finished;
    }
    const me = bot.entity.position.clone();
    const aim = journey.aim();
    const run: Active = {
      journey, cancel: new AbortController(), pattern: null, finished: Promise.resolve({ status: "done" }), startedAt: Date.now(),
      from: me, last: me, distance: 0, switches: 0, recoveries: [], tries: 0, stuckAt: null, recovering: false, paused: false,
      startGap: aim ? aim.distanceTo(me) : 0, goalSetAt: 0, doors: new Set(), estimateMs: null,
    };
    active = run;
    run.finished = travel(run, signal);
    return run.finished;
  }

  return {
    goTo: (place, opts, signal) => begin(goToJourney(bot, place, opts), signal),
    follow: (entity, opts, signal) => begin(followJourney(bot, entity, opts), signal),
    awayFrom: (threat, opts, signal) => begin(awayJourney(bot, threat, opts), signal),
    stop() {
      active?.cancel.abort(new Error("stopped"));
      halt();
    },
    setDrive(next) {
      const clamp = (n: number | undefined, otherwise: number) => (n === undefined || !Number.isFinite(n) ? otherwise : Math.min(1, Math.max(0, n)));
      drive = { speed: clamp(next.speed, drive.speed), caution: clamp(next.caution, drive.caution) };
    },
    status(): LocomotionStatus {
      const run = active;
      const aim = run?.journey.aim() ?? null;
      const left = aim ? aim.distanceTo(bot.entity.position) : 0;
      return {
        moving: run !== null,
        pattern: run?.pattern ?? null,
        gait: gait(),
        stuck: (run?.recovering ?? false) || (run?.tries ?? 0) > 0 || Date.now() < stuckUntil,
        progress: run && run.startGap > 0 ? Math.min(1, Math.max(0, 1 - left / run.startGap)) : 0,
        recoveries: run?.recoveries.length ?? 0,
      };
    },
    pause(ms) {
      if (!active) return false;
      pausedUntil = Math.max(pausedUntil, Date.now() + ms);
      // At once, not at the journey's next look: a flinch is over in less time than that.
      active.paused = true;
      halt();
      return true;
    },
    avoid: (spot) => spots.mark(spot, Date.now()),
    forget() {
      spots.clear();
      sense.reset();
      stuckUntil = 0;
    },
    setHeadOverride(override) {
      head = override;
    },
  };
}
