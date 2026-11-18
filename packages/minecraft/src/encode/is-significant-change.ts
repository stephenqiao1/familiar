import type { State } from "@familiar/contracts";
import type { MinecraftStateData } from "./state-data.js";

const HOSTILE_RANGE = 16;

/** At or below this much air the bot is drowning. */
const LOW_AIR = 6;

/**
 * Worth deciding again right away: a new hostile mob within 16 blocks, health dropped, the bot
 * was just hurt, caught fire, fell into lava or ran low on air, something was heard or something
 * in view suddenly changed (what the colliculus may turn to: it decides on the tick this starts), the
 * running skill ended (finished, failed or was interrupted), the inventory just became full, or
 * the defence circuit now calls for a different defence (a threat noticed the bot, cornered it, reached it).
 */
export function isSignificantChange(prev: State, next: State): boolean {
  const a = prev.data as unknown as MinecraftStateData;
  const b = next.data as unknown as MinecraftStateData;
  return newHostile(a, b) || b.self.health < a.self.health || bodyAlarm(a.self, b.self) || somethingNew(a, b) || skillEnded(a, b) || becameFull(a, b) || defenceChanged(a, b);
}

function bodyAlarm(a: MinecraftStateData["self"], b: MinecraftStateData["self"]): boolean {
  const hurtAgain = b.lastHurt !== null && (a.lastHurt === null || b.lastHurt.msAgo < a.lastHurt.msAgo);
  return hurtAgain || (b.onFire && !a.onFire) || (b.inLava && !a.inLava) || (b.air <= LOW_AIR && a.air > LOW_AIR);
}

/** A sound that was not there before, or a sudden thing in view that was not sudden before. */
function somethingNew(a: MinecraftStateData, b: MinecraftStateData): boolean {
  if (b.nearby.heard.filter((h) => h.type !== "presence").length > a.nearby.heard.filter((h) => h.type !== "presence").length) return true;
  const before = new Set(a.nearby.sudden.map((s) => `${s.id} ${s.what}`));
  return b.nearby.sudden.some((s) => !before.has(`${s.id} ${s.what}`));
}

function newHostile(a: MinecraftStateData, b: MinecraftStateData): boolean {
  const close = (d: MinecraftStateData) => d.nearby.mobs.filter((m) => m.hostile && m.dist <= HOSTILE_RANGE).map((m) => m.id);
  const before = new Set(close(a));
  return close(b).some((id) => !before.has(id));
}

/** The defence chosen is now one that acts, and differs from the one before. */
function defenceChanged(a: MinecraftStateData, b: MinecraftStateData): boolean {
  const mode = b.defence?.choice.mode;
  return (mode === "freeze" || mode === "flee" || mode === "fight") && mode !== a.defence?.choice.mode;
}

function skillEnded(a: MinecraftStateData, b: MinecraftStateData): boolean {
  return a.current !== null && b.current === null;
}

function becameFull(a: MinecraftStateData, b: MinecraftStateData): boolean {
  return a.self.inventoryFullPct < 100 && b.self.inventoryFullPct >= 100;
}
