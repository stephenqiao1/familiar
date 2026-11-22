import type { State } from "@familiar/contracts";
import { needLevels } from "@familiar/neuromodulators";
import { minecraftDataOf } from "./read-state.js";
import { playerRewards } from "./rewards.js";

// Whether the bot got somewhere between two ticks, by what can be seen: a need eased, or ground
// was covered. This is what keeps a running skill protected (see persistence): one that is
// walking, eating or mending is; one standing still, or running on the spot, is not. A skill
// that works without either (digging, waiting on purpose) has to earn its reward in time.

/** Ground covered in one tick counts from this much (standing and turning is not travel)... */
const SOME_GROUND = 0.2;
/** ...up to this much: further is a teleport or a respawn, not the bot's doing. */
const TOO_FAR = 8;
/** A need has eased if its level fell by at least this. */
const EASED = 0.01;

export function madeProgress(before: State, after: State): boolean {
  const [a, b] = [minecraftDataOf(before), minecraftDataOf(after)];
  if (!a || !b || b.self.deaths > a.self.deaths || b.self.displaced) return false;
  const [p, q] = [a.self.position, b.self.position];
  const moved = Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z);
  if (moved >= SOME_GROUND && moved <= TOO_FAR) return true;
  const [was, now] = [needLevels(playerRewards, before), needLevels(playerRewards, after)];
  return Object.entries(now).some(([need, level]) => (was[need] ?? level) - level >= EASED);
}
