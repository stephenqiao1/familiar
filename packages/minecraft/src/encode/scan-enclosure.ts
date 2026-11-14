import { Vec3 } from "vec3";
import type { EncodableBot } from "./encodable-bot.js";

/** A roof or wall further than this many blocks away does not count. */
const REACH = 6;
/** Walls needed out of the four sides. */
const WALLS_NEEDED = 3;
const UP = new Vec3(0, 1, 0);
const SIDES = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];

/** Per registry: the block states something can move through (air, water, plants, ...). */
const openStates = new WeakMap<object, Set<number>>();

/**
 * Whether the bot stands in a sheltered spot: a roof overhead and a wall on at least three of
 * its four sides, each within 6 blocks. It looks straight up and straight out from head height,
 * so it is quick, but a gap off to one side is not seen. Unloaded blocks count as open.
 */
export function isEnclosed(bot: EncodableBot): boolean {
  const head = bot.entity.position.floored().plus(UP);
  if (!solidWithin(bot, head, UP)) return false;
  return SIDES.filter((side) => solidWithin(bot, head, side)).length >= WALLS_NEEDED;
}

/** Whether a solid block lies within reach of `from`, going one block at a time in `direction`. */
function solidWithin(bot: EncodableBot, from: Vec3, direction: Vec3): boolean {
  const open = openStatesOf(bot);
  for (let i = 1; i <= REACH; i++) {
    const state = bot.world.getBlockStateId(from.plus(direction.scaled(i)));
    if (state !== undefined && !open.has(state)) return true;
  }
  return false;
}

function openStatesOf(bot: EncodableBot): Set<number> {
  let states = openStates.get(bot.registry);
  if (!states) {
    states = new Set();
    for (const block of bot.registry.blocksArray) {
      if (block.boundingBox === "empty") for (let s = block.minStateId; s <= block.maxStateId; s++) states.add(s);
    }
    openStates.set(bot.registry, states);
  }
  return states;
}
