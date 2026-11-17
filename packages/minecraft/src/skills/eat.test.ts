import { describe, expect, it } from "vitest";
import { isBadFood, setKnownBadFoods } from "../foods.js";
import { createGut } from "../gut.js";
import { fakeBot, item, type FakeItem } from "../primitives/fake-bot.test-helper.js";
import { consume } from "./consume.js";
import { eat } from "./eat.js";

const never = new AbortController().signal;
const FOODS = { bread: { foodPoints: 5, saturation: 6 }, cooked_beef: { foodPoints: 8, saturation: 12.8 }, spider_eye: { foodPoints: 2, saturation: 3.2 }, rotten_flesh: { foodPoints: 4, saturation: 0.8 } };

/** A fake bot that can eat: using the held food finishes it at once and fills the food bar by its food points. */
function eater(items: FakeItem[], food: number, innate = ["rotten_flesh", "spider_eye"]) {
  const fake = fakeBot({ items });
  const gut = createGut({ innate });
  fake.ctx.gut = gut;
  setKnownBadFoods(fake.bot, gut.knowsBad);
  const state = fake.state as typeof fake.state & { registry: { foodsByName: typeof FOODS } };
  state.registry.foodsByName = FOODS;
  state.food = food;
  const eaten: string[] = [];
  state.activateItem = () => {
    const held = state.heldItem!;
    eaten.push(held.name);
    held.count--;
    state.food = Math.min(20, state.food + (FOODS[held.name as keyof typeof FOODS]?.foodPoints ?? 0));
    if (held.count === 0) fake.setItems(fake.bot.inventory.items().filter((i) => i !== held) as FakeItem[]);
  };
  return { ...fake, gut, eaten, food: () => state.food };
}
const bread = (n: number): FakeItem => ({ ...item("bread", n) });
const named = (name: string, n: number): FakeItem => item(name, n);

describe("eat", () => {
  it("eats until full by default", async () => {
    const b = eater([bread(8)], 4);
    expect(await eat.run(b.ctx, undefined, never)).toMatchObject({ status: "done", changes: { until: 20 } });
    expect(b.food()).toBe(20);
    expect(b.eaten).toHaveLength(4);
  });

  it("stops at the level asked for: enough to heal, not completely full", async () => {
    const b = eater([bread(8)], 12);
    expect(eat.canRun(b.ctx, "level:18")).toBe(true);
    expect(await eat.run(b.ctx, "level:18", never)).toMatchObject({ status: "done", changes: { ate: "bread, bread", until: 18 } });
    expect(b.food()).toBe(20); // 12, 17, then past 18: it stopped as soon as it had enough
    expect(b.eaten).toHaveLength(2);
    // Already at the level: nothing to do.
    expect(eat.canRun(eater([bread(8)], 18).ctx, "level:18")).toBe(false);
    expect(eat.canRun(eater([bread(8)], 18).ctx)).toBe(true);
  });

  it("picks the best food not known to be bad", async () => {
    const b = eater([named("spider_eye", 3), bread(2), named("cooked_beef", 1)], 4);
    await eat.run(b.ctx, "level:10", never);
    expect(b.eaten).toEqual(["cooked_beef"]);
  });

  it("eats food known to be bad only when starving with nothing else", async () => {
    // Hungry but not starving, with only bad food: it will not eat it.
    expect(eat.canRun(eater([named("spider_eye", 3)], 10).ctx)).toBe(false);
    // Starving, with only bad food: it eats until it is no longer starving, then stops.
    const starving = eater([named("spider_eye", 6)], 4);
    expect(eat.canRun(starving.ctx)).toBe(true);
    await eat.run(starving.ctx, undefined, never);
    expect(starving.eaten).toEqual(["spider_eye", "spider_eye"]);
    expect(starving.food()).toBe(8);
    // Starving with something else to hand: the bad food is left alone.
    const choice = eater([named("spider_eye", 6), bread(1)], 4);
    await eat.run(choice.ctx, "level:8", never);
    expect(choice.eaten).toEqual(["bread"]);
  });

  it("notes each meal, so an illness that follows can be blamed on it", async () => {
    const b = eater([named("spider_eye", 2), bread(1)], 12, []);
    b.gut.ate("cooked_beef", 0); // it has eaten other things before
    await eat.run(b.ctx, "level:13", never);
    expect(b.eaten).toEqual(["bread"]);
    expect(b.gut.fellIll("poison", Date.now() + 500, true, false)).toEqual({ blamed: "bread", learned: false, count: 1 });
  });

  it("with nothing innate, no food is known bad at the start", () => {
    const b = eater([named("spider_eye", 2)], 12, []);
    expect([isBadFood(b.bot, "spider_eye"), isBadFood(b.bot, "rotten_flesh")]).toEqual([false, false]);
    expect(eat.canRun(b.ctx)).toBe(true);
    // A bot never told anything knows the usual list.
    expect([isBadFood({}, "rotten_flesh"), isBadFood({}, "bread")]).toEqual([true, false]);
  });
});

describe("consume", () => {
  it("eats or drinks one named item, and cannot run without it", async () => {
    const b = eater([named("milk_bucket", 1), bread(2)], 15);
    expect(consume.canRun(b.ctx, "item:milk_bucket")).toBe(true);
    expect(await consume.run(b.ctx, "item:milk_bucket", never)).toEqual({ status: "done", changes: { consumed: "milk_bucket" } });
    expect(b.eaten).toEqual(["milk_bucket"]);
    expect(consume.canRun(b.ctx, "item:milk_bucket")).toBe(false);
    expect(consume.canRun(b.ctx)).toBe(false);
  });
});
