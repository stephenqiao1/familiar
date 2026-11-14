import { createNoveltyRule, needDropReward, type NoveltyMemory, type Reward, type RewardMoment, type RewardRule } from "@familiar/neuromodulators";
import { noticedIn } from "./cues.js";
import type { MinecraftStateData } from "../encode/state-data.js";
import { DANGER_DISTANCE, minecraftDataOf, nearestThreat } from "./read-state.js";

// What counts as a reward for the player: any moment a need gets smaller, scaled by how big the
// need was (see needDropReward). Negative rewards are bad things happening. Every number here is
// a first guess to tune in play. Add a reward: write a rule here and add it to playerRewards.

const MAX_FOOD = 20;
const MAX_HEALTH = 20;
const MAX_LIGHT = 15;
/** Enough food items carried; fewer counts as short. */
const FOOD_STOCK_TARGET = 8;
/** Enough torches carried; fewer counts as short. */
const TORCH_TARGET = 16;
const TOOL_KINDS = ["sword", "pickaxe", "axe", "shovel"];
/** Skills that use up items on purpose, so a drop while they run is not a loss. */
const SPENDING_SKILLS = new Set(["eat", "deposit_items"]);
const DEATH_PENALTY = -1;
/** Per item lost, capped at -1 for one tick. */
const LOST_ITEM_PENALTY = -1 / 64;
const FAILED_SKILL_PENALTY = -0.1;
/** Reasons a skill is reported failed without ever having started. */
export const NEVER_STARTED = new Set(["cannot run", "unknown skill"]);

/** A rule that only runs on Minecraft states. */
function rule(name: string, need: string, check: (a: MinecraftStateData, b: MinecraftStateData, m: RewardMoment) => Reward | null): RewardRule {
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

/** A reward when the need level fell, else null. */
function needDrop(before: number, after: number, reason: string): Reward | null {
  const amount = needDropReward(before, after);
  return amount > 0 ? { amount, reason } : null;
}

// Hunger

export const foodBarUp = rule("food_bar_up", "hunger", (a, b) =>
  needDrop(1 - a.self.food / MAX_FOOD, 1 - b.self.food / MAX_FOOD, `food ${a.self.food} → ${b.self.food}`),
);

// Safety

export const healthUp = rule("health_up", "safety", (a, b) =>
  needDrop(1 - a.self.health / MAX_HEALTH, 1 - b.self.health / MAX_HEALTH, `health ${a.self.health} → ${b.self.health}`),
);

/** A hostile mob that was close is gone (killed or out of range), and none is close now. */
export const threatGone = rule("threat_gone", "safety", (a, b) => {
  const was = nearestThreat(a);
  if (!was || nearestThreat(b)) return null;
  return needDrop(1 - was.dist / DANGER_DISTANCE, 0, `${was.type} gone`);
});

/** At night, the bot reached more light (the nearest thing to shelter the state shows). */
export const reachedLight = rule("reached_light", "safety", (a, b) => {
  if (!a.time.isNight || !b.time.isNight) return null;
  return needDrop(1 - a.time.lightLevel / MAX_LIGHT, 1 - b.time.lightLevel / MAX_LIGHT, `light ${a.time.lightLevel} → ${b.time.lightLevel}`);
});

// Rest

/**
 * The sleep skill finished on its own (the bot woke, it was not interrupted) and nothing hurt it:
 * slept through the night. The clock can still read night for a moment after waking, so the time
 * is not checked.
 */
export const sleptThroughNight = rule("slept_through_night", "rest", (a, b, { events }) => {
  const slept = events.some((e) => e.skill === "sleep" && e.type === "done");
  return slept && b.self.health >= a.self.health ? needDrop(1, 0, "slept through the night") : null;
});

// Having enough

/** The first tool of a kind (sword, pickaxe, axe, shovel). */
export const firstTool = rule("first_tool", "having_enough", (a, b) => {
  const fresh = TOOL_KINDS.filter((kind) => toolCount(a, kind) === 0 && toolCount(b, kind) > 0);
  return fresh.length ? { amount: fresh.length * needDropReward(1, 0), reason: `first ${fresh.join(", ")}` } : null;
});

export const foodStockUp = rule("food_stock_up", "having_enough", (a, b) =>
  needDrop(shortOf(a.self.foodItems, FOOD_STOCK_TARGET), shortOf(b.self.foodItems, FOOD_STOCK_TARGET), `food items ${a.self.foodItems} → ${b.self.foodItems}`),
);

export const torchesUp = rule("torches_up", "having_enough", (a, b) => {
  const [before, after] = [a.self.inventory.torch ?? 0, b.self.inventory.torch ?? 0];
  return needDrop(shortOf(before, TORCH_TARGET), shortOf(after, TORCH_TARGET), `torches ${before} → ${after}`);
});

// Curiosity

/** Meeting a new kind of thing (mob, useful block, player, biome, item); halves with each meeting. */
export function curiosity(memory: NoveltyMemory, bonus?: number): RewardRule {
  return createNoveltyRule({ noticed: noticedIn, memory, ...(bonus === undefined ? {} : { bonus }) });
}

// Negative rewards: the need each one sets back is in its `need`.

export const damageTaken = rule("damage_taken", "safety", (a, b) => {
  const lost = a.self.health - b.self.health;
  return lost > 0 ? { amount: -lost / MAX_HEALTH, reason: `health ${a.self.health} → ${b.self.health}` } : null;
});

export const died = rule("died", "safety", (a, b) => {
  const deaths = b.self.deaths - a.self.deaths;
  return deaths > 0 ? { amount: deaths * DEATH_PENALTY, reason: "died", fatal: true } : null;
});

/** Items gone that no skill spent on purpose (eating, storing). */
export const lostItems = rule("lost_items", "having_enough", (a, b, { events }) => {
  const spending = [a.current?.skill, b.current?.skill, ...events.map((e) => e.skill)].some((s) => s !== undefined && SPENDING_SKILLS.has(s));
  if (spending) return null;
  const lost = Object.entries(a.self.inventory).filter(([name, n]) => (b.self.inventory[name] ?? 0) < n);
  if (!lost.length) return null;
  const count = lost.reduce((sum, [name, n]) => sum + n - (b.self.inventory[name] ?? 0), 0);
  return { amount: Math.max(-1, count * LOST_ITEM_PENALTY), reason: `lost ${lost.map(([name]) => name).join(", ")}` };
});

/** A skill that ran and failed. One that could not start ("cannot run") did not fail at anything. */
export const skillFailed = rule("skill_failed", "progress", (_a, _b, { events }) => {
  const failed = events.filter((e) => e.type === "failed" && !NEVER_STARTED.has(e.reason ?? ""));
  return failed.length ? { amount: failed.length * FAILED_SKILL_PENALTY, reason: `${failed.map((e) => e.skill).join(", ")} failed` } : null;
});

// TODO(dopamine): rewards to add once the bot can see or do these things:
// - Progress: a planner sub-goal finished (goals have no "step done" yet); a new tool tier;
//   an advancement unlocked (Mineflayer has no advancement event).
// - Curiosity: first time seeing a structure (structures can't be detected yet).
// - Social: a trade completed; help given or received; a friendly chat. No such skills yet.
// - Wasted time (negative): not defined yet. One idea: a small penalty for each stretch of time
//   with no positive reward.

/** Every player reward rule without memory, checked every tick. Add `curiosity(memory)` too. */
export const playerRewards: RewardRule[] = [
  foodBarUp,
  healthUp,
  threatGone,
  reachedLight,
  sleptThroughNight,
  firstTool,
  foodStockUp,
  torchesUp,
  damageTaken,
  died,
  lostItems,
  skillFailed,
];

function toolCount(d: MinecraftStateData, kind: string): number {
  return Object.entries(d.self.inventory).reduce((sum, [name, n]) => (name.endsWith(`_${kind}`) ? sum + n : sum), 0);
}

/** How short of `target` a count is: 0 = enough, 1 = none. */
function shortOf(count: number, target: number): number {
  return 1 - Math.min(count, target) / target;
}
