import type { RunningSkill, State } from "@familiar/contracts";
import type { Base } from "../base.js";
import type { EncodableBot } from "./encodable-bot.js";
import type { Vec3 } from "vec3";
import type { Heading } from "../body-events.js";
import type { Hurt } from "../pain.js";
import { encodeSelf } from "./encode-self.js";
import { dangerAlong, headInBlock, touchingOf } from "./touching.js";
import { scanHazards } from "./scan-hazards.js";
import { DEFAULT_LIMIT, scanMobs, scanPlayers } from "./scan-mobs.js";
import { scanUsefulBlocks } from "./scan-useful-blocks.js";
import type { MinecraftStateData } from "./state-data.js";

export const SCHEMA_VERSION = 12;

export interface EncodeContext {
  base: Base;
  /** The skill executor's current() result. */
  current: RunningSkill | null;
  /** Times the bot has died since it joined. */
  deaths: number;
  /** How this place feels from memory, if anything is remembered close by. Default: nothing. */
  memory?: MinecraftStateData["memory"];
  /** The last time the bot was hurt. Default: never. */
  lastHurt?: Hurt | null;
  /** Movement the bot did not command, if it adds up to a push. Default: none. */
  pushed?: { blocks: number; toward: Heading } | null;
  /** Which way the body is moving. Default: still. */
  motion?: Heading | null;
  /** What the locomotion controller reports. Default: standing still. */
  locomotion?: MinecraftStateData["self"]["locomotion"];
  /** Loud events heard lately (explosions, thunder). Default: none. */
  loud?: LoudEvent[];
  /** How many of each kind of nearby thing to keep (focus sets it). Default: 10. */
  limit?: number;
  /** Narrow attention (high alarm): keep threats, drop friendly mobs and useful blocks. Default: false. */
  narrow?: boolean;
}

/** Not travelling. */
const STANDING: MinecraftStateData["self"]["locomotion"] = { moving: false, pattern: null, gait: "walk", stuck: false };

/** A loud event the bot heard. */
export interface LoudEvent {
  type: string;
  position: Vec3;
  at: number;
}

/** A loud event is reported for this long, and only this close. */
const LOUD_FOR_MS = 2000;
const LOUD_RADIUS = 32;

/** Turns the bot's view of the world into a compact, game-agnostic State. */
export function encodeState(bot: EncodableBot, tick: number, ctx: EncodeContext): State {
  const now = Date.now();
  const limit = ctx.limit ?? DEFAULT_LIMIT;
  const data: MinecraftStateData = {
    time: { isNight: !bot.time.isDay, lightLevel: lightLevel(bot) },
    self: {
      ...encodeSelf(bot, ctx.base.chest, ctx.deaths, ctx.lastHurt ?? null, now),
      locomotion: ctx.locomotion ?? STANDING,
      touching: touchingOf(bot),
      inBlock: headInBlock(bot),
      pushed: ctx.pushed ? { ...ctx.pushed, danger: dangerAlong(bot, ctx.pushed.toward) } : null,
      motion: ctx.motion ? { toward: ctx.motion, danger: dangerAlong(bot, ctx.motion) } : null,
    },
    nearby: {
      hazards: scanHazards(bot, limit),
      mobs: ctx.narrow ? scanMobs(bot, limit).filter((m) => m.hostile) : scanMobs(bot, limit),
      blocks: ctx.narrow ? [] : scanUsefulBlocks(bot, limit),
      players: scanPlayers(bot, limit),
      loud: (ctx.loud ?? [])
        .filter((e) => now - e.at <= LOUD_FOR_MS)
        .map((e) => ({ type: e.type, dist: Math.round(e.position.distanceTo(bot.entity.position)) }))
        .filter((e) => e.dist <= LOUD_RADIUS),
    },
    memory: ctx.memory ?? null,
    current: ctx.current && {
      skill: ctx.current.skill,
      target: ctx.current.target ?? null,
      secondsRunning: Math.round((now - ctx.current.startedAt) / 1000),
    },
  };
  return { schemaVersion: SCHEMA_VERSION, tick, timestamp: now, data: { ...data } };
}

/** How much darker the sky is at night: the game dims sky light by this much. */
const NIGHT_SKY_DIMMING = 11;

/**
 * The brighter of block light and sky light where the bot stands. A block's sky light is how open
 * it is to the sky, whatever the time, so at night it is dimmed the way the game dims it.
 */
function lightLevel(bot: EncodableBot): number {
  const here = bot.blockAt(bot.entity.position.floored());
  if (!here) return 0;
  return Math.max(here.light, here.skyLight - (bot.time.isDay ? 0 : NIGHT_SKY_DIMMING), 0);
}
