import type { Bot } from "mineflayer";
import pathfinder from "mineflayer-pathfinder";
import type { Vec3 } from "vec3";
import { abortableGoto, sleepFor } from "./abort.js";

const { GoalNear } = pathfinder.goals;
const DROP_RADIUS = 4;
const SPAWN_WAIT_MS = 250;

/**
 * Walks over item drops near `around` for up to `ms`, then gives up quietly.
 * Rejects with `signal.reason` only if the caller's signal fires.
 */
export async function collectDrops(bot: Bot, around: Vec3, signal: AbortSignal, ms = 3000): Promise<void> {
  const deadline = AbortSignal.timeout(ms);
  const both = AbortSignal.any([signal, deadline]);
  try {
    await sleepFor(SPAWN_WAIT_MS, both);
    for (let drop = nearestDrop(bot, around); drop; drop = nearestDrop(bot, around)) {
      const { x, y, z } = drop.position;
      await abortableGoto(bot, new GoalNear(x, y, z, 0.5), both);
      await sleepFor(SPAWN_WAIT_MS, both); // give the pickup a moment to register
    }
  } catch (error) {
    signal.throwIfAborted();
    if (!deadline.aborted) throw error;
  }
}

function nearestDrop(bot: Bot, around: Vec3) {
  return bot.nearestEntity((e) => e.name === "item" && e.position.distanceTo(around) <= DROP_RADIUS);
}
