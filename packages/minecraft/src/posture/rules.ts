import { Vec3 } from "vec3";
import { isClimbable } from "../encode/balance.js";
import { isDangerousBlock, isSafeToStand, type WorldView } from "../safety.js";
import { surfaceKind } from "./surfaces.js";

// The reasons an action would leave the body unsteady or hurt. Each rule only reads the world;
// none moves the bot or changes anything. Add a reason to refuse an action here.

/** A change the bot is about to make to the world or to where it stands. */
export type Change =
  /** Break the block at `at`. `planned`: asked while planning a route, when where the body will be is not yet known. */
  | { kind: "break"; at: Vec3; planned?: boolean }
  /** Place `item` at `at`. */
  | { kind: "place"; at: Vec3; item: string | null }
  /** End up standing with the feet at `to`. */
  | { kind: "move"; to: Vec3 };

/** What the rules read: the world, and the facing of blocks that hang on others. */
export interface PostureView extends WorldView {
  blockAt(pos: Vec3): { name: string; boundingBox: string; getProperties?(): Record<string, unknown> } | null;
}

const LIQUIDS = new Set(["lava", "water"]);
const SAFE_DROP = 3;
const NEIGHBOURS = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 1, 0), new Vec3(0, -1, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];
const FACING: Record<string, Vec3> = { north: new Vec3(0, 0, -1), south: new Vec3(0, 0, 1), east: new Vec3(1, 0, 0), west: new Vec3(-1, 0, 0) };
/** A falling column is followed this far up and down. */
const COLUMN = 4;

const nameAt = (bot: PostureView, pos: Vec3) => bot.blockAt(pos)?.name ?? "unknown";
const isLoose = (bot: PostureView, name: string) => surfaceKind(bot, name) === "loose";
const isEmpty = (bot: PostureView, pos: Vec3) => bot.blockAt(pos)?.boundingBox === "empty";

/** The cells a loose block above `at` would come to rest in, once `at` is open. */
function restCells(bot: PostureView, at: Vec3, count: number): Vec3[] {
  let bottom = at;
  for (let d = 0; d < COLUMN && isEmpty(bot, bottom.offset(0, -1, 0)); d++) bottom = bottom.offset(0, -1, 0);
  return Array.from({ length: count }, (_, i) => bottom.offset(0, i, 0));
}

/** How many loose blocks sit in a run straight above `at`. */
function looseAbove(bot: PostureView, at: Vec3): number {
  let count = 0;
  while (count < COLUMN && isLoose(bot, nameAt(bot, at.offset(0, 1 + count, 0)))) count++;
  return count;
}

/** The blocks a climbing block hangs from: behind a ladder, beside a vine, else the block above. */
function hangsFrom(bot: PostureView, at: Vec3): Vec3[] {
  const props = bot.blockAt(at)?.getProperties?.() ?? {};
  const facing = typeof props.facing === "string" ? FACING[props.facing] : undefined;
  if (facing) return [at.minus(facing)];
  const sides = Object.entries(FACING).filter(([side]) => props[side] === true || props[side] === "true").map(([, dir]) => at.plus(dir));
  return sides.length ? sides : [at.offset(0, 1, 0)];
}

/** Why breaking the block at `at` would be unsafe for a body standing with its feet at `from`, or null. */
export function breakReason(bot: PostureView, at: Vec3, from: Vec3, planned = false): string | null {
  for (const side of NEIGHBOURS) {
    const name = nameAt(bot, at.plus(side));
    if (LIQUIDS.has(name)) return `would let ${name} in`;
  }
  const loose = looseAbove(bot, at);
  const falling = loose > 0 ? nameAt(bot, at.offset(0, 1, 0)) : "";
  // Planning a route, the body will be right behind the block when it breaks.
  if (planned) return loose > 0 ? `would bring the ${falling} above it down` : null;

  const body = [from, from.offset(0, 1, 0)];
  const inBody = body.some((cell) => cell.equals(at));
  const under = from.offset(0, -1, 0);
  if (at.equals(under)) {
    let depth = 1;
    while (depth < SAFE_DROP && isEmpty(bot, at.offset(0, -depth, 0))) depth++;
    if (depth >= SAFE_DROP) return `would drop me ${SAFE_DROP} blocks or more`;
    const onto = nameAt(bot, at.offset(0, -depth, 0));
    if (LIQUIDS.has(onto) || isDangerousBlock(onto, bot)) return `would drop me onto ${onto}`;
  }
  // Climbing: the block being climbed, and what it hangs from.
  for (const cell of body) {
    const name = nameAt(bot, cell);
    if (!isClimbable(name)) continue;
    if (at.equals(cell)) return `would break the ${name} I am climbing`;
    if (hangsFrom(bot, cell).some((pos) => pos.equals(at))) return `would break what the ${name} I am climbing hangs from`;
  }
  // Standing on a loose block: what it rests on.
  const ground = nameAt(bot, under);
  if (isLoose(bot, ground) && at.equals(under.offset(0, -1, 0))) return `would take away what the ${ground} under me rests on`;
  // A loose column above the block comes down when it goes. Already inside the block, digging cannot make that worse.
  if (loose > 0 && !inBody) {
    if (restCells(bot, at, loose).some((cell) => body.some((b) => b.equals(cell)))) return `would bring the ${falling} down on me`;
    const beside = Math.abs(at.x - from.x) + Math.abs(at.z - from.z) === 1;
    if (beside && at.y === from.y + 1) return `would bring the ${falling} down beside my head`;
  }
  return null;
}

/** Why placing `item` at `at` would be unsafe, or null: a loose block set where it would fall onto the body. */
export function placeReason(bot: PostureView, at: Vec3, item: string | null, from: Vec3): string | null {
  if (item === null || !isLoose(bot, item)) return null;
  const body = [from, from.offset(0, 1, 0)];
  return restCells(bot, at, 1).some((cell) => body.some((b) => b.equals(cell))) ? `would bring the ${item} down on me` : null;
}

/** Why ending up with the feet at `to` (or a block up or down from it) would be unsafe, or null. */
export function moveReason(bot: PostureView, to: Vec3): string | null {
  // One block up or down is an ordinary step.
  if ([0, -1, 1].some((dy) => isSafeToStand(bot, to.offset(0, dy, 0)))) return null;
  if ([1, 2].every((d) => isEmpty(bot, to.offset(0, -d, 0)))) return "nothing to stand on there";
  if (![0, 1].every((d) => isEmpty(bot, to.offset(0, d, 0)))) return "not enough headroom there";
  return "nowhere safe to stand there";
}
