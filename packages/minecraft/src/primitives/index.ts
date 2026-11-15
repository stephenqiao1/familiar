import type { Skill } from "@familiar/contracts";
import type { MinecraftCtx } from "../skill-context.js";
import { brace } from "./brace.js";
import { breakBlock } from "./break-block.js";
import { hit } from "./hit.js";
import { jump } from "./jump.js";
import { lookAt } from "./look-at.js";
import { pickUp } from "./pick-up.js";
import { placeBlock } from "./place-block.js";
import { stepToward } from "./step-toward.js";
import { useItem } from "./use-item.js";

/**
 * The built-in actions: the only things a body "just has". Each is tiny, can be stopped, and is
 * over in about a second. Learned skills will later be built from these. Reflexes can always use
 * them; they are off the decision menu unless --primitives is given.
 */
export const primitives: Skill<MinecraftCtx>[] = [lookAt, stepToward, jump, breakBlock, placeBlock, useItem, hit, pickUp, brace];
