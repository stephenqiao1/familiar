import type { Gait } from "./types.js";

/** The game does not let a player sprint at or below this food level. */
export const MIN_FOOD_TO_SPRINT = 6;
/** Blocks per second, for estimating how long a journey should take. */
export const SPEED: Record<Gait | "swim", number> = { walk: 4.3, jog: 5, sprint: 5.6, swim: 2 };
/** Heading must hold this steady, for this long, to count as a straight open stretch. */
const STEADY = { radians: 0.2, ms: 800 };

/** The gait for a speed command: below 0.3 walk; up to 0.7 sprint on straight stretches; above, sprint whenever allowed. */
export function gaitOf(speed: number): Gait {
  return speed < 0.3 ? "walk" : speed <= 0.7 ? "jog" : "sprint";
}

/** Whether the game allows sprinting at this food level. */
export function canSprint(food: number): boolean {
  return food > MIN_FOOD_TO_SPRINT;
}

/**
 * Whether to let a sprint the walking rhythm asked for go ahead: never when too hungry, never
 * at a walk, always at a sprint, and at a jog only on a straight stretch.
 */
export function allowSprint(gait: Gait, food: number, onStraight: boolean): boolean {
  if (!canSprint(food) || gait === "walk") return false;
  return gait === "sprint" || onStraight;
}

/**
 * Tells a straight stretch from a winding one: feed it the heading each tick while walking.
 * A stretch counts as straight once the heading has held steady for a while; `restart` begins
 * again (a new journey has not proved straight yet).
 */
export function createStraightness(): { straight(yaw: number, now: number): boolean; restart(): void } {
  let held: { yaw: number; since: number } | null = null;
  return {
    straight(yaw, now) {
      const turn = held ? Math.abs(Math.atan2(Math.sin(yaw - held.yaw), Math.cos(yaw - held.yaw))) : Infinity;
      if (turn > STEADY.radians) held = { yaw, since: now };
      return now - held!.since >= STEADY.ms;
    },
    restart() {
      held = null;
    },
  };
}
