import type { Skill } from "@familiar/contracts";
import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import type { Block } from "../mc-types.js";
import type { MinecraftCtx } from "../skill-context.js";

const BRIGHT_ENOUGH = 8;
const REACH = 4;
const MAX_ATTEMPTS = 3;
/** Faces a torch can go on: the top (floor torch) or any side (wall torch). Never the underside. */
const FACES = [new Vec3(0, 1, 0), new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];

/** Places a torch on the nearest floor or wall within reach. */
export const placeTorch: Skill<MinecraftCtx> = {
  name: "place_torch",
  description: "Place a torch on the nearest floor or wall within reach, if it's dark.",

  canRun(ctx) {
    return torch(ctx.bot) !== undefined && lightLevel(ctx.bot) < BRIGHT_ENOUGH;
  },

  async run(ctx, _target, signal) {
    const { bot } = ctx;
    const item = torch(bot);
    if (!item) return { status: "failed", reason: "no torches" };
    await bot.equip(item, "hand");

    let lastError = "no floor or wall within reach";
    for (const spot of placementSpots(bot).slice(0, MAX_ATTEMPTS)) {
      if (signal.aborted) return { status: "interrupted" };
      try {
        await bot.placeBlock(spot.ref, spot.face);
        ctx.log(`place_torch: placed at ${spot.ref.position.plus(spot.face)}`);
        return { status: "done" };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
    return { status: "failed", reason: lastError };
  },
};

function torch(bot: Bot) {
  return bot.inventory.items().find((i) => i.name === "torch");
}

/** The brighter of block light and sky light where the bot stands. */
function lightLevel(bot: Bot): number {
  const here = bot.blockAt(bot.entity.position.floored());
  return here ? Math.max(here.light, here.skyLight) : 0;
}

/** Solid blocks with an air face toward the bot, nearest first. */
function placementSpots(bot: Bot): { ref: Block; face: Vec3 }[] {
  const eye = bot.entity.position.offset(0, bot.entity.height, 0);
  const feet = bot.entity.position.floored();
  const spots: { ref: Block; face: Vec3; distance: number }[] = [];

  for (let dx = -REACH; dx <= REACH; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dz = -REACH; dz <= REACH; dz++) {
        const ref = bot.blockAt(feet.offset(dx, dy, dz));
        if (!ref || ref.boundingBox !== "block") continue;
        for (const face of FACES) {
          const spot = ref.position.plus(face);
          const name = bot.blockAt(spot)?.name;
          if (name !== "air" && name !== "cave_air") continue;
          const distance = spot.offset(0.5, 0.5, 0.5).distanceTo(eye);
          if (distance <= REACH) spots.push({ ref, face, distance });
        }
      }
    }
  }
  return spots.sort((a, b) => a.distance - b.distance);
}
