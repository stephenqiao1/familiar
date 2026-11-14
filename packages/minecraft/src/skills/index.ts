import type { Skill } from "@familiar/contracts";
import type { MinecraftCtx } from "../skill-context.js";
import { attack } from "./attack.js";
import { depositItems } from "./deposit-items.js";
import { eat } from "./eat.js";
import { flee } from "./flee.js";
import { goTo } from "./go-to.js";
import { idle } from "./idle.js";
import { returnToBase } from "./return-to-base.js";
import { sleep } from "./sleep.js";
import { takeItems } from "./take-items.js";

/** Every Minecraft skill, for registering with a skill executor. */
export const minecraftSkills: Skill<MinecraftCtx>[] = [goTo, returnToBase, idle, eat, flee, attack, sleep, depositItems, takeItems];
