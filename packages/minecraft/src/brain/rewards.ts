import { createNoveltyRule, type NoveltyMemory, type Reward, type RewardMoment, type RewardRule } from "@familiar/neuromodulators";
import { newPlace, noticedIn } from "./cues.js";
import type { MinecraftStateData } from "../encode/state-data.js";
import { minecraftDataOf } from "./read-state.js";

// The things that happen to the player and count as a reward or a cost: dying, a failed skill, a
// night slept through. The needs (and the reward for a change in one) are in needs.ts: being
// hurt is the health need rising; losing food, torches or the last tool of a kind is that need
// rising. Every number here is a first guess to tune in play.

const DEATH_PENALTY = -1;
const FAILED_SKILL_PENALTY = -0.1;
/** Reasons a skill is reported failed without ever having started. */
export const NEVER_STARTED = new Set(["cannot run", "unknown skill"]);

/** A rule that only runs on Minecraft states. */
function rule(name: string, need: string, check: (a: MinecraftStateData, b: MinecraftStateData, m: RewardMoment) => Reward | Reward[] | null): RewardRule {
  return {
    name,
    need,
    check(moment) {
      const a = minecraftDataOf(moment.before);
      const b = minecraftDataOf(moment.after);
      return a && b ? check(a, b, moment) : null;
    },
  };
}

/**
 * The start of a new life: the bot died between these two states, or the first was its dead
 * body. A respawn refills health and food and moves the bot away from everything; none of that
 * is something it achieved, so no need is compared across it.
 */
export function newLife(moment: Pick<RewardMoment, "before" | "after">): boolean {
  const a = minecraftDataOf(moment.before);
  const b = minecraftDataOf(moment.after);
  return a !== null && b !== null && (b.self.deaths !== a.self.deaths || a.self.health <= 0);
}

// Rest

/**
 * The sleep skill finished on its own (the bot woke, it was not interrupted) and nothing hurt it:
 * slept through the night. The clock can still read night for a moment after waking, so the time
 * is not checked. (Not a need level: the time since the bot last slept restarts whenever it gets
 * out of a bed, so lying down for a moment would read as a full night's rest.)
 */
export const sleptThroughNight = rule("slept_through_night", "rest", (a, b, { events }) => {
  const slept = events.some((e) => e.skill === "sleep" && e.type === "done");
  return slept && b.self.health >= a.self.health ? { amount: 1, reason: "slept through the night", skill: "sleep" } : null;
});

// Curiosity

/** Boredom, relieved by meeting a kind of thing (mob, useful block, player, biome, item); a thing met often relieves little. */
export function curiosity(memory: NoveltyMemory, bonus?: number): RewardRule {
  return createNoveltyRule({ noticed: (state, ws) => [...noticedIn(state), ...newPlace(ws)], memory, fresh: newLife, ...(bonus === undefined ? {} : { bonus }) });
}

// Things that happen. (Being hurt is the health need rising; losing food, torches or the last tool of a kind is that need rising.)

export const died = rule("died", "safety", (a, b) => {
  const deaths = b.self.deaths - a.self.deaths;
  return deaths > 0 ? { amount: deaths * DEATH_PENALTY, reason: "died", fatal: true } : null;
});

/** A skill that ran and failed: charged to that skill. One that could not start ("cannot run") did not fail at anything. */
export const skillFailed = rule("skill_failed", "progress", (_a, _b, { events }) =>
  events.filter((e) => e.type === "failed" && !NEVER_STARTED.has(e.reason ?? "")).map((e) => ({ amount: FAILED_SKILL_PENALTY, reason: `${e.skill} failed`, skill: e.skill })),
);

// TODO(dopamine): rewards to add once the bot can see or do these things:
// - Progress: a planner sub-goal finished (goals have no "step done" yet); a new tool tier;
//   an advancement unlocked (Mineflayer has no advancement event).
// - Curiosity: first time seeing a structure (structures can't be detected yet).
// - Social: a trade completed; help given or received; a friendly chat. No such skills yet.
//
// Wasted time is not a rule here: the dopamine region charges a skill that ended having earned
// less than the work it took, using the effort measured in effort-spent.ts.

/** Every player reward rule without memory, checked every tick. Add `curiosity(memory)` too. The needs are paid for separately (needs.ts). */
export const playerRewards: RewardRule[] = [sleptThroughNight, died, skillFailed];
