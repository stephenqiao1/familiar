import { Vec3 } from "vec3";
import { surfaceKind } from "../posture/surfaces.js";
import { isDangerousBlock, isDropAt } from "../safety.js";
import type { EncodableBot } from "./encodable-bot.js";
import type { MinecraftStateData } from "./state-data.js";

// The sense of balance: what holds the body up, how it is moving, where a fall would end, and
// one number for how steady all that leaves it. Read fresh each tick; it remembers nothing.

type Self = MinecraftStateData["self"];
export type Support = Self["support"];
export type Landing = NonNullable<Self["landing"]>;

const SIDES = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];
const LIQUIDS = new Set(["water", "lava"]);
/** Blocks the body climbs instead of standing on. (The game's own list; a body knows what it can hold on to.) */
const CLIMBABLE = new Set(["ladder", "vine", "scaffolding", "twisting_vines", "twisting_vines_plant", "weeping_vines", "weeping_vines_plant", "cave_vines", "cave_vines_plant"]);
const MAX_HEADROOM = 3;
const TICKS_PER_SECOND = 20;
/** A fall of more than this many blocks costs health. */
const HARMLESS_FALL = 3;
/** A better landing is looked for this far sideways, and must be at least this much higher than the one below. */
const STEER = { reach: 2, higherBy: 3 };
const SCAN_DOWN = 64;
/** How steady each kind of support is by itself. */
const STEADY: Record<Support["kind"], number> = { solid: 1, loose: 0.7, slippery: 0.6, slow: 0.8, liquid: 0.6, climbing: 0.5, riding: 0.8, none: 0.4 };
const FLOWING_WATER = 0.4;
/** A hop (the ground a block below, or less) barely unsettles the body. */
const HOP = { blocks: 1, steady: 0.9 };
/** What is left of the steadiness with 0 to 4 sides open onto a big drop. One edge is a cliff top; two is a ledge or a bridge. */
const BY_EDGES = [1, 0.85, 0.5, 0.4, 0.3];

/** Whether a block is one the body climbs. */
export function isClimbable(name: string): boolean {
  return CLIMBABLE.has(name);
}

/** What holds the bot up: the block, how it behaves, how many sides fall away, and the room above the head. */
export function supportOf(bot: EncodableBot): Support {
  const pos = bot.entity.position;
  const feet = pos.floored();
  const here = bot.blockAt(feet)?.name ?? "unknown";
  const edges = SIDES.filter((side) => isDropAt(bot, feet.plus(side))).length;
  let headroom = 0;
  while (headroom < MAX_HEADROOM && bot.blockAt(feet.offset(0, 2 + headroom, 0))?.boundingBox === "empty") headroom++;
  const rest = { edges, headroom };
  if (bot.vehicle) return { on: bot.vehicle.name ?? "vehicle", kind: "riding", ...rest };
  if (LIQUIDS.has(here)) return { on: here, kind: "liquid", ...rest };
  if (CLIMBABLE.has(here)) return { on: here, kind: "climbing", ...rest };
  // A little below the feet, so a low block (a slab, soul sand) is still what the body stands on.
  const ground = bot.blockAt(pos.offset(0, -0.2, 0).floored());
  const solid = ground !== null && ground.boundingBox === "block";
  if (!solid || (bot.entity.onGround === false && pos.y - Math.floor(pos.y) > 0.3)) return { on: "air", kind: "none", ...rest };
  return { on: ground.name, kind: surfaceKind(bot, ground.name) ?? "solid", ...rest };
}

/** How the body is moving, in blocks per second, and whether it is on the ground. */
export function velocityOf(bot: EncodableBot): Self["velocity"] {
  const v = bot.entity.velocity ?? { x: 0, y: 0, z: 0 };
  const perSecond = (n: number) => Math.round(n * TICKS_PER_SECOND * 10) / 10 || 0;
  return { x: perSecond(v.x), y: perSecond(v.y), z: perSecond(v.z), onGround: bot.entity.onGround !== false };
}

/** Where a column ends, going down from `from`: how many open blocks, and what is under them. */
function columnEnd(bot: EncodableBot, from: Vec3, limit: number): { blocks: number; onto: string } {
  const floor = bot.game.minY ?? -64;
  for (let d = 0; d <= limit; d++) {
    const pos = from.offset(0, -d, 0);
    if (pos.y < floor) return { blocks: d, onto: "void" };
    const block = bot.blockAt(pos);
    if (!block) return { blocks: d, onto: "unknown" };
    if (block.boundingBox !== "empty" || LIQUIDS.has(block.name)) return { blocks: d, onto: block.name };
  }
  return { blocks: limit, onto: "unknown" };
}

/** Whether coming down `blocks` further onto this would cost health, having fallen `fallen` already. */
function wouldHurt(bot: EncodableBot, onto: string, blocks: number, fallen: number): boolean {
  if (onto === "water") return false;
  if (onto === "void" || onto === "lava" || isDangerousBlock(onto, bot)) return true;
  return fallen + blocks > HARMLESS_FALL;
}

/**
 * Where the fall under way would end, or null when the body is supported. `fallen` is how far
 * it has come down already. `steer` is a better place to land within 2 blocks sideways (water, or
 * ground at least 3 blocks higher), as a target; never somewhere that hurts.
 */
export function landingOf(bot: EncodableBot, support: Support, fallen = 0): Landing | null {
  if (support.kind !== "none") return null;
  const feet = bot.entity.position.floored();
  const { blocks, onto } = columnEnd(bot, feet.offset(0, -1, 0), SCAN_DOWN);
  const hurts = wouldHurt(bot, onto, blocks, fallen);
  return { blocks, onto, hurts, steer: hurts ? betterLanding(bot, feet, blocks) : null };
}

/** The nearest column within reach that is open to move into and ends somewhere better, as "pos:x,y,z". */
function betterLanding(bot: EncodableBot, feet: Vec3, blocks: number): string | null {
  const open = (pos: Vec3) => bot.blockAt(pos)?.boundingBox === "empty";
  let best: { at: Vec3; far: number } | null = null;
  for (let dx = -STEER.reach; dx <= STEER.reach; dx++) {
    for (let dz = -STEER.reach; dz <= STEER.reach; dz++) {
      const far = Math.hypot(dx, dz);
      if (far === 0 || (best && far >= best.far)) continue;
      const top = feet.offset(dx, 0, dz);
      // Nothing in the way at body height, here or half way there.
      const half = feet.offset(Math.round(dx / 2), 0, Math.round(dz / 2));
      if (![top, top.offset(0, 1, 0), half, half.offset(0, 1, 0)].every(open)) continue;
      const end = columnEnd(bot, top.offset(0, -1, 0), blocks + 1);
      const at = top.offset(0, -end.blocks, 0);
      const harmful = end.onto === "lava" || end.onto === "void" || end.onto === "unknown" || isDangerousBlock(end.onto, bot) || isDangerousBlock(bot.blockAt(at)?.name ?? "", bot);
      if (harmful) continue;
      if (end.onto === "water" || end.blocks <= blocks - STEER.higherBy) best = { at, far };
    }
  }
  return best ? `pos:${best.at.x},${best.at.y},${best.at.z}` : null;
}

/**
 * One number for how steady the body is: 1 on flat solid ground with room around; lower on a
 * loose, slippery or slow surface, with edges close, in water (lower still if it flows) or while
 * climbing; 0 in the air over a landing that would hurt.
 */
export function balanceOf(support: Support, landing: Landing | null, flowing = false): number {
  if (support.kind === "none") return landing?.hurts ? 0 : landing && landing.blocks <= HOP.blocks ? HOP.steady : STEADY.none;
  const steady = support.kind === "liquid" && flowing ? FLOWING_WATER : STEADY[support.kind];
  return Math.round(steady * BY_EDGES[Math.min(support.edges, 4)]! * 100) / 100;
}

/** The whole sense, for the state. */
export function balanceSense(bot: EncodableBot, fallen = 0): Pick<Self, "support" | "velocity" | "landing" | "balance"> {
  const support = supportOf(bot);
  const landing = landingOf(bot, support, fallen);
  const here = bot.blockAt(bot.entity.position.floored());
  // Still water has level 0; anything else is moving.
  const flowing = here?.name === "water" && Number(here.getProperties?.().level ?? 0) !== 0;
  return { support, velocity: velocityOf(bot), landing, balance: balanceOf(support, landing, flowing) };
}
