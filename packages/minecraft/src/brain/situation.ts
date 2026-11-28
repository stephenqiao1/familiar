import type { Skill, Workspace } from "@familiar/contracts";
import type { ChestMemory } from "../chest-memory.js";
import type { Nearby } from "../encode/state-data.js";
import { minecraftDataOf } from "./read-state.js";

const ROLE = "You plan for a Minecraft player bot. It stays alive and keeps its things at base.";
/** At most this many remembered chests are described. */
const MAX_CHESTS = 8;

/** What the bot remembers about storage, and which chest is the base one. */
export interface Storage {
  chests: ChestMemory;
  /** The base chest's target id. */
  baseChest: string;
}

/**
 * The situation in plain words for the prefrontal cortex's planner: the bot and what it carries,
 * its surroundings, what is in the chests it remembers, any extra notes (e.g. memories), recent
 * events and abilities.
 */
export function describeSituation<Ctx>(ws: Workspace, skills: Skill<Ctx>[], storage?: Storage, notes: string[] = [], reader = "prefrontal"): string {
  // The planner is told what the thalamus passes on to it, not the full state.
  const data = minecraftDataOf(ws.view(reader));
  const lines = [ROLE];
  if (data) {
    const { self, time, nearby, current } = data;
    // With the feeling line alone, the body's numbers are not in the view: the line says how it is.
    const feels = (self as { feels?: string }).feels;
    lines.push(
      ...(feels ? [`Feels: ${feels}.`] : []),
      self.health === undefined ? `Carrying ${self.foodItems} food items.` : `Health ${self.health}/20, food ${self.food}/20 (${self.foodItems} food items).`,
      `Holding ${self.heldItem ?? "nothing"}; best weapon ${self.bestWeapon ?? "none"}.`,
      `At ${self.position.x},${self.position.y},${self.position.z} in ${self.dimension}. Inventory ${self.inventoryFullPct}% full, ${self.distanceToBase} blocks from base.`,
      `Carrying: ${counts(self.inventory)}.`,
      `It is ${time.isNight ? "night" : "day"}, light level ${time.lightLevel}.`,
      `Hazards nearby: ${list(nearby.hazards)}.`,
      `Mobs nearby: ${list(nearby.mobs.map((m) => ({ ...m, type: m.hostile ? `hostile ${m.type}${m.reachable ? "" : " (cannot reach you)"}` : m.type })))}.`,
      `Doing now: ${current ? `${current.skill}${current.target ? ` (${current.target})` : ""} for ${current.secondsRunning}s` : "nothing"}.`,
    );
    // What it is shown is a selection: what was left out is counted, and what is new is named.
    const held = Object.entries(data.told?.heldBack ?? {});
    if (held.length) lines.push(`Not shown (name a kind in "detail" to be told of it in full): ${held.map(([channel, n]) => `${n} more ${channel}`).join(", ")}.`);
    if (data.told?.new?.length) lines.push(`Just appeared: ${data.told.new.join(", ")}.`);
  }
  if (storage) lines.push(...describeStorage(storage));
  lines.push(...notes);
  const events = ws.recentEvents.slice(-5);
  if (events.length) {
    lines.push(`Recent: ${events.map((e) => `${e.skill} ${e.type}${e.reason ? ` (${e.reason})` : ""}`).join(", ")}.`);
  }
  lines.push("Abilities:", ...skills.map((s) => `- ${s.name}: ${s.description}`));
  return lines.join("\n");
}

/** One line per remembered chest, base chest first, most recently seen next. */
function describeStorage({ chests, baseChest }: Storage): string[] {
  const known = Object.entries(chests.entries())
    .sort(([a, x], [b, y]) => Number(b === baseChest) - Number(a === baseChest) || y.seenAt - x.seenAt)
    .slice(0, MAX_CHESTS);
  if (!known.length) return ["Storage: no chest opened yet, so their contents are unknown."];
  return ["Storage (as last seen):", ...known.map(([id, r]) => `- ${id === baseChest ? "base chest" : "chest"} ${id}: ${counts(r.contents)}`)];
}

function counts(items: Record<string, number>): string {
  const entries = Object.entries(items);
  return entries.length ? entries.map(([name, n]) => `${n} ${name}`).join(", ") : "nothing";
}

function list(items: Nearby[]): string {
  return items.length ? items.slice(0, 5).map((i) => `${i.type} at ${i.dist}`).join(", ") : "none";
}
