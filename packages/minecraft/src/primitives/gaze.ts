import type { Bot } from "mineflayer";
import type { Vec3 } from "vec3";
import { sleepFor } from "../abort.js";
import type { Key } from "./keys.js";

// Looking one way while walking another. The pathfinder walks by turning the head toward the next
// step and pressing "forward". While a gaze is held, each physics tick that is re-expressed: the
// head is turned to the gaze point, and the same direction of travel is pressed as a combination
// of forward, back, left and right relative to where the head now faces.

const EIGHTH = Math.PI / 4;
const WALK_KEYS: readonly Key[] = ["forward", "back", "left", "right", "sprint"];

/**
 * The keys that walk in a direction `angle` radians to the left of where the head faces, as one
 * of the eight combinations (so the angle is snapped to the nearest 45 degrees).
 */
export function keysFor(angle: number): { forward: boolean; back: boolean; left: boolean; right: boolean } {
  const eighth = ((Math.round(angle / EIGHTH) % 8) + 8) % 8;
  return { forward: [7, 0, 1].includes(eighth), left: [1, 2, 3].includes(eighth), back: [3, 4, 5].includes(eighth), right: [5, 6, 7].includes(eighth) };
}

/**
 * Keys can only walk in eight directions, so a direction between two of them is walked by
 * switching between its two neighbours tick by tick, carrying the error over: the average
 * heading is the true one. Returns the snapped angle to use this tick.
 */
export function createDither(): (angle: number) => number {
  let carried = 0;
  return (angle) => {
    const snapped = Math.round((angle + carried) / EIGHTH) * EIGHTH;
    carried += angle - snapped;
    return snapped;
  };
}

interface Gaze {
  point(): Vec3 | null;
  dither(angle: number): number;
  /** The keys and heading as the pathfinder left them, to give back before it runs again. */
  saved: { keys: Record<string, boolean>; yaw: number; pitch: number } | null;
}

const gazes = new WeakMap<Bot, Gaze>();
const installed = new WeakSet<Bot>();

/** Gives the keys and heading back to the pathfinder, as it left them. */
function restore(bot: Bot): void {
  const gaze = gazes.get(bot);
  if (!gaze?.saved) return;
  for (const key of WALK_KEYS) bot.setControlState(key, gaze.saved.keys[key] ?? false);
  bot.entity.yaw = gaze.saved.yaw;
  bot.entity.pitch = gaze.saved.pitch;
  gaze.saved = null;
}

/** Turns the head to the gaze point and re-presses the pathfinder's direction of travel around it. */
function apply(bot: Bot): void {
  const gaze = gazes.get(bot);
  const point = gaze?.point();
  if (!gaze || !point) return;
  const state = (key: Key) => bot.getControlState(key);
  // Only plain walking is re-expressed. Jumps, swimming, sneaking to an edge, digging and placing
  // need the head where the pathfinder put it, so the gaze gives way for those ticks.
  const plainWalk = bot.pathfinder.isMoving() && state("forward") && !state("back") && !state("jump") && !state("sneak") && !(bot.entity as { isInWater?: boolean }).isInWater && !bot.pathfinder.isMining() && !bot.pathfinder.isBuilding();
  if (!plainWalk) return;
  const eye = bot.entity.position.offset(0, bot.entity.height, 0);
  const to = point.minus(eye);
  const gazeYaw = Math.atan2(-to.x, -to.z);
  const gazePitch = Math.atan2(to.y, Math.hypot(to.x, to.z));
  gaze.saved = { keys: Object.fromEntries(WALK_KEYS.map((key) => [key, state(key)])), yaw: bot.entity.yaw, pitch: bot.entity.pitch };
  // Yaw grows to the left, so this is how far left of the gaze the bot is travelling.
  const snapped = gaze.dither(bot.entity.yaw - gazeYaw);
  const keys = keysFor(snapped);
  for (const key of ["forward", "back", "left", "right"] as const) bot.setControlState(key, keys[key]);
  // Sprinting only works straight ahead.
  if (!(keys.forward && !keys.left && !keys.right)) bot.setControlState("sprint", false);
  bot.entity.yaw = gazeYaw;
  bot.entity.pitch = gazePitch;
}

/**
 * Keeps the head on a point while the pathfinder walks, until the returned function is called.
 * `point` is asked every tick, so it can follow something that moves; null lets go for that tick.
 */
export function holdGaze(bot: Bot, point: () => Vec3 | null): () => void {
  if (!installed.has(bot)) {
    installed.add(bot);
    // Before the pathfinder's tick: give it back its own keys and heading. After it: re-express them.
    bot.prependListener("physicsTick", () => restore(bot));
    bot.on("physicsTick", () => apply(bot));
  }
  const gaze: Gaze = { point, dither: createDither(), saved: null };
  gazes.set(bot, gaze);
  return () => {
    if (gazes.get(bot) !== gaze) return;
    restore(bot);
    gazes.delete(bot);
  };
}

/** Holds the head on a point for `ms` while walking, then gives it back. Always lets go. */
export async function doGaze(bot: Bot, point: () => Vec3 | null, ms: number, signal: AbortSignal): Promise<void> {
  const release = holdGaze(bot, point);
  try {
    await sleepFor(ms, signal);
  } finally {
    release();
  }
}
