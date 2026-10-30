import type { Skill } from "@familiar/contracts";
import type { MinecraftCtx } from "../skill-context.js";
import { attack } from "./attack.js";
import { craftPickaxe } from "./craft-pickaxe.js";
import { depositItems } from "./deposit-items.js";
import { digTunnel } from "./dig-tunnel.js";
import { eat } from "./eat.js";
import { flee } from "./flee.js";
import { goTo } from "./go-to.js";
import { idle } from "./idle.js";
import { mineBlock } from "./mine-block.js";
import { placeTorch } from "./place-torch.js";
import { returnToBase } from "./return-to-base.js";
import { sleep } from "./sleep.js";

/** Every Minecraft skill, for registering with a skill executor. */
export const minecraftSkills: Skill<MinecraftCtx>[] = [
  goTo,
  returnToBase,
  idle,
  eat,
  flee,
  attack,
  sleep,
  mineBlock,
  digTunnel,
  placeTorch,
  craftPickaxe,
  depositItems,
];
