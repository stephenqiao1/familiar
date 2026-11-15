import type { Skill } from "@familiar/contracts";
import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import type { Block } from "../mc-types.js";
import { placeNearby } from "../placement.js";
import type { MinecraftCtx } from "../skill-context.js";
import { blockPosOf, withinReach } from "./aim.js";

const FACES = [new Vec3(0, 1, 0), new Vec3(0, -1, 0), new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];

/** Places the block in hand: at a position within reach, or on clear ground nearby. */
export const placeBlock: Skill<MinecraftCtx> = {
  name: "place_block",
  description: "Place the block in hand at pos:x,y,z within reach (default: on clear ground nearby).",
  primitive: true,

  canRun(ctx, target) {
    const { bot } = ctx;
    if (!holdsBlock(bot)) return false;
    return target === undefined || support(bot, target) !== null;
  },

  async run(ctx, target, signal) {
    const { bot } = ctx;
    const held = bot.heldItem;
    if (!held || !holdsBlock(bot)) return { status: "failed", reason: "no block in hand" };
    try {
      if (target === undefined) {
        await placeNearby(bot, held);
      } else {
        const on = support(bot, target);
        if (!on) return { status: "failed", reason: `nothing to place against at "${target}"` };
        await bot.lookAt(on.block.position.offset(0.5, 0.5, 0.5), true);
        await bot.placeBlock(on.block, on.face);
      }
      return signal.aborted ? { status: "interrupted" } : { status: "done" };
    } catch (error) {
      return { status: "failed", reason: error instanceof Error ? error.message : String(error) };
    }
  },
};

function holdsBlock(bot: Bot): boolean {
  return bot.heldItem !== null && bot.registry.blocksByName[bot.heldItem.name] !== undefined;
}

/** A solid block next to the (empty, reachable) target position, and the face of it to place against. */
function support(bot: Bot, target: string): { block: Block; face: Vec3 } | null {
  const pos = blockPosOf(bot, target);
  if (!pos || bot.blockAt(pos)?.boundingBox !== "empty" || !withinReach(bot, pos.offset(0.5, 0.5, 0.5))) return null;
  for (const face of FACES) {
    const block = bot.blockAt(pos.minus(face));
    if (block?.boundingBox === "block") return { block, face };
  }
  return null;
}
