import type { RunningSkill, State } from "@familiar/contracts";
import type { Base } from "../base.js";
import type { EncodableBot } from "./encodable-bot.js";
import type { Heading } from "../body-events.js";
import type { Hurt } from "../pain.js";
import { balanceSense } from "./balance.js";
import { encodeSelf } from "./encode-self.js";
import { gazeOf, heardThings, positionOf, sighted, suddenThings, unseenHostileHeard } from "./perceive.js";
import { lightAt } from "./bearing.js";
import type { Senses } from "../senses.js";
import { dangerAlong, headInBlock, touchingOf } from "./touching.js";
import { scanHazards } from "./scan-hazards.js";
import { scanMobs, scanPlayers } from "./scan-mobs.js";
import { scanUsefulBlocks } from "./scan-useful-blocks.js";
import type { Defence, MinecraftStateData } from "./state-data.js";

export const SCHEMA_VERSION = 19;
/**
 * A safety cap on each kind of nearby thing (the nearest are kept), so that a crowd cannot blow
 * up the cost of a state. It is not the attention budget: the whole brain reads up to this many.
 */
export const NEARBY_CAP = 32;

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
  /** Game minutes since the bot last slept. Default: 0. */
  sinceSleepMinutes?: number;
  /** Health has gone up in the last few seconds. Default: false. */
  healing?: boolean;
  /** How far the bot has fallen so far in the fall under way. Default: 0. */
  fallen?: number;
  /** The bot's position has just jumped without it travelling there. Default: false. */
  displaced?: boolean;
  /** What the locomotion controller reports. Default: standing still. */
  locomotion?: MinecraftStateData["self"]["locomotion"];
  /** What the eyes and ears picked up between states (movement, changes, sounds). Default: nothing. */
  senses?: Senses;
  /** The threat sense: sizes up what is near and chooses a defence. Default: none (the cheap rules are used by whoever asks). */
  defence?: (data: MinecraftStateData, now: number) => Defence;
  /** The most of each kind of nearby thing to keep. Default: `NEARBY_CAP`. (What a deciding layer is told is cut further by the thalamus, not here.) */
  limit?: number;
}

/** Not travelling. */
const STANDING: MinecraftStateData["self"]["locomotion"] = { moving: false, pattern: null, gait: "walk", stuck: false };

/** Turns the bot's view of the world into a compact, game-agnostic State. */
export function encodeState(bot: EncodableBot, tick: number, ctx: EncodeContext): State {
  const now = Date.now();
  const limit = ctx.limit ?? NEARBY_CAP;
  const { senses } = ctx;
  const mobs = scanMobs(bot, limit).map((m) => sighted(bot, m, senses));
  const blocks = scanUsefulBlocks(bot, limit).map((b) => sighted(bot, b, senses));
  const players = scanPlayers(bot, limit).map((p) => sighted(bot, p, senses));
  const things = [...mobs, ...players, ...blocks];
  const data: MinecraftStateData = {
    time: { isNight: !bot.time.isDay, lightLevel: lightLevel(bot), ...nightProgress(bot), ...(bot.time.timeOfDay === undefined ? {} : { dayTick: bot.time.timeOfDay }), blockLight: bot.blockAt(bot.entity.position.floored())?.light ?? 0 },
    self: {
      ...encodeSelf(bot, ctx.base.chest, ctx.deaths, ctx.lastHurt ?? null, now),
      locomotion: ctx.locomotion ?? STANDING,
      touching: touchingOf(bot),
      inBlock: headInBlock(bot),
      // Being moved somewhere else is not a push.
      pushed: ctx.pushed && !ctx.displaced ? { ...ctx.pushed, danger: dangerAlong(bot, ctx.pushed.toward) } : null,
      motion: ctx.motion ? { toward: ctx.motion, danger: dangerAlong(bot, ctx.motion) } : null,
      sinceSleepMinutes: ctx.sinceSleepMinutes ?? 0,
      healing: ctx.healing ?? false,
      ...balanceSense(bot, ctx.fallen ?? 0),
      displaced: ctx.displaced ?? false,
      gaze: gazeOf(bot, things),
    },
    nearby: {
      hazards: scanHazards(bot, limit),
      mobs,
      blocks,
      players,
      sudden: senses ? suddenThings(bot, things, senses, now) : [],
      heard: [...(senses ? heardThings(bot, senses, now) : []), ...unseenHostileHeard(mobs, (id) => positionOf(bot, id))],
    },
    memory: ctx.memory ?? null,
    current: ctx.current && {
      skill: ctx.current.skill,
      target: ctx.current.target ?? null,
      secondsRunning: Math.round((now - ctx.current.startedAt) / 1000),
    },
  };
  if (ctx.defence) data.defence = ctx.defence(data, now);
  return { schemaVersion: SCHEMA_VERSION, tick, timestamp: now, data: { ...data } };
}

/** Roughly when the night starts and ends, in the game's ticks of the day (it runs 0 to 24000). */
const NIGHT = { from: 12_500, to: 23_500 };

/** At night, how far through it is (0 at dusk, 1 at dawn). */
function nightProgress(bot: EncodableBot): { nightProgress?: number } {
  const t = bot.time.timeOfDay;
  if (bot.time.isDay || t === undefined) return {};
  return { nightProgress: Math.round(Math.min(1, Math.max(0, (t - NIGHT.from) / (NIGHT.to - NIGHT.from))) * 100) / 100 };
}

/** How much darker the sky is at night: the game dims sky light by this much. */

/**
 * The brighter of block light and sky light where the bot stands. A block's sky light is how open
 * it is to the sky, whatever the time, so at night it is dimmed the way the game dims it.
 */
function lightLevel(bot: EncodableBot): number {
  return lightAt(bot, bot.entity.position);
}
