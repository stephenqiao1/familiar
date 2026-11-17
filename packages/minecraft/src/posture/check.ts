import type { Vec3 } from "vec3";
import { isSafeToStand } from "../safety.js";
import { breakReason, moveReason, placeReason, type Change, type PostureView } from "./rules.js";
import { postureOf } from "./runtime.js";

const SIDES: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
/** A block can be worked on from this far. */
const REACH = 4.5;
const EYE = 1.62;

/** Why a change would leave the body unsteady or hurt, standing with the feet at `from`; null if it would not. */
export function unsteadyReason(bot: PostureView, change: Change, from: Vec3 = bot.entity.position.floored()): string | null {
  if (change.kind === "break") return breakReason(bot, change.at, from, change.planned);
  if (change.kind === "place") return placeReason(bot, change.at, change.item, from);
  return moveReason(bot, change.to);
}

/** Whether the same change would be safe from one step to the side (still within reach). */
function safeFromTheSide(bot: PostureView, change: Change, from: Vec3): boolean {
  if (change.kind === "move" || (change.kind === "break" && change.planned)) return false;
  return SIDES.some(([dx, dz]) => {
    const side = from.offset(dx, 0, dz);
    if (side.equals(change.at) || !isSafeToStand(bot, side)) return false;
    if (side.offset(0.5, EYE, 0.5).distanceTo(change.at.offset(0.5, 0.5, 0.5)) > REACH) return false;
    return unsteadyReason(bot, change, side) === null;
  });
}

const where = (change: Change) => {
  const p = change.kind === "move" ? change.to : change.at;
  return `${p.x},${p.y},${p.z}`;
};

/**
 * THE CHECK BEFORE ACTING: would this change leave the bot unsteady or hurt? Returns a plain
 * reason to refuse, or null to go ahead. Everything that changes blocks or the bot's position
 * asks it first (break_block, place_block, step, jump, dig_out, and the pathing rules).
 *
 * It only reads the world: it never moves the bot or changes anything. Where one step to the
 * side would make the same action safe, the reason says so. Every refusal and the slowest check
 * are noted for the tick's trace (route planning asks too often to note each one).
 */
export function postureCheck(bot: PostureView, action: string, change: Change): string | null {
  const posture = postureOf(bot);
  if (posture.check <= 0) return null;
  const started = performance.now();
  const from = bot.entity.position.floored();
  let reason = unsteadyReason(bot, change, from);
  if (reason && safeFromTheSide(bot, change, from)) reason = `unsafe from here (${reason}): stand to the side`;
  posture.timed(performance.now() - started);
  if (reason && !(change.kind === "break" && change.planned)) posture.refused({ action, at: where(change), reason }, Date.now());
  return reason;
}
