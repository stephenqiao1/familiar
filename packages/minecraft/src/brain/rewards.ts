import { createNoveltyRule, needChangeReward, type NoveltyMemory, type Reward, type RewardMoment, type RewardRule } from "@familiar/neuromodulators";
import { noticedIn } from "./cues.js";
import type { MinecraftStateData } from "../encode/state-data.js";
import { DANGER_DISTANCE, minecraftDataOf, nearestThreat } from "./read-state.js";

// What counts as a reward for the player. Almost every rule is a need level (0 = satisfied, 1 =
// desperate) read from the state; the reward is the signed change in it since the last tick (see
// needChangeReward): a need that falls pays, one that rises costs the same. So being hurt and
// healing, losing a tool and finding it, a threat coming and going all add up to nothing, and
// nothing is paid twice. The rest are things that happen (dying, a failed skill, a night slept
// through). Every number here is a first guess to tune in play.
// Add a need: write its level here with `need(...)` and add it to playerRewards. The bot then also
// learns which things relieve it, and wants them as much as the need presses.

const MAX_FOOD = 20;
const MAX_HEALTH = 20;
const MAX_LIGHT = 15;
/** Enough food items carried; fewer counts as short. */
const FOOD_STOCK_TARGET = 8;
/** Enough torches carried; fewer counts as short. */
const TORCH_TARGET = 16;
const TOOL_KINDS = ["sword", "pickaxe", "axe", "shovel"];
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

/**
 * A need: `level` reads how pressing it is (0 to 1) from a state, or null where it does not
 * apply. The reward is the signed change in that level, described by `say`. `rank` says how
 * vital it is next to the others (see pressingNow): a higher one silences the lower. `weight`
 * says how much it darkens the outlook when unmet (see outlookFrom).
 */
function need(name: string, kind: string, level: (d: MinecraftStateData) => number | null, say: (a: MinecraftStateData, b: MinecraftStateData) => string, { rank = 0, weight = 1 }: { rank?: number; weight?: number } = {}): RewardRule {
  const paid = rule(name, kind, (a, b, moment) => {
    const [before, after] = [level(a), level(b)];
    if (before === null || after === null || before === after || newLife(moment)) return null;
    return { amount: needChangeReward(before, after), reason: say(a, b) };
  });
  return {
    ...paid,
    rank,
    weight,
    level(state) {
      const data = minecraftDataOf(state);
      return data && level(data);
    },
  };
}

// Hunger

export const foodBar = need(
  "food_bar",
  "hunger",
  (d) => 1 - d.self.food / MAX_FOOD,
  (a, b) => `food ${a.self.food} → ${b.self.food}`,
);

// Safety

export const health = need(
  "health",
  "safety",
  (d) => 1 - d.self.health / MAX_HEALTH,
  (a, b) => `health ${a.self.health} → ${b.self.health}`,
);

/**
 * How close the nearest mob that could harm the bot is: 0 with none in range, 1 on top of the bot.
 * The range is wider for one that has noticed the bot (see nearestThreat).
 * It ranks above every other need: with a threat close, nothing else is worth setting off for.
 */
export const danger = need(
  "danger",
  "safety",
  (d) => {
    const threat = nearestThreat(d);
    return threat ? Math.max(0, 1 - threat.dist / threat.within) : 0;
  },
  (a, b) => {
    const [was, now] = [nearestThreat(a), nearestThreat(b)];
    if (!now) return `${was?.type ?? "threat"} gone`;
    return was ? `${now.type} at ${was.dist} → ${now.dist} blocks` : `${now.type} at ${now.dist} blocks`;
  },
  { rank: 1, weight: 2 },
);

/** At night, how dark it is where the bot stands (the nearest thing to shelter the state shows). By day it does not apply. */
export const nightLight = need(
  "night_light",
  "safety",
  (d) => (d.time.isNight ? 1 - d.time.lightLevel / MAX_LIGHT : null),
  (a, b) => `light ${a.time.lightLevel} → ${b.time.lightLevel}`,
);

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

// Having enough

/** Being provided for: lacking it does not make the next minutes bad, so it darkens the outlook only a little. */
const PROVISION = { weight: 0.25 };

/** How many kinds of tool (sword, pickaxe, axe, shovel) the bot has none of. */
export const tools = need(
  "tools",
  "having_enough",
  (d) => TOOL_KINDS.filter((kind) => toolCount(d, kind) === 0).length / TOOL_KINDS.length,
  (a, b) => {
    const [had, has] = [TOOL_KINDS.filter((kind) => toolCount(a, kind) > 0), TOOL_KINDS.filter((kind) => toolCount(b, kind) > 0)];
    const gained = has.filter((kind) => !had.includes(kind));
    const lost = had.filter((kind) => !has.includes(kind));
    return [gained.length ? `now has a ${gained.join(", ")}` : "", lost.length ? `no ${lost.join(", ")} any more` : ""].filter(Boolean).join("; ");
  },  PROVISION,
);

export const foodStock = need(
  "food_stock",
  "having_enough",
  (d) => shortOf(d.self.foodItems, FOOD_STOCK_TARGET),
  (a, b) => `food items ${a.self.foodItems} → ${b.self.foodItems}`,  PROVISION,
);

export const torches = need(
  "torches",
  "having_enough",
  (d) => shortOf(d.self.inventory.torch ?? 0, TORCH_TARGET),
  (a, b) => `torches ${a.self.inventory.torch ?? 0} → ${b.self.inventory.torch ?? 0}`,  PROVISION,
);

// Curiosity

/** Boredom, relieved by meeting a kind of thing (mob, useful block, player, biome, item); a thing met often relieves little. */
export function curiosity(memory: NoveltyMemory, bonus?: number): RewardRule {
  return createNoveltyRule({ noticed: noticedIn, memory, fresh: newLife, ...(bonus === undefined ? {} : { bonus }) });
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

/** Every player reward rule without memory, checked every tick. Add `curiosity(memory)` too. */
export const playerRewards: RewardRule[] = [foodBar, health, danger, nightLight, sleptThroughNight, tools, foodStock, torches, died, skillFailed];

function toolCount(d: MinecraftStateData, kind: string): number {
  return Object.entries(d.self.inventory).reduce((sum, [name, n]) => (name.endsWith(`_${kind}`) ? sum + n : sum), 0);
}

/** How short of `target` a count is: 0 = enough, 1 = none. */
function shortOf(count: number, target: number): number {
  return 1 - Math.min(count, target) / target;
}
