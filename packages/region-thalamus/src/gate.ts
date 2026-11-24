import type { Facts, Strengths } from "./priority.js";

// The gate: each channel is open or turned down. An open channel passes detail faithfully; a
// turned-down one stays quiet (its items are brief or only counted, never full) until
// something in it changes (see burst.ts). Attention opens the channel that is needed.

/** Why a channel is open, or null if it is turned down. The first reason that holds among its items. */
export function openedBy(items: readonly Facts[], strengths: Strengths): string | null {
  const reasons: [string, (f: Facts) => boolean][] = [
    ["the attended thing", (f) => strengths.spotlight > 0 && f.attended === true],
    ["the running skill's target", (f) => strengths.spotlight > 0 && f.target === true],
    ["a threat in view", (f) => strengths.threats > 0 && (f.threat ?? 0) >= 1],
    ["a wanted thing", (f) => strengths.wants > 0 && (f.wanted ?? 0) > 0],
    ["the goal asks for it", (f) => f.watched === true || (strengths.detail > 0 && f.asked === true)],
  ];
  return reasons.find(([, holds]) => items.some(holds))?.[0] ?? null;
}
