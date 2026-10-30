import type { Skill } from "@familiar/contracts";
import type { Bot } from "mineflayer";
import pathfinder from "mineflayer-pathfinder";
import { Vec3 } from "vec3";
import { abortableGoto } from "../abort.js";
import { digSafely } from "../dig.js";
import { collectDrops } from "../drops.js";
import { isDangerousBlock, isSafeToDig } from "../safety.js";
import type { MinecraftCtx } from "../skill-context.js";

const { GoalBlock } = pathfinder.goals;
const LENGTH = 16;
const BIG_DROP = 3;
const MAX_REDIGS = 5; // gravel or sand can keep falling into the gap

const DIRECTIONS: Record<string, Vec3> = {
  north: new Vec3(0, 0, -1),
  south: new Vec3(0, 0, 1),
  east: new Vec3(1, 0, 0),
  west: new Vec3(-1, 0, 0),
};

type Step = { kind: "ok" } | { kind: "hazard"; detail: string } | { kind: "failed"; reason: string };

/** Digs a 1×2 tunnel up to 16 blocks in a straight line, mining any ore it uncovers in the walls. */
export const digTunnel: Skill<MinecraftCtx> = {
  name: "dig_tunnel",
  description: "Dig a 1-wide, 2-high tunnel 16 blocks north/south/east/west (default: the way the bot faces).",

  canRun(_ctx, target) {
    return target === undefined || target in DIRECTIONS;
  },

  async run(ctx, target, signal) {
    const { bot } = ctx;
    const dir = target === undefined ? facing(bot) : DIRECTIONS[target];
    if (!dir) return { status: "failed", reason: `unknown direction "${target}"` };
    ctx.log(`dig_tunnel: digging ${target ?? "forward"} for ${LENGTH} blocks`);

    try {
      for (let i = 0; i < LENGTH; i++) {
        const step = await advance(ctx, dir, signal);
        if (step.kind === "hazard") {
          ctx.log(`dig_tunnel: stopped after ${i} blocks, ${step.detail}`);
          return { status: "failed", reason: "hazard" };
        }
        if (step.kind === "failed") return { status: "failed", reason: step.reason };
      }
      return { status: "done" };
    } catch (error) {
      if (signal.aborted) return { status: "interrupted" };
      throw error;
    }
  },
};

/** Clears the next 1×2 slot ahead, steps into it, and mines ore in the new walls. */
async function advance(ctx: MinecraftCtx, dir: Vec3, signal: AbortSignal): Promise<Step> {
  const { bot } = ctx;
  const feet = bot.entity.position.floored().plus(dir);
  const head = feet.offset(0, 1, 0);

  const hazard = hazardAhead(bot, feet);
  if (hazard) return { kind: "hazard", detail: hazard };

  // Head first, so falling gravel lands in the feet slot and gets cleared too. Only ever the
  // two blocks ahead: never the block under the bot.
  for (const pos of [head, feet]) {
    for (let tries = 0; !isOpen(bot, pos); tries++) {
      if (tries >= MAX_REDIGS) return { kind: "failed", reason: `could not clear ${pos}` };
      const block = bot.blockAt(pos);
      if (!block) return { kind: "failed", reason: `block at ${pos} not loaded` };
      if (!isSafeToDig(bot, block)) return { kind: "hazard", detail: `unsafe to dig ${block.name} at ${pos}` };
      const outcome = await digSafely(bot, block, signal);
      if (outcome !== "dug") return { kind: "failed", reason: `${outcome} (${block.name})` };
    }
  }

  await abortableGoto(bot, new GoalBlock(feet.x, feet.y, feet.z), signal);
  await mineVisibleOre(ctx, feet, dir, signal);
  return { kind: "ok" };
}

/** Lava or fire in or beside the next slot, or a drop of 3+ blocks under it. */
function hazardAhead(bot: Bot, feet: Vec3): string | null {
  const around = [feet, feet.offset(0, 1, 0), feet.offset(0, 2, 0), feet.offset(0, -1, 0)];
  for (const pos of around) {
    const name = bot.blockAt(pos)?.name;
    if (name && isDangerousBlock(name)) return `${name} at ${pos}`;
  }
  let depth = 0;
  while (depth < BIG_DROP && bot.blockAt(feet.offset(0, -1 - depth, 0))?.boundingBox !== "block") depth++;
  return depth >= BIG_DROP ? `drop of ${BIG_DROP}+ blocks at ${feet}` : null;
}

/** Ore in the left/right walls or the ceiling of the slot the bot now stands in. */
async function mineVisibleOre(ctx: MinecraftCtx, feet: Vec3, dir: Vec3, signal: AbortSignal): Promise<void> {
  const { bot } = ctx;
  const side = new Vec3(dir.z, 0, -dir.x);
  const walls = [feet.plus(side), feet.minus(side), feet.plus(side).offset(0, 1, 0), feet.minus(side).offset(0, 1, 0), feet.offset(0, 2, 0)];

  for (const pos of walls) {
    const block = bot.blockAt(pos);
    if (!block || !block.name.endsWith("_ore")) continue;
    const outcome = await digSafely(bot, block, signal);
    ctx.log(`dig_tunnel: ${block.name} in wall at ${pos}: ${outcome}`);
    if (outcome === "dug") await collectDrops(bot, pos, signal);
  }
}

function isOpen(bot: Bot, pos: Vec3): boolean {
  return bot.blockAt(pos)?.boundingBox === "empty";
}

/** The cardinal direction closest to where the bot is looking. */
function facing(bot: Bot): Vec3 {
  // mineflayer yaw: 0 faces north (-z), increasing turns toward west (-x).
  const x = -Math.sin(bot.entity.yaw);
  const z = -Math.cos(bot.entity.yaw);
  return Math.abs(x) > Math.abs(z) ? new Vec3(Math.sign(x), 0, 0) : new Vec3(0, 0, Math.sign(z));
}
