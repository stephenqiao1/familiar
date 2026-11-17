import type { Bot } from "mineflayer";
import type { Vec3 } from "vec3";

// Notices the body being moved somewhere else all at once: a teleport, a respawn, a portal.

/** Further than this in one tick is not travel: nothing the legs do covers it. */
export const DISPLACED_BLOCKS = 8;

export interface DisplacedSense {
  /** True once after the bot's position jumped; asking takes the notice. */
  take(): boolean;
}

/**
 * Watches for the bot's position jumping more than 8 blocks in one tick, or its dimension
 * changing. `onDisplaced` is called at once, with where it was and where it is now.
 */
export function trackDisplaced(bot: Bot, onDisplaced: (from: Vec3, to: Vec3) => void = () => {}): DisplacedSense {
  let before: { at: Vec3; dimension: string } | null = null;
  let noticed = false;
  bot.on("physicsTick", () => {
    const here = bot.entity.position;
    const dimension = bot.game.dimension;
    if (before && (here.distanceTo(before.at) > DISPLACED_BLOCKS || dimension !== before.dimension)) {
      noticed = true;
      onDisplaced(before.at, here.clone());
    }
    before = { at: here.clone(), dimension };
  });
  return {
    take() {
      const was = noticed;
      noticed = false;
      return was;
    },
  };
}
