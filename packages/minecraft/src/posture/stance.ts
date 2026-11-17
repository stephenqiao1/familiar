import type { BodyPart } from "@familiar/contracts";
import type { Bot } from "mineflayer";
import { nearDrop } from "../locomotion/tick.js";
import { doSneak } from "../primitives/sneak.js";
import { touchesHurt } from "../safety.js";
import { postureOf } from "./runtime.js";

// Stance: keeping steady while doing something else. A sneaking body cannot walk off an edge, so
// while the hands or head are busy near a big drop or something that hurts, sneak is held.

/** The bot stands within one block of a drop of 3 or more, or of something it knows hurts. */
export function onPrecariousGround(bot: Bot): boolean {
  return nearDrop(bot) || touchesHurt(bot, bot.entity.position.floored());
}

/**
 * Holds sneak for the length of an action that leaves the legs free, if the bot is on
 * precarious ground; returns what lets go (and says whether it held). It lets go at once when
 * `signal` fires: a hard reflex taking over must not be slowed by sneaking.
 *
 * Nothing is held when the action uses the legs, when the legs are already travelling or
 * sneaking, in the air or in water, or when sneaking would change what the action does.
 */
export function holdStance(bot: Bot, action: { name: string; parts: BodyPart[]; standing?: boolean }, travelling: boolean, signal: AbortSignal): { held: boolean; release(): void } {
  const posture = postureOf(bot);
  const free = !action.parts.includes("legs") && !action.standing && !travelling;
  const grounded = bot.entity.onGround !== false && !(bot.entity as { isInWater?: boolean }).isInWater;
  if (posture.stance <= 0 || !free || !grounded || signal.aborted || bot.getControlState("sneak") || !onPrecariousGround(bot)) return { held: false, release: () => {} };
  let holding = true;
  const release = () => {
    if (!holding) return;
    holding = false;
    signal.removeEventListener("abort", release);
    doSneak(bot, false);
  };
  doSneak(bot, true);
  signal.addEventListener("abort", release, { once: true });
  posture.note("stance", action.name);
  return { held: true, release };
}
