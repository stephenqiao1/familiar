import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import type { Block } from "../mc-types.js";
import { findPlacementSpot } from "../placement.js";
import { blockPosOf, reasonOf, withinReach } from "./aim.js";
import { doEquip } from "./equip.js";
import { doLookAt } from "./look-at.js";
import { primitive } from "./primitive.js";

type InventoryItem = ReturnType<Bot["inventory"]["items"]>[number];

const FACES = [new Vec3(0, 1, 0), new Vec3(0, -1, 0), new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];

/** Places the block in hand against one face of a block. Rejects if the server refuses. */
export async function doPlace(bot: Bot, against: Block, face: Vec3): Promise<void> {
  await doLookAt(bot, against.position.offset(0.5, 0.5, 0.5));
  await bot.placeBlock(against, face);
}

/**
 * Places `item` on clear flat ground 2–3 blocks from the bot and returns where it went.
 * `twoLong` reserves room for a bed's head. Throws if there is no spot or the server refuses.
 */
export async function doPlaceNearby(bot: Bot, item: InventoryItem, twoLong = false): Promise<Vec3> {
  const spot = findPlacementSpot(bot, twoLong);
  if (!spot) throw new Error(`no clear flat ground next to the bot to place ${item.name}`);
  await doEquip(bot, item);
  await doLookAt(bot, spot.target.offset(0.5, 0, 0.5));
  await bot.placeBlock(spot.floor, new Vec3(0, 1, 0));
  return spot.target;
}

/** Places the block in hand: at a position within reach, or on clear ground nearby. */
export const placeBlock = primitive({
  name: "place_block",
  description: "Place the block in hand at pos:x,y,z or dir:<direction> within reach (default: on clear ground nearby).",
  parts: ["hands", "head"],
  expects: ["lost"],

  canRun(ctx, target) {
    const { bot } = ctx;
    if (!holdsBlock(bot)) return false;
    return target === undefined ? findPlacementSpot(bot, false) !== null : support(bot, target) !== null;
  },

  async run(ctx, target) {
    const { bot } = ctx;
    const held = bot.heldItem;
    if (!held || !holdsBlock(bot)) return { status: "failed", reason: "no block in hand" };
    try {
      if (target === undefined) {
        await doPlaceNearby(bot, held);
      } else {
        const on = support(bot, target);
        if (!on) return { status: "failed", reason: `nothing to place against at "${target}"` };
        await doPlace(bot, on.block, on.face);
      }
      return { status: "done" };
    } catch (error) {
      return { status: "failed", reason: reasonOf(error) };
    }
  },
});

function holdsBlock(bot: Bot): boolean {
  return bot.heldItem !== null && bot.registry.blocksByName[bot.heldItem.name] !== undefined;
}

/** A solid block next to the (empty, reachable) target position, and the face of it to place against. */
function support(bot: Bot, target: string): { block: Block; face: Vec3 } | null {
  const pos = blockPosOf(bot, target);
  if (!pos || bot.blockAt(pos)?.boundingBox !== "empty" || !withinReach(bot, pos.offset(0.5, 0.5, 0.5))) return null;
  // Not where the bot itself is standing.
  const feet = bot.entity.position.floored();
  if (pos.equals(feet) || pos.equals(feet.offset(0, 1, 0))) return null;
  for (const face of FACES) {
    const block = bot.blockAt(pos.minus(face));
    if (block?.boundingBox === "block") return { block, face };
  }
  return null;
}
