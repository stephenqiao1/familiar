import type { Skill } from "@familiar/contracts";
import type { Bot } from "mineflayer";
import pathfinder from "mineflayer-pathfinder";
import type { Vec3 } from "vec3";
import { countItems, craftOnce } from "../crafting.js";
import { findBlockNear } from "../find-nearby.js";
import type { Block } from "../mc-types.js";
import { placeNearby } from "../placement.js";
import type { MinecraftCtx } from "../skill-context.js";
import { walkTo } from "../walk-to.js";
import { assignWood, type WoodJob } from "../wood-plan.js";

const { GoalLookAtBlock } = pathfinder.goals;
const TABLE_RADIUS = 16;
const PLANKS_PER_LOG = 4;
const HEAD_COST = 3;
const STICKS_NEEDED = 2;

const isPlanks = (n: string) => n.endsWith("_planks");
const isLog = (n: string) => n.endsWith("_log") || n.endsWith("_stem");
const isTable = (n: string) => n === "crafting_table";

/** Best first. Each head must be 3 of one material: recipes don't mix cobblestone with deepslate, or oak with birch. */
const TIERS = [
  { pickaxe: "iron_pickaxe", heads: ["iron_ingot"] },
  { pickaxe: "stone_pickaxe", heads: ["cobblestone", "cobbled_deepslate", "blackstone"] },
  { pickaxe: "wooden_pickaxe", heads: [] }, // planks: assigned with the other wood jobs
];

/** One craft step, and the ingredient whose recipe it must use. */
interface Step {
  item: string;
  using: string;
}

interface Plan {
  pickaxe: Step;
  sticks: Step | null;
  table: Step | null;
}

/** Crafts the best pickaxe the inventory allows, making planks, sticks and a crafting table as needed. */
export const craftPickaxe: Skill<MinecraftCtx> = {
  name: "craft_pickaxe",
  description: "Craft the best pickaxe possible (iron > stone > wood), making planks, sticks and a table if needed.",

  canRun(ctx) {
    return plan(ctx.bot) !== null;
  },

  async run(ctx, _target, signal) {
    const { bot } = ctx;
    const chosen = plan(bot);
    if (!chosen) return { status: "failed", reason: "not enough materials for any pickaxe" };
    ctx.log(`craft_pickaxe: making ${chosen.pickaxe.item} from ${chosen.pickaxe.using}`);

    try {
      if (chosen.sticks) await craftWithWood(bot, chosen.sticks, 2, null, signal);
      if (chosen.table) await craftWithWood(bot, chosen.table, 4, null, signal);

      signal.throwIfAborted();
      const table = await reachTable(bot, signal);
      if ("reason" in table) return { status: "failed", reason: table.reason };

      if (isPlanks(chosen.pickaxe.using)) await craftWithWood(bot, chosen.pickaxe, HEAD_COST, table.block, signal);
      else await craftOnce(bot, chosen.pickaxe.item, table.block, chosen.pickaxe.using);
      ctx.log(`craft_pickaxe: crafted ${chosen.pickaxe.item}`);
      return { status: "done" };
    } catch (error) {
      if (signal.aborted) return { status: "interrupted" };
      return { status: "failed", reason: error instanceof Error ? error.message : String(error) };
    }
  },
};

/** The best affordable pickaxe, with a wood type picked for every step that needs planks. */
function plan(bot: Bot): Plan | null {
  const stock = woodStock(bot);
  const needSticks = countItems(bot, (n) => n === "stick") < STICKS_NEEDED;
  const needTable = countItems(bot, isTable) === 0 && findBlockNear(bot, isTable, TABLE_RADIUS) === null;

  for (const tier of TIERS) {
    const wooden = tier.heads.length === 0;
    const head = tier.heads.find((h) => countItems(bot, (n) => n === h) >= HEAD_COST);
    if (!wooden && !head) continue;

    const jobs: WoodJob[] = [];
    if (needSticks) jobs.push({ item: "stick", planks: 2 });
    if (needTable) jobs.push({ item: "crafting_table", planks: 4 });
    if (wooden) jobs.push({ item: tier.pickaxe, planks: HEAD_COST });

    const woods = assignWood(stock, jobs);
    if (!woods) continue;
    const stepFor = (item: string): Step | null => {
      const i = jobs.findIndex((j) => j.item === item);
      return i < 0 ? null : { item, using: woods[i]! };
    };
    return {
      pickaxe: wooden ? stepFor(tier.pickaxe)! : { item: tier.pickaxe, using: head! },
      sticks: stepFor("stick"),
      table: stepFor("crafting_table"),
    };
  }
  return null;
}

/** Planks available per wood type, counting each log as the 4 planks it would make. */
function woodStock(bot: Bot): Map<string, number> {
  const stock = new Map<string, number>();
  for (const item of bot.inventory.items()) {
    const planks = isPlanks(item.name) ? item.name : isLog(item.name) ? planksFor(item.name) : null;
    if (!planks) continue;
    const amount = isPlanks(item.name) ? item.count : item.count * PLANKS_PER_LOG;
    stock.set(planks, (stock.get(planks) ?? 0) + amount);
  }
  return stock;
}

/** Makes sure there are `planks` of the step's wood (from matching logs), then crafts it with that wood. */
async function craftWithWood(bot: Bot, step: Step, planks: number, table: Block | null, signal: AbortSignal) {
  while (countItems(bot, (n) => n === step.using) < planks) {
    signal.throwIfAborted();
    const log = bot.inventory.items().find((i) => isLog(i.name) && planksFor(i.name) === step.using);
    if (!log) throw new Error(`ran out of logs for ${step.using}`);
    await craftOnce(bot, step.using, null, log.name);
  }
  signal.throwIfAborted();
  await craftOnce(bot, step.item, table, step.using);
}

/** oak_log → oak_planks, stripped_birch_log → birch_planks, crimson_stem → crimson_planks. */
function planksFor(log: string): string {
  return log.replace(/^stripped_/, "").replace(/_(log|stem)$/, "_planks");
}

/** Nearest table within 16 blocks, else one from the inventory placed nearby; then walk to it. */
async function reachTable(bot: Bot, signal: AbortSignal): Promise<{ block: Block } | { reason: string }> {
  let pos: Vec3 | null = findBlockNear(bot, isTable, TABLE_RADIUS);
  if (!pos) {
    const item = bot.inventory.items().find((i) => isTable(i.name));
    if (!item) return { reason: "no crafting table nearby or in inventory" };
    pos = await placeNearby(bot, item);
  }

  const walk = await walkTo(bot, new GoalLookAtBlock(pos, bot.world), signal);
  if (walk.status !== "done") return { reason: `could not reach crafting table: ${walk.reason ?? walk.status}` };
  signal.throwIfAborted();

  const block = bot.blockAt(pos);
  return block && isTable(block.name) ? { block } : { reason: `no crafting table at ${pos}` };
}
