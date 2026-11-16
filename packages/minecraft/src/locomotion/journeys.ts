import type { Bot } from "mineflayer";
import pathfinderPkg from "mineflayer-pathfinder";
import type { goals } from "mineflayer-pathfinder";
import type { Vec3 } from "vec3";
import type { Entity } from "../mc-types.js";
import type { AwayOptions, FollowOptions, GoToOptions, Journey, Place } from "./types.js";

const { GoalFollow, GoalLookAtBlock, GoalNear } = pathfinderPkg.goals;
/** How far ahead a retreat aims each time it plans, and how often it plans again. */
const AWAY_STEP = 8;
const AWAY_REPLAN_MS = 500;

/** A journey with the walking goal it needs. */
export interface Planned extends Journey {
  /** The pathfinder goal for where the journey is heading right now, or null if nowhere. */
  goal(): goals.Goal | null;
}

const stillThere = (bot: Bot, entity: Entity) => entity.isValid && bot.entities[entity.id] === entity;

/** Travel to within range of a place. */
export function goToJourney(bot: Bot, place: Place, options: GoToOptions): Planned {
  const { range = 1, see = false, urgent = false, until } = options;
  const aim = typeof place === "function" ? place : () => place;
  return {
    kind: "goTo",
    aim,
    goal() {
      const at = aim();
      if (!at) return null;
      return see ? new GoalLookAtBlock(at.floored(), bot.world) : new GoalNear(at.x, at.y, at.z, range);
    },
    arrived(walked, steering) {
      if (until) return until();
      if (walked) return true;
      // Steering has no pathfinder to say so: close enough across the ground, and level with it.
      const at = aim();
      const me = bot.entity.position;
      return steering && at !== null && Math.hypot(at.x - me.x, at.z - me.z) <= Math.max(range, 0.3) && Math.abs(at.y - me.y) <= 1.5;
    },
    dynamic: false,
    failsWithoutPath: true,
    urgent,
    range,
    see,
  };
}

/** Keep within range of something that moves. */
export function followJourney(bot: Bot, entity: Entity, options: FollowOptions): Planned {
  const { range = 2, once = false } = options;
  const within = () => entity.position.distanceTo(bot.entity.position) <= range;
  return {
    kind: "follow",
    aim: () => (stillThere(bot, entity) ? entity.position : null),
    goal: () => new GoalFollow(entity, range),
    // The walking rhythm judges "within range" by whole blocks, so its word is taken as well as the exact distance.
    arrived: (walked) => !stillThere(bot, entity) || (once && (walked || within())),
    dynamic: !once,
    failsWithoutPath: once,
    urgent: false,
    range,
    see: false,
    entity,
  };
}

/** Horizontal unit vector (falls back to +x when zero). */
function flat(v: Vec3): Vec3 {
  const h = v.clone();
  h.y = 0;
  const length = Math.hypot(h.x, h.z);
  return length === 0 ? h.set(1, 0, 0) : h.scaled(1 / length);
}

/** A point a few blocks away from the threat. If the preferred place is not behind the threat, lean toward it. */
export function awayPoint(me: Vec3, threat: Vec3, prefer?: Vec3): Vec3 {
  const away = flat(me.minus(threat));
  if (!prefer) return me.plus(away.scaled(AWAY_STEP));
  const toward = flat(prefer.minus(me));
  const dot = away.x * toward.x + away.z * toward.z;
  return me.plus((dot > 0 ? flat(away.plus(toward)) : away).scaled(AWAY_STEP));
}

/** Get away from a threat, leaning toward a preferred place when that is not toward it. */
export function awayJourney(bot: Bot, threat: Entity, options: AwayOptions): Planned {
  const { distance, prefer, until } = options;
  const aim = () => awayPoint(bot.entity.position, threat.position, prefer);
  return {
    kind: "awayFrom",
    aim,
    goal() {
      const at = aim();
      return new GoalNear(at.x, at.y, at.z, 1);
    },
    arrived: () => (until ? until() : !stillThere(bot, threat) || threat.position.distanceTo(bot.entity.position) >= distance),
    dynamic: false,
    replanMs: AWAY_REPLAN_MS,
    failsWithoutPath: false,
    urgent: false,
    range: 1,
    see: false,
  };
}
