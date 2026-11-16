import { Vec3 } from "vec3";
import type { Touching } from "../pain.js";
import { dangerAt } from "../safety.js";
import type { EncodableBot } from "./encodable-bot.js";

const SIDES = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];
const EYE_HEIGHT = 1.62;
/** How far along a direction of travel danger is looked for. */
const LOOK_AHEAD = 2;

/** The blocks the body is touching: at the feet, at the head, under the feet and on the four sides. */
export function touchingOf(bot: EncodableBot): Touching {
  const feet = bot.entity.position.floored();
  const name = (pos: Vec3) => bot.blockAt(pos)?.name ?? "unknown";
  return { feet: name(feet), head: name(feet.offset(0, 1, 0)), below: name(feet.offset(0, -1, 0)), sides: SIDES.map((side) => name(feet.plus(side))) };
}

/** The head is inside a solid block: being buried. */
export function headInBlock(bot: EncodableBot): boolean {
  return bot.blockAt(bot.entity.position.offset(0, EYE_HEIGHT, 0))?.boundingBox === "block";
}

/**
 * The first danger within 2 blocks along a direction from where the bot stands: a big drop, or a
 * block it knows hurts. A wall in the way ends the search (nothing beyond it can be walked into).
 */
export function dangerAlong(bot: EncodableBot, toward: { x: number; z: number }): { what: string; blocks: number } | null {
  const from = bot.entity.position;
  const here = from.floored();
  for (let n = 1; n <= LOOK_AHEAD; n++) {
    const cell = new Vec3(from.x + toward.x * n, from.y, from.z + toward.z * n).floored();
    if (cell.equals(here)) continue;
    const what = dangerAt(bot, cell);
    if (what) return { what, blocks: n };
    if (bot.blockAt(cell)?.boundingBox === "block" && bot.blockAt(cell.offset(0, 1, 0))?.boundingBox === "block") return null;
  }
  return null;
}
