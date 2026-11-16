import type { Bot } from "mineflayer";
import pathfinderPkg from "mineflayer-pathfinder";
import { Vec3 } from "vec3";
import { sleepFor } from "../abort.js";
import type { Block } from "../mc-types.js";
import { holdKey, releaseKeys } from "../primitives/keys.js";
import { doLookAt } from "../primitives/look-at.js";
import { doUseOnBlock } from "../primitives/use-on.js";
import type { Walk } from "./walk.js";

const { GoalBlock } = pathfinderPkg.goals;
/** A door is looked for this close, and counts if the straight line to the aim passes this near it. */
const SEARCH = 6;
const LINE_WITHIN = 1.2;
const REACH_DOOR_MS = 5000;
const THROUGH_MS = 2500;

/** A door to go through: the door, where to stand before it, and where to come out. */
export interface DoorWay {
  door: Vec3;
  front: Vec3;
  beyond: Vec3;
  /** The direction through the doorway (a unit step along x or z). */
  through: Vec3;
}

/**
 * The doorway to use, if the bot and the place it is heading for are on opposite sides of a door
 * that the straight line between them passes through. `axis` is the way through: "x" or "z".
 */
export function doorWay(me: Vec3, aim: Vec3, door: Vec3, axis: "x" | "z"): DoorWay | null {
  const centre = door.offset(0.5, 0, 0.5);
  const n = axis === "x" ? new Vec3(1, 0, 0) : new Vec3(0, 0, 1);
  const side = (p: Vec3) => (p.x - centre.x) * n.x + (p.z - centre.z) * n.z;
  const [mine, theirs] = [side(me), side(aim)];
  if (Math.abs(mine) < 0.3 || Math.abs(theirs) < 0.3 || Math.sign(mine) === Math.sign(theirs)) return null;
  if (Math.abs(me.y - door.y) > 1.5) return null;
  // Where the straight line crosses the door's wall, measured along the wall.
  const t = mine / (mine - theirs);
  const across = axis === "x" ? me.z + (aim.z - me.z) * t - centre.z : me.x + (aim.x - me.x) * t - centre.x;
  if (Math.abs(across) > LINE_WITHIN) return null;
  const from = Math.sign(mine);
  return { door, front: door.plus(n.scaled(from)), beyond: centre.plus(n.scaled(-from * 1.6)), through: from < 0 ? n : new Vec3(0 - n.x, 0, 0 - n.z) };
}

/** The lower halves of the doors close by, each with the way through it. */
function doorsNear(bot: Bot): { block: Block; axis: "x" | "z" }[] {
  const found = bot.findBlocks({ matching: (b) => b.name.endsWith("_door"), maxDistance: SEARCH, count: 8 });
  return found.flatMap((pos) => {
    const block = bot.blockAt(pos);
    const props = block?.getProperties() as { half?: string; facing?: string } | undefined;
    if (!block || props?.half !== "lower") return [];
    return [{ block, axis: props.facing === "east" || props.facing === "west" ? ("x" as const) : ("z" as const) }];
  });
}

/** The doorway between the bot and its aim, if there is one it has not used on this journey. */
export function findDoorWay(bot: Bot, aim: Vec3, used: Set<string>): DoorWay | null {
  for (const { block, axis } of doorsNear(bot)) {
    if (used.has(String(block.position))) continue;
    const way = doorWay(bot.entity.position, aim, block.position, axis);
    if (way) return way;
  }
  return null;
}

/**
 * Goes through a doorway: walks up to it, opens the door if it is closed (with the use_on
 * movement), and steps through. The walking rhythm cannot do this itself: it sees a door as a
 * wall. Returns false if the bot could not get to the door.
 */
export async function passDoor(bot: Bot, way: DoorWay, walk: Walk, signal: AbortSignal): Promise<boolean> {
  walk.start(new GoalBlock(way.front.x, way.front.y, way.front.z), false);
  const started = Date.now();
  while (!walk.reached()) {
    if (Date.now() - started > REACH_DOOR_MS) return false;
    await sleepFor(100, signal);
  }
  walk.stop();
  const door = bot.blockAt(way.door);
  if (door && (door.getProperties() as { open?: boolean }).open === false) {
    await doUseOnBlock(bot, door);
    await sleepFor(250, signal);
  }
  try {
    const out = Date.now();
    const passed = () => {
      const me = bot.entity.position;
      return (me.x - (way.door.x + 0.5)) * way.through.x + (me.z - (way.door.z + 0.5)) * way.through.z > 1;
    };
    while (!passed() && Date.now() - out < THROUGH_MS) {
      await doLookAt(bot, way.beyond.offset(0, bot.entity.height, 0));
      holdKey(bot, "forward", true);
      await sleepFor(50, signal);
    }
    return passed();
  } finally {
    releaseKeys(bot);
  }
}
