import type { Skill } from "@familiar/contracts";
import type { MinecraftCtx } from "../skill-context.js";
import { brace } from "./brace.js";
import { breakBlock } from "./break-block.js";
import { close } from "./close.js";
import { craft } from "./craft.js";
import { dropItem } from "./drop-item.js";
import { equip } from "./equip.js";
import { hit } from "./hit.js";
import { jump } from "./jump.js";
import { lookAt } from "./look-at.js";
import { moveItem } from "./move-item.js";
import { open } from "./open.js";
import { pickUp } from "./pick-up.js";
import { placeBlock } from "./place-block.js";
import { sneak } from "./sneak.js";
import { step } from "./step.js";
import { stepToward } from "./step-toward.js";
import { turn } from "./turn.js";
import { useItem } from "./use-item.js";
import { useOn } from "./use-on.js";

/**
 * The built-in movements: the only things a body "just has", and the single doorway to it. Every
 * skill acts through these files' functions; nothing else touches the bot's body (pathfinding
 * aside, which is the walking rhythm). Each is small, can be stopped, fails cleanly with a
 * reason, and reports what it changed. Learned skills are chains of these. Reflexes can always
 * use them; they are off the decision menu unless --primitives is given.
 */
export const primitives: Skill<MinecraftCtx>[] = [
  // head
  lookAt, turn,
  // legs
  step, stepToward, jump, sneak, brace, pickUp,
  // hands
  equip, dropItem, useItem, useOn, hit, breakBlock, placeBlock, open, moveItem, close, craft,
];
