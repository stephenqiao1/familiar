import type { State, Workspace } from "@familiar/contracts";
import { createConditions, type ConditionKind, type Conditions } from "@familiar/neocortex";
import type { MinecraftStateData } from "../encode/state-data.js";
import { needsNow } from "./needs.js";
import { minecraftDataOf } from "./read-state.js";

// The player's conditions: what a step's "done when" and "give up when" can say. Each kind is a
// few words the planner writes and a check read from the state (and the needs). A check only
// reads: it changes nothing. Before the first state arrives, every condition is false.
// Add a condition: write a kind here and add it to the list in playerConditions.

/** A place the bot knows by name (the base chest, the bed, a chest it has opened). */
export interface NamedPlace {
  name: string;
  place: { x: number; y: number; z: number; dimension?: string };
}

/** A kind whose check reads the Minecraft state. */
const kind = (form: string, pattern: RegExp, check: (match: RegExpExecArray) => ((data: MinecraftStateData, ws: Workspace) => boolean) | null): ConditionKind => ({
  form,
  read(text) {
    const match = pattern.exec(text);
    const made = match && check(match);
    if (!made) return null;
    return (ws) => {
      const data = minecraftDataOf(ws.state);
      return data !== null && made(data, ws);
    };
  },
});

const NUMBER = "(\\d+(?:\\.\\d+)?)";
/** A kind of thing or an item, by its game name (spaces read as underscores). */
const named = (words: string) => words.trim().replace(/ /g, "_");

/** Carrying at least so many of an item. */
const carrying = kind("carrying <count> <item>", new RegExp(`^carrying (?:at least )?(\\d+) (?:of )?(.+)$`), ([, count, item]) => (data) => (data.self.inventory[named(item!)] ?? 0) >= Number(count));

/** How far the bot is from a position, in blocks. */
const away = (data: MinecraftStateData, at: { x: number; y: number; z: number }) => Math.hypot(at.x - data.self.position.x, at.y - data.self.position.y, at.z - data.self.position.z);

/** Within a distance of a spot (pos:x,y,z), of a place known by name, or of the nearest thing of a kind in view. */
function within(places: () => NamedPlace[]): ConditionKind {
  return kind("within <blocks> of <a kind of thing, a known place, or pos:x,y,z>", new RegExp(`^within ${NUMBER}(?: blocks?)? of (?:an? |the )?(.+)$`), ([, blocks, what]) => {
    const reach = Number(blocks);
    const spot = /^pos:(-?\d+),(-?\d+),(-?\d+)$/.exec(what!);
    if (spot) return (data) => away(data, { x: Number(spot[1]), y: Number(spot[2]), z: Number(spot[3]) }) <= reach;
    if (what === "base") return (data) => data.self.distanceToBase <= reach;
    return (data, ws) => {
      const place = places().find((p) => p.name.toLowerCase() === what && (p.place.dimension ?? data.self.dimension) === data.self.dimension);
      if (place) return away(data, place.place) <= reach;
      return thingsOfKind(ws, named(what!)).some((t) => t.dist <= reach);
    };
  });
}

/** The things of a kind in the state (which is what "in view" means: what the body senses now), each with how far off it is. */
function thingsOfKind(ws: Workspace, wanted: string): { dist: number }[] {
  const data = minecraftDataOf(ws.state);
  if (!data) return [];
  const { hazards, mobs, blocks, players } = data.nearby;
  if (wanted === "hostile") return mobs.filter((m) => m.hostile);
  return [...hazards, ...mobs, ...blocks, ...players].filter((t) => t.type === wanted);
}

/** A need (by its name, or by what it is about: every need of that sort) below a level from 0 to 1. */
const needBelow: ConditionKind = {
  form: "need <name> below <level from 0 to 1>",
  read(text) {
    const match = new RegExp(`^need (.+) below ${NUMBER}$`).exec(text);
    if (!match) return null;
    const [name, level] = [named(match[1]!), Number(match[2])];
    return (ws) => {
      const about = needsNow(ws).filter((n) => n.name === name || n.kind === name);
      return about.length > 0 && about.every((n) => n.level < level);
    };
  },
};

/** The time of day. */
const timeIs = kind("time is day | time is night", /^(?:the )?time is (day|night)$/, ([, when]) => (data) => data.time.isNight === (when === "night"));

/** Something of a kind being in view. */
const sees: ConditionKind = {
  form: "sees <a kind of thing>",
  read(text) {
    const match = /^(?:sees|in view:?) (?:an? |the )?(.+)$/.exec(text);
    if (!match) return null;
    const wanted = named(match[1]!);
    return (ws) => thingsOfKind(ws, wanted).length > 0;
  },
};

/** The player's vocabulary of conditions. `places`: the places the bot knows by name right now. */
export function playerConditions(places: () => NamedPlace[] = () => []): Conditions {
  return createConditions([carrying, within(places), needBelow, timeIs, sees]);
}

/** For the planner: how a condition is written, with one example of each kind. */
export function conditionsNote(conditions: Conditions, needs: readonly string[]): string {
  return (
    `Conditions (for a step's doneWhen and giveUpWhen, and for what you expect), each written exactly in one of these forms: ${conditions.forms.join("; ")}. ` +
    `For example: "carrying 3 bread", "within 3 of chest", "within 2 of base chest", "need hunger below 0.3", "time is night", "sees zombie", "not sees zombie". ` +
    `Needs: ${needs.join(", ")}.`
  );
}

/**
 * A skill's target written as a kind of thing, so that a chain of skills can be run again
 * somewhere else: a block or creature in the state becomes "nearest:<its kind>". A target that
 * is already name-free (nearest:, item:, dir:, level:) stays as it is, and so does no target.
 * Null: it cannot be written so (a bare spot, a player, a thing no longer in the state).
 */
export function targetAsKind(target: string | undefined, state: State): string | null | undefined {
  if (target === undefined) return undefined;
  if (!/^(pos|entity|player):/.test(target)) return target;
  const data = minecraftDataOf(state);
  if (!data || target.startsWith("player:")) return null;
  const thing = [...data.nearby.mobs, ...data.nearby.blocks].find((t) => t.id === target);
  return thing ? `nearest:${thing.type}` : null;
}

/** The forced retreat, as a goal nothing ordinary replaces until the bot is safe: no need about safety is pressing any more. */
export const RETREAT_GOAL = { priority: 1, protected: true, doneWhen: "need safety below 0.5" };
