import type { Needs } from "@familiar/contracts";
import { CLOCK } from "./clock.js";

/** Stress above this is worth telling the planner about. */
const STRESSED = 0.5;
/** A need heading this far above where it stands is worth telling the planner about. */
const COMING = 0.2;

/**
 * What the body wants, in one line for the planner: the need it wants most, what is coming
 * (needs heading up, night about to fall), anything desperate, and stress. Null when there is
 * nothing to say.
 */
export function describeDrives(needs: Needs | null, words: (name: string) => string = (name) => name.replace(/_/g, " ")): string | null {
  if (!needs) return null;
  const parts: string[] = [];
  if (needs.top) parts.push(`what it wants most is ${words(needs.top.name)} (${needs.top.kind}, pressing ${needs.top.score.toFixed(1)}${needs.unmet ? ", and nothing you know of relieves it" : ""})`);
  const soon = needs.readings.filter((r) => (r.projected ?? 0) >= r.level + COMING).map((r) => `${words(r.name)} (now ${r.level.toFixed(1)}, heading for ${r.projected!.toFixed(1)})`);
  if (soon.length) parts.push(`coming soon: ${soon.join(", ")}`);
  const dusk = needs.clock?.dusk ?? 0;
  if (dusk > 0) parts.push(`night falls in ${Math.max(1, Math.round(((1 - dusk) * CLOCK.twilightSeconds) / 60))} min`);
  if (needs.desperate) parts.push(`${words(needs.desperate)} is desperate`);
  if ((needs.stress ?? 0) > STRESSED) parts.push("it is worn down by stress: nothing that can wait is worth doing now");
  return parts.length ? `Your body: ${parts.join("; ")}.` : null;
}
