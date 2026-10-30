import type { FirstSeen, State } from "@familiar/contracts";
import type { MinecraftStateData } from "./state-data.js";

/**
 * Feed it each logged state in order; it returns the hostile mobs that appear for the first
 * time (a mob that leaves and comes back is not new).
 */
export function createFirstSeenTracker(): (state: State) => FirstSeen[] {
  const seen = new Set<string>();
  return (state) => {
    const mobs = (state.data as unknown as MinecraftStateData).nearby?.mobs ?? [];
    const fresh = mobs.filter((m) => m.hostile && !seen.has(m.id));
    for (const m of fresh) seen.add(m.id);
    return fresh.map((m) => ({ mobId: m.id, type: m.type, dist: m.dist, timestamp: state.timestamp }));
  };
}
