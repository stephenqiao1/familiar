import type { State } from "@familiar/contracts";
import type { MinecraftStateData } from "./state-data.js";

const HOSTILE_RANGE = 16;

/**
 * Worth deciding again right away: a new hostile mob within 16 blocks, health dropped, the
 * running skill ended (finished, failed or was interrupted), or the inventory just became full.
 */
export function isSignificantChange(prev: State, next: State): boolean {
  const a = prev.data as unknown as MinecraftStateData;
  const b = next.data as unknown as MinecraftStateData;
  return newHostile(a, b) || b.self.health < a.self.health || skillEnded(a, b) || becameFull(a, b);
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
