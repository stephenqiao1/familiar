import type { Skill } from "@familiar/contracts";
import pathfinder from "mineflayer-pathfinder";
import { resolveTarget, type ResolvedTarget } from "../resolve-target.js";
import type { MinecraftCtx } from "../skill-context.js";
import { parseTarget } from "../target.js";
import { walkTo } from "../walk-to.js";

const { GoalFollow, GoalNear } = pathfinder.goals;
const RANGE = 2;

/** Walks to within 2 blocks of a position, block, entity or player. */
export const goTo: Skill<MinecraftCtx> = {
  name: "go_to",
  description: "Walk to within 2 blocks of a target (nearest:<name>, pos:x,y,z, entity:<id>, player:<name>).",
  // Walking may dig its way through, so it uses the hands too; the head is free to look around.
  parts: ["legs", "hands"],

  canRun(ctx, target) {
    const resolved = resolve(ctx, target);
    return resolved !== null && resolved.kind !== "item";
  },

  async run(ctx, target, signal) {
    const resolved = resolve(ctx, target);
    if (!resolved) return { status: "failed", reason: `target "${target}" not found` };

    ctx.log(`go_to: heading for ${target}`);
    const goal = goalFor(resolved);
    if (!goal) return { status: "failed", reason: `"${target}" is not somewhere to walk to` };
    return walkTo(ctx.bot, goal, signal);
  },
};

function resolve(ctx: MinecraftCtx, target: string | undefined): ResolvedTarget | null {
  const parsed = target === undefined ? null : parseTarget(target);
  return parsed && resolveTarget(ctx.bot, parsed);
}

function goalFor(resolved: ResolvedTarget) {
  switch (resolved.kind) {
    case "position": {
      const { x, y, z } = resolved.position;
      return new GoalNear(x, y, z, RANGE);
    }
    case "block": {
      const { x, y, z } = resolved.block.position;
      return new GoalNear(x, y, z, RANGE);
    }
    case "entity":
      // Follows the entity if it moves; done once within range.
      return new GoalFollow(resolved.entity, RANGE);
    case "item":
      // An item is not a place.
      return null;
  }
}
