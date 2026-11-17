import type { Bot } from "mineflayer";
import { BIG_DROP, isOpen } from "../encode/scan-hazards.js";
import { allowSprint, createStraightness } from "./gait.js";
import type { Gait, HeadOverride } from "./types.js";
import type { Walk } from "./walk.js";

const WALK_KEYS = ["forward", "back", "left", "right", "sprint"] as const;

/** What the tick needs to know about the journey under way. */
export interface TickView {
  /** The walk pattern is carrying a journey right now. */
  walking(): boolean;
  gait(): Gait;
  /** Sneak near big drops. */
  careful(): boolean;
  head(): HeadOverride | null;
}

/** A drop of 3 or more blocks lies within one block of the bot's feet. */
export function nearDrop(bot: Bot): boolean {
  const feet = bot.entity.position.floored();
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      if (dx === 0 && dz === 0) continue;
      const spot = feet.offset(dx, 0, dz);
      let depth = 0;
      while (depth < BIG_DROP && isOpen(bot, spot.offset(0, -1 - depth, 0))) depth++;
      if (isOpen(bot, spot) && depth >= BIG_DROP) return true;
    }
  }
  return false;
}

/**
 * Shapes each step of the walking rhythm. The pathfinder presses its keys once per physics
 * tick; straight after it, this:
 *   - lets its sprint go ahead only if the gait allows (and the bot is fed enough to sprint);
 *   - holds sneak near a big drop when being careful;
 *   - during a plain walk, lets a head override (a held look) turn the head and re-press the
 *     same direction of travel with other keys.
 * Just before the pathfinder's next tick it gives back the keys and heading as they were left.
 */
export function installTick(bot: Bot, walk: Walk, view: TickView): void {
  const stretch = createStraightness();
  let sneaking = false;
  let wasWalking = false;
  let saved: { keys: Record<string, boolean>; yaw: number; pitch: number } | null = null;

  bot.prependListener("physicsTick", () => {
    if (!saved) return;
    for (const key of WALK_KEYS) bot.setControlState(key, saved.keys[key] ?? false);
    bot.entity.yaw = saved.yaw;
    bot.entity.pitch = saved.pitch;
    saved = null;
  });

  bot.on("physicsTick", () => {
    const walking = view.walking();
    // Only with the feet on the ground: sneaking on a ladder or in water holds the body where it is.
    const sneak = walking && view.careful() && bot.entity.onGround && nearDrop(bot);
    // Pressed again every tick it is wanted: the walking rhythm lets go of every key whenever it
    // plans again, which used to leave the bot walking a ledge upright. Only let go of a sneak this held.
    if (sneak && !bot.getControlState("sneak")) bot.setControlState("sneak", true);
    if (!sneak && sneaking) bot.setControlState("sneak", false);
    sneaking = sneak;
    if (walking && !wasWalking) stretch.restart();
    wasWalking = walking;
    if (!walking) return;
    const state = (key: (typeof WALK_KEYS)[number] | "jump" | "sneak") => bot.getControlState(key);
    const onStraight = stretch.straight(bot.entity.yaw, Date.now());
    if (state("sprint") && !allowSprint(view.gait(), bot.food, onStraight)) bot.setControlState("sprint", false);

    // Only plain walking is re-expressed for the head. Jumps, swimming, sneaking, digging and
    // placing need the head where the walking rhythm put it.
    const head = view.head();
    const plain = walk.plain() && state("forward") && !state("back") && !state("jump") && !state("sneak") && !(bot.entity as { isInWater?: boolean }).isInWater;
    const turned = head && plain ? head(bot.entity.yaw) : null;
    if (!turned) return;
    saved = { keys: Object.fromEntries(WALK_KEYS.map((key) => [key, state(key)])), yaw: bot.entity.yaw, pitch: bot.entity.pitch };
    for (const key of ["forward", "back", "left", "right"] as const) bot.setControlState(key, turned.keys[key]);
    // Sprinting only works straight ahead.
    if (!(turned.keys.forward && !turned.keys.left && !turned.keys.right)) bot.setControlState("sprint", false);
    bot.entity.yaw = turned.yaw;
    bot.entity.pitch = turned.pitch;
  });
}
