import type { State } from "@familiar/contracts";
import type { MinecraftStateData } from "./state-data.js";

const HOSTILE_RANGE = 16;

/** At or below this much air the bot is drowning. */
const LOW_AIR = 6;

/**
 * Worth deciding again right away: a new hostile mob within 16 blocks, health dropped, the bot
 * was just hurt, caught fire, fell into lava or ran low on air, something loud happened, the
 * running skill ended (finished, failed or was interrupted), or the inventory just became full.
 */
export function isSignificantChange(prev: State, next: State): boolean {
  const a = prev.data as unknown as MinecraftStateData;
  const b = next.data as unknown as MinecraftStateData;
  return newHostile(a, b) || b.self.health < a.self.health || bodyAlarm(a.self, b.self) || b.nearby.loud.length > a.nearby.loud.length || skillEnded(a, b) || becameFull(a, b);
}

function bodyAlarm(a: MinecraftStateData["self"], b: MinecraftStateData["self"]): boolean {
  const hurtAgain = b.lastHurt !== null && (a.lastHurt === null || b.lastHurt.msAgo < a.lastHurt.msAgo);
  return hurtAgain || (b.onFire && !a.onFire) || (b.inLava && !a.inLava) || (b.air <= LOW_AIR && a.air > LOW_AIR);
}

function newHostile(a: MinecraftStateData, b: MinecraftStateData): boolean {
  const close = (d: MinecraftStateData) => d.nearby.mobs.filter((m) => m.hostile && m.dist <= HOSTILE_RANGE).map((m) => m.id);
  const before = new Set(close(a));
  return close(b).some((id) => !before.has(id));
}

function skillEnded(a: MinecraftStateData, b: MinecraftStateData): boolean {
  return a.current !== null && b.current === null;
}

function becameFull(a: MinecraftStateData, b: MinecraftStateData): boolean {
  return a.self.inventoryFullPct < 100 && b.self.inventoryFullPct >= 100;
}
