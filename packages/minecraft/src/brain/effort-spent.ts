import type { RewardMoment } from "@familiar/neuromodulators";
import { minecraftDataOf } from "./read-state.js";

// How hard the body worked between two ticks, in reward units: what that stretch costs if the
// skill it was for comes to nothing (see wastedEffort in the dopamine region). Three things count:
// ground covered, time spent busy, and food energy burned. Every number is a first guess to tune
// in play. For scale: finding half the food the bot is short of is worth 0.5, a failed skill -0.1.

/** One block travelled. A 40-block walk for nothing costs about as much as a failed skill. */
const PER_BLOCK = 1 / 400;
/** One second spent on a skill, moving or not (digging, waiting at a chest). */
const PER_BUSY_SECOND = 1 / 400;
/** Walking speed, blocks a second. */
const WALK_SPEED = 4.3;
/** What one block of a walk costs: the ground and the time it takes. */
export const WORK_PER_BLOCK = PER_BLOCK + PER_BUSY_SECOND / WALK_SPEED;
/** One point of the food bar or its hidden reserve used up (sprinting, jumping, fighting). */
const PER_FOOD_POINT = 1 / 40;
/** Further than this between two ticks is not walking (a teleport, a respawn). */
const MAX_BLOCKS = 8;
/** A longer gap between two ticks is a pause in the brain, not work. */
const MAX_SECONDS = 2;

/**
 * The work done between the two states, or 0 if either is not a Minecraft state. Time counts as
 * work only while the running skill uses the body: `usesBody` says so for a skill by name
 * (default: every skill does). Lying asleep is never work.
 */
export function effortSpent({ before, after }: Pick<RewardMoment, "before" | "after">, usesBody: (skill: string) => boolean = () => true): number {
  const a = minecraftDataOf(before);
  const b = minecraftDataOf(after);
  if (!a || !b || b.self.deaths > a.self.deaths) return 0;

  const [p, q] = [a.self.position, b.self.position];
  const moved = Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z);
  const blocks = b.self.displaced || moved > MAX_BLOCKS ? 0 : moved;

  const skill = b.current?.skill ?? a.current?.skill;
  const resting = b.self.asleep || (skill !== undefined && !usesBody(skill));
  const seconds = resting ? 0 : Math.min(MAX_SECONDS, Math.max(0, (after.timestamp - before.timestamp) / 1000));

  // Mending a wound burns food too; that is healing, not work.
  const burned = b.self.healing ? 0 : Math.max(0, a.self.food + a.self.saturation - (b.self.food + b.self.saturation));

  return blocks * PER_BLOCK + seconds * PER_BUSY_SECOND + burned * PER_FOOD_POINT;
}
