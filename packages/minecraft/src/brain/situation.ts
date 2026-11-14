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
export function describeSituation<Ctx>(ws: Workspace, skills: Skill<Ctx>[], storage?: Storage, notes: string[] = []): string {
  const data = minecraftDataOf(ws.state);
  const lines = [ROLE];
  if (data) {
    const { self, time, nearby, current } = data;
    lines.push(
      `Health ${self.health}/20, food ${self.food}/20 (${self.foodItems} food items).`,
      `Holding ${self.heldItem ?? "nothing"}; best weapon ${self.bestWeapon ?? "none"}.`,
      `At ${self.position.x},${self.position.y},${self.position.z} in ${self.dimension}. Inventory ${self.inventoryFullPct}% full, ${self.distanceToBase} blocks from base.`,
      `Carrying: ${counts(self.inventory)}.`,
      `It is ${time.isNight ? "night" : "day"}, light level ${time.lightLevel}.`,
      `Hazards nearby: ${list(nearby.hazards)}.`,
      `Mobs nearby: ${list(nearby.mobs.map((m) => ({ ...m, type: m.hostile ? `hostile ${m.type}` : m.type })))}.`,
      `Doing now: ${current ? `${current.skill}${current.target ? ` (${current.target})` : ""} for ${current.secondsRunning}s` : "nothing"}.`,
    );
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
