import type { Workspace } from "@familiar/contracts";
import { kindKey, type AmygdalaSenses } from "./amygdala.js";
import { minecraftDataOf, sightedOf } from "./read-state.js";

// The shadow report: while the amygdala only watches, each tick says what today's rules hold of
// whatever is around, next to what the amygdala holds. `pnpm shadow-report` sums a log of these.

/** Today's learning rules, as they answer right now. */
export interface OldRules {
  /** The threat record: is this kind a threat, and how dangerous has it been. */
  isThreat(kind: string, gameHostile: boolean): boolean;
  danger(kind: string): number;
  /** hurts.json (and the inborn list). */
  knowsHurt(block: string): boolean;
  /** bad-foods.json (and the inborn list). */
  knowsBadFood(food: string): boolean;
  isFood(item: string): boolean;
}

/** One comparison: what sort, the cue, today's answer (0 to 1), the amygdala's (harm, -0.5 to 1). */
export type ShadowRow = [sort: "kind" | "block" | "food" | "place", cue: string, old: number, amygdala: number];

const NOT_A_BLOCK = new Set(["air", "cave_air", "void_air", ""]);
const round = (n: number) => Math.round(n * 100) / 100;

/** `harm`: what the amygdala predicts of a cue, here and now. */
export function createShadow(old: OldRules, harm: (cue: string, area: string | null, now: number) => number, senses: Pick<AmygdalaSenses, "nameOf" | "meal">): (ws: Workspace) => ShadowRow[] | null {
  return (ws) => {
    const d = minecraftDataOf(ws.state);
    if (!d) return null;
    const [area, now] = [ws.place?.area ?? null, ws.state.timestamp];
    const rows = new Map<string, ShadowRow>();
    const add = (sort: ShadowRow[0], cue: string, was: number) => void rows.set(cue, [sort, cue, round(was), round(harm(cue, area, now))]);
    for (const m of d.nearby.mobs) if (sightedOf(m).seen) add("kind", `kind:${m.type}`, old.isThreat(m.type, m.hostile) ? old.danger(m.type) : 0);
    for (const p of d.nearby.players) {
      const cue = kindKey(p.type, p.id, senses);
      if (sightedOf(p).seen) add("kind", cue, old.isThreat(cue.slice(5), false) ? old.danger(cue.slice(5)) : 0);
    }
    const t = d.self.touching;
    for (const name of [t.feet, t.head, t.below, ...t.sides, ...d.nearby.hazards.map((h) => h.type)]) if (!NOT_A_BLOCK.has(name)) add("block", `block:${name}`, old.knowsHurt(name) ? 1 : 0);
    const meal = senses.meal?.();
    for (const food of [...Object.keys(d.self.inventory).filter(old.isFood), ...(meal && now - meal.at <= 60_000 ? [meal.food] : [])]) add("food", `food:${food}`, old.knowsBadFood(food) ? 1 : 0);
    if (area !== null) add("place", `area:${area}`, d.memory?.nearby === "bad" ? 1 : 0);
    return [...rows.values()];
  };
}
