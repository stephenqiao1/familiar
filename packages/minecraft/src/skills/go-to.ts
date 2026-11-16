import type { Skill } from "@familiar/contracts";
import { resolveTarget, type ResolvedTarget } from "../resolve-target.js";
import type { MinecraftCtx } from "../skill-context.js";
import { parseTarget } from "../target.js";

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
    const { locomotion } = ctx;
    switch (resolved.kind) {
      case "position":
        return locomotion.goTo(resolved.position, { range: RANGE }, signal);
      case "block":
        return locomotion.goTo(resolved.block.position, { range: RANGE }, signal);
      case "entity":
        // Follows the entity if it moves; done once within range.
        return locomotion.follow(resolved.entity, { range: RANGE, once: true }, signal);
      case "item":
        return { status: "failed", reason: `"${target}" is not somewhere to walk to` };
    }
  },
};

function resolve(ctx: MinecraftCtx, target: string | undefined): ResolvedTarget | null {
  const parsed = target === undefined ? null : parseTarget(target);
  return parsed && resolveTarget(ctx.bot, parsed);
}
