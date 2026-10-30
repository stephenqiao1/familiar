import type { State } from "@familiar/contracts";

/** The parts of a mineflayer Bot the encoder reads. A real Bot satisfies this. */
export interface EncodableBot {
  health: number;
  food: number;
  entity: { position: { x: number; y: number; z: number } };
  time: { isDay: boolean };
}

/** Turns the bot's view of the world into a game-agnostic State. */
export function encodeState(bot: EncodableBot, tick: number): State {
  const { x, y, z } = bot.entity.position;
  return {
    schemaVersion: 1,
    tick,
    timestamp: Date.now(),
    data: {
      health: bot.health,
      food: bot.food,
      position: { x, y, z },
      isNight: !bot.time.isDay,
    },
  };
}
