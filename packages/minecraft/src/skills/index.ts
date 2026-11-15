import type { Skill } from "@familiar/contracts";
import type { MinecraftCtx } from "../skill-context.js";
import { attack } from "./attack.js";
import { primitives } from "../primitives/index.js";
import { releaseKeys } from "../primitives/keys.js";
import { doClose } from "../primitives/windows.js";
import { depositItems } from "./deposit-items.js";
import { eat } from "./eat.js";
import { escapeHazard } from "./escape-hazard.js";
import { flee } from "./flee.js";
import { goTo } from "./go-to.js";
import { idle } from "./idle.js";
import { returnToBase } from "./return-to-base.js";
import { sleep } from "./sleep.js";
import { surface } from "./surface.js";
import { takeItems } from "./take-items.js";

/**
 * Every Minecraft skill, for registering with a skill executor: the learned-style skills, the two
 * reflex-only ones, and the primitives. Use `menuSkills` for what the deciding layers may choose.
 */
export const minecraftSkills: Skill<MinecraftCtx>[] = [goTo, returnToBase, idle, eat, flee, attack, sleep, depositItems, takeItems, escapeHazard, surface, ...primitives];

/** Leaves the body tidy after a chain of primitives: closes any open container and lets go of every key. */
export async function tidyBody(ctx: MinecraftCtx): Promise<void> {
  await doClose(ctx.bot).catch(() => {});
  releaseKeys(ctx.bot);
}

/** The skills the deciding layers (instinct, planner) may choose: never reflex-only ones, and primitives only if asked. */
export function menuSkills<Ctx>(skills: Skill<Ctx>[], showPrimitives = false): Skill<Ctx>[] {
  return skills.filter((s) => !s.reflexOnly && (showPrimitives || !s.primitive));
}
