import type { Skill, State, Workspace } from "@familiar/contracts";
import { UNFAMILIAR_SIGNAL } from "@familiar/memory";
import type { Aim, Thing } from "@familiar/neuromodulators";
import { isUsefulBlock, USEFUL_BLOCK_RADIUS } from "../encode/scan-useful-blocks.js";
import { WORK_PER_BLOCK } from "./effort-spent.js";
import { minecraftDataOf } from "./read-state.js";

/** Skills that head toward a thing (take_items only accepts containers). */
const HEADING_SKILLS = ["go_to", "take_items"];

/** A block stays where it is, so what is learned about that one is kept; a mob or a player is known only by its kind. */
const thing = (t: { id: string; type: string }, fixed: boolean): Thing => ({ id: t.id, kind: t.type, ...(fixed ? { fixed } : {}) });
const nearestFirst = <T extends { dist: number }>(things: T[]) => [...things].sort((a, b) => a.dist - b.dist);

/**
 * Everything in view the bot could aim a skill at, nearest first: hazards, mobs (villagers
 * included), chests, ripe crops, bells and players. A thing's kind is its type ("chest", "cow").
 */
export function thingsInView(state: State): Thing[] {
  const data = minecraftDataOf(state);
  if (!data) return [];
  const { hazards, mobs, blocks, players } = data.nearby;
  const fixed = new Set<{ dist: number }>([...hazards, ...blocks]);
  return nearestFirst([...hazards, ...mobs, ...blocks, ...players]).map((t) => thing(t, fixed.has(t)));
}

/**
 * The things in view worth heading toward: friendly mobs, useful blocks and players. Hazards and
 * hostile mobs are left out, so the bot never learns to walk up to a threat.
 */
export function approachableThings(state: State): Thing[] {
  const data = minecraftDataOf(state);
  if (!data) return [];
  const { mobs, blocks, players } = data.nearby;
  const fixed = new Set<{ dist: number }>(blocks);
  return nearestFirst([...mobs.filter((m) => !m.hostile), ...blocks, ...players]).map((t) => thing(t, fixed.has(t)));
}

/** At most this many remembered things are weighed each tick: the nearest. */
const MOST_REMEMBERED = 16;

/**
 * Memory of places: the useful blocks the bot has learned something about and that are not in
 * the state now, nearest first. Nothing is stored for this: `known` is what the scorebook has
 * learned about (a block's id is where it stands), and how far off each is from here is worked
 * out when asked. A remembered thing costs the walk beyond sensing range on top of a usual
 * trip (in reward units, times `effortScale`: how much this bot minds effort), so a far one is wanted only when the need is strong.
 * One that has gone is not wanted for long: no skill can run on a chest that is not there.
 */
export function rememberedThings(known: () => Required<Aim>[], effortScale = 1): (state: State) => Thing[] {
  return (state) => {
    const data = minecraftDataOf(state);
    if (!data) return [];
    const listed = new Set(data.nearby.blocks.map((b) => b.id));
    const { x, y, z } = data.self.position;
    const away = known().flatMap(({ kind, id }) => {
      const at = /^pos:(-?\d+),(-?\d+),(-?\d+)$/.exec(id)?.slice(1).map(Number);
      return at && isUsefulBlock(kind) && !listed.has(id) ? [{ id, kind, dist: Math.hypot(at[0]! - x, at[1]! - y, at[2]! - z) }] : [];
    });
    return nearestFirst(away)
      .slice(0, MOST_REMEMBERED)
      .map(({ id, kind, dist }) => ({ id, kind, fixed: true, extraWork: Math.max(0, dist - USEFUL_BLOCK_RADIUS) * WORK_PER_BLOCK * effortScale }));
  };
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
/** A place counts as new while the map knows it less than this well. */
const NEW_PLACE = 0.5;

/** For novelty: an area the hippocampus's map hardly knows is something new, once (`unfamiliar` is its signal). */
export function newPlace(ws: Workspace | undefined): string[] {
  return ws?.place && (ws.signals[UNFAMILIAR_SIGNAL]?.value ?? 0) > NEW_PLACE ? [`place:${ws.place.area}`] : [];
}

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
