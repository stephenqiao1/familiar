import type { Skill } from "@familiar/contracts";
import type { MinecraftCtx } from "../skill-context.js";
import { posId } from "../encode/scan-blocks.js";
import { resolveTarget } from "../resolve-target.js";
import { parseTarget } from "../target.js";
import { attack } from "./attack.js";
import { primitives } from "../primitives/index.js";
import { doClose } from "../primitives/windows.js";
import { consume } from "./consume.js";
import { airSteer } from "./air-steer.js";
import { digOut } from "./dig-out.js";
import { flinch } from "./flinch.js";
import { freeze } from "./freeze.js";
import { holdStill } from "./hold-still.js";
import { takeCover } from "./take-cover.js";
import { recuperate } from "./recuperate.js";
import { depositItems } from "./deposit-items.js";
import { eat } from "./eat.js";
import { escapeHazard } from "./escape-hazard.js";
import { flee } from "./flee.js";
import { goTo } from "./go-to.js";
import { recoil, steady } from "./recoil.js";
import { withdraw } from "./withdraw.js";
import { idle } from "./idle.js";
import { returnToBase } from "./return-to-base.js";
import { sleep } from "./sleep.js";
import { surface } from "./surface.js";
import { takeItems } from "./take-items.js";

/**
 * Every Minecraft skill, for registering with a skill executor: the learned-style skills, the
 * reflex-only ones, and the primitives. Use `menuSkills` for what the deciding layers may choose.
 */
export const minecraftSkills: Skill<MinecraftCtx>[] = [goTo, returnToBase, idle, eat, consume, flee, attack, sleep, depositItems, takeItems, escapeHazard, surface, withdraw, digOut, recoil, steady, airSteer, flinch, freeze, holdStill, takeCover, recuperate, ...primitives];

/**
 * A chain step's target as the thing it means right now: "nearest:<kind>" becomes that block's
 * spot or that creature's id, which every skill that takes a target accepts. Anything else, and
 * a kind with nothing of it about, is left as written (the step then fails or does not start by itself).
 */
export function aimNow(ctx: MinecraftCtx, target: string | undefined): string | undefined {
  if (!target?.startsWith("nearest:")) return target;
  const parsed = parseTarget(target);
  const found = parsed && resolveTarget(ctx.bot, parsed);
  if (found?.kind === "block") return posId(found.block.position);
  return found?.kind === "entity" ? `entity:${found.entity.id}` : target;
}

/** How a learned skill's chain is run by a player: targets aimed as each step comes up, and up to this long for the body to catch up between steps. */
export const CHAIN_RUN = { aim: aimNow, settleMs: 2000 };

/** Leaves the body tidy after a chain of primitives: closes any open container and lets go of every key. */
export async function tidyBody(ctx: MinecraftCtx): Promise<void> {
  await doClose(ctx.bot).catch(() => {});
  ctx.locomotion.stop();
}

/** The skills the deciding layers (instinct, planner) may choose: never reflex-only ones, and primitives only if asked. */
export function menuSkills<Ctx>(skills: Skill<Ctx>[], showPrimitives = false): Skill<Ctx>[] {
  return skills.filter((s) => !s.reflexOnly && (showPrimitives || !s.primitive));
}
