import type { Bot } from "mineflayer";
import { findBlockNear } from "../find-nearby.js";
import type { Block } from "../mc-types.js";
import { reasonOf, REACH, resolve } from "./aim.js";
import { primitive } from "./primitive.js";

type Recipe = ReturnType<Bot["recipesFor"]>[number];

/** Makes one batch of a recipe, at a crafting table if it needs one. */
export async function doCraft(bot: Bot, recipe: Recipe, table: Block | null): Promise<void> {
  await bot.craft(recipe, 1, table ?? undefined);
}

/** The crafting table within reach, or null. */
function tableInReach(bot: Bot): Block | null {
  const pos = findBlockNear(bot, (name) => name === "crafting_table", REACH);
  return pos && bot.blockAt(pos);
}

/**
 * A recipe for the named item that the bot has the ingredients for right now, from the game's
 * own recipe data, and the table to use if it needs one. Null if there is none.
 */
function recipeFor(bot: Bot, target: string | undefined): { recipe: Recipe; table: Block | null } | null {
  const resolved = resolve(bot, target);
  const item = resolved?.kind === "item" ? bot.registry.itemsByName[resolved.name] : undefined;
  if (!item) return null;
  const table = tableInReach(bot);
  const recipe = bot.recipesFor(item.id, null, 1, table)[0];
  return recipe ? { recipe, table: recipe.requiresTable ? table : null } : null;
}

/** Makes one batch of an item the bot has the ingredients for. */
export const craft = primitive({
  name: "craft",
  description: "Make an item the bot has the ingredients for: item:<name>. Uses a crafting table within reach if the recipe needs one.",
  parts: ["hands"],
  standing: true,
  expects: ["gained", "lost"],

  canRun(ctx, target) {
    return recipeFor(ctx.bot, target) !== null;
  },

  async run(ctx, target, signal) {
    const found = recipeFor(ctx.bot, target);
    if (!found) return { status: "failed", reason: `no recipe for "${target}" with what is carried (and the table in reach)` };
    if (signal.aborted) return { status: "interrupted" };
    try {
      await doCraft(ctx.bot, found.recipe, found.table);
      return { status: "done" };
    } catch (error) {
      return { status: "failed", reason: reasonOf(error) };
    }
  },
});
