import type { Skill, Workspace } from "@familiar/contracts";
import type { Nearby } from "../encode/state-data.js";
import { minecraftData } from "./read-state.js";

const ROLE = "You plan for a Minecraft miner bot. It gathers ore, stays alive, and brings loot back to base.";

/** The situation in plain words for the neocortex's planner: the bot, its surroundings, recent events, abilities. */
export function describeSituation<Ctx>(ws: Workspace, skills: Skill<Ctx>[]): string {
  const data = minecraftData(ws);
  const lines = [ROLE];
  if (data) {
    const { self, time, nearby, current } = data;
    lines.push(
      `Health ${self.health}/20, food ${self.food}/20 (${self.foodItems} food items).`,
      `Holding ${self.heldItem ?? "nothing"}; best weapon ${self.bestWeapon ?? "none"}; pickaxe ${self.pickaxeDurabilityPct === null ? "none" : `${self.pickaxeDurabilityPct}% durability`}.`,
      `Inventory ${self.inventoryFullPct}% full, ${self.torches} torches, ${self.distanceToBase} blocks from base.`,
      `It is ${time.isNight ? "night" : "day"}, light level ${time.lightLevel}.`,
      `Ores nearby: ${list(nearby.ores)}.`,
      `Hazards nearby: ${list(nearby.hazards)}.`,
      `Mobs nearby: ${list(nearby.mobs.map((m) => ({ ...m, type: m.hostile ? `hostile ${m.type}` : m.type })))}.`,
      `Doing now: ${current ? `${current.skill}${current.target ? ` (${current.target})` : ""} for ${current.secondsRunning}s` : "nothing"}.`,
    );
  }
  const events = ws.recentEvents.slice(-5);
  if (events.length) {
    lines.push(`Recent: ${events.map((e) => `${e.skill} ${e.type}${e.reason ? ` (${e.reason})` : ""}`).join(", ")}.`);
  }
  lines.push("Abilities:", ...skills.map((s) => `- ${s.name}: ${s.description}`));
  return lines.join("\n");
}

function list(items: Nearby[]): string {
  return items.length ? items.slice(0, 5).map((i) => `${i.type} at ${i.dist}`).join(", ") : "none";
}
