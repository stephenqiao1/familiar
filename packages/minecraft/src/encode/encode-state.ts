import type { RunningSkill, State } from "@familiar/contracts";
import type { Base } from "../base.js";
import type { EncodableBot } from "./encodable-bot.js";
import { encodeSelf } from "./encode-self.js";
import { scanHazards } from "./scan-hazards.js";
import { scanMobs } from "./scan-mobs.js";
import { scanOres } from "./scan-ores.js";
import type { MinecraftStateData } from "./state-data.js";

export const SCHEMA_VERSION = 2;

export interface EncodeContext {
  base: Base;
  /** The skill executor's current() result. */
  current: RunningSkill | null;
}

/** Turns the bot's view of the world into a compact, game-agnostic State. */
export function encodeState(bot: EncodableBot, tick: number, ctx: EncodeContext): State {
  const now = Date.now();
  const data: MinecraftStateData = {
    time: { isNight: !bot.time.isDay, lightLevel: lightLevel(bot) },
    self: encodeSelf(bot, ctx.base.chest),
    nearby: { ores: scanOres(bot), hazards: scanHazards(bot), mobs: scanMobs(bot) },
    current: ctx.current && {
      skill: ctx.current.skill,
      target: ctx.current.target ?? null,
      secondsRunning: Math.round((now - ctx.current.startedAt) / 1000),
    },
  };
  return { schemaVersion: SCHEMA_VERSION, tick, timestamp: now, data: { ...data } };
}

/** The brighter of block light and sky light where the bot stands. */
function lightLevel(bot: EncodableBot): number {
  const here = bot.blockAt(bot.entity.position.floored());
  return here ? Math.max(here.light, here.skyLight) : 0;
}
