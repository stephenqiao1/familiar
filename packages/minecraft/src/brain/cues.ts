import type { Skill, State } from "@familiar/contracts";
import type { Thing } from "@familiar/neuromodulators";
import { minecraftDataOf } from "./read-state.js";

/** Skills that head toward a thing (take_items only accepts containers). */
const HEADING_SKILLS = ["go_to", "take_items"];

/**
 * Everything in view the bot could aim a skill at, nearest first: hazards, mobs (villagers
 * included), chests, ripe crops, bells and players. A thing's kind is its type ("chest", "cow").
 */
export function thingsInView(state: State): Thing[] {
  const data = minecraftDataOf(state);
  if (!data) return [];
  const { hazards, mobs, blocks, players } = data.nearby;
  return [...hazards, ...mobs, ...blocks, ...players].sort((a, b) => a.dist - b.dist).map((t) => ({ id: t.id, kind: t.type }));
}

/**
 * The things in view worth heading toward: friendly mobs, useful blocks and players. Hazards and
 * hostile mobs are left out, so the bot never learns to walk up to a threat.
 */
export function approachableThings(state: State): Thing[] {
  const data = minecraftDataOf(state);
  if (!data) return [];
  const { mobs, blocks, players } = data.nearby;
  return [...mobs.filter((m) => !m.hostile), ...blocks, ...players].sort((a, b) => a.dist - b.dist).map((t) => ({ id: t.id, kind: t.type }));
}

/** Which heading skills can go to a thing right now. */
export function skillsToward<Ctx>(skills: Skill<Ctx>[], ctx: Ctx): (thing: Thing) => string[] {
  return (thing) => HEADING_SKILLS.filter((name) => skills.find((s) => s.name === name)?.canRun(ctx, thing.id) ?? false);
}

/**
 * The kinds of things the bot notices, for novelty: mob types, useful blocks, "player", the
 * biome ("biome:plains") and every item carried ("item:bread"). Hazards are left out, so the bot
 * isn't rewarded for walking up to lava.
 */
export function noticedIn(state: State): string[] {
  const data = minecraftDataOf(state);
  if (!data) return [];
  const { self, nearby } = data;
  return [
    ...nearby.mobs.map((m) => m.type),
    ...nearby.blocks.map((b) => b.type),
    ...(nearby.players.length ? ["player"] : []),
    ...(self.biome ? [`biome:${self.biome}`] : []),
    ...Object.keys(self.inventory).map((item) => `item:${item}`),
  ];
}
