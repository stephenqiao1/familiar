import type { Changes, SkillEvent, Workspace } from "@familiar/contracts";
import type { Movement } from "@familiar/region-cerebellum";
import type { MovementFacts, MovementNote } from "../movements.js";

// What the cerebellum is told of each movement in Minecraft: the kind of movement, the situation
// as a short key, and the measures. Add a measure: one line in `measuresOf`. Add something to the
// situation: one line in `handKeys`, `legKeys` or `travelKeys`. Keys are physical only (what was
// aimed at, what was in the hand, what was underfoot), and each list runs from specific to general.

/** The lowest and highest each measure may be learned as. */
export const MEASURE_BOUNDS: Record<string, readonly [number, number]> = {
  seconds: [0, 600],
  secondsPerBlock: [0.05, 20],
  recoveries: [0, 3],
  moved: [0, 64],
};

/** What the bot goes by today where it has no model: the give-up clock's base, in seconds. */
export const TODAY_GIVE_UP_SECONDS = 120;

/** Changes that are bookkeeping, not something the movement did to the world or the body. */
const NOT_CAUSED = new Set(["asExpected", "targetAt", "targetBlockWas", "progress", "stance", "distance", "seconds", "patternSwitches", "recoveries", "recovered", "late"]);

/** A run's changes as a list: "moved", "targetBlock=air", "food+" (the same words the written expectations use). */
export function changeList(changes: Changes): string[] {
  const list: string[] = [];
  for (const [key, value] of Object.entries(changes)) {
    if (NOT_CAUSED.has(key) || value === undefined || value === null) continue;
    // Health and food go either way: the direction is the change.
    if ((key === "health" || key === "food" || key === "drops") && typeof value === "number") list.push(`${key}${value < 0 ? "-" : "+"}`);
    else list.push(key);
    // Only a block's fate is told apart by its value: what was gained or held is the situation's, not the movement's.
    if (key === "targetBlock" && typeof value === "string") list.push(`${key}=${value === "air" || value === "cave_air" ? "air" : "other"}`);
  }
  return list.sort();
}

const join = (...parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join("|");

/** A movement of the hands or head: what it was aimed at with what was in the hand, then what it was aimed at, then anything. */
function handKeys(f: MovementFacts): string[] {
  const hand = f.hand ?? "bare";
  return [...new Set([join(f.aim, hand), f.aim ?? hand, ""])];
}

/** A movement of the legs: the block underfoot, then how such a block behaves, then anything. In water, sneaking and a slowed or quickened body each change it. */
function legKeys(f: MovementFacts): string[] {
  const how = join(f.inWater && "water", f.sneaking && "sneak", f.body);
  return [...new Set([join(f.ground, how), join(f.surface, how), ""])];
}

/** Travel: the gait, the ground and whether it climbed, dropped, was in water or sneaking; then the kind of ground; then the gait alone. */
function travelKeys(f: MovementFacts): string[] {
  const how = join(f.slope, f.inWater && "water", f.sneaking && "sneak", f.body);
  return [...new Set([...(f.ground ? [join(f.gait, f.ground, how)] : []), join(f.gait, f.surface, how), join(f.gait), ""])];
}

export function keysOf(note: Pick<MovementNote, "kind" | "facts" | "parts">): string[] {
  if (note.kind !== "primitive") return travelKeys(note.facts);
  if (note.parts?.includes("legs") && !note.parts.includes("hands")) return legKeys(note.facts);
  // The head alone: what is in the hand has no part in a look.
  if (note.parts?.length === 1 && note.parts[0] === "head") return [...new Set([note.facts.aim ?? "", ""])];
  return handKeys(note.facts);
}

/**
 * The numbers that say what a movement came to. Time is only told for a built-in movement that
 * finished: a failure's time is not how long it takes, and a journey's or a stretch's time goes
 * by how far it went (its pace is the measure that can be compared).
 */
function measuresOf(note: MovementNote): Record<string, number> {
  return {
    ...(note.status === "done" && note.kind === "primitive" ? { seconds: note.seconds } : {}),
    ...(note.kind === "primitive" && note.parts?.includes("legs") && note.status === "done" ? { moved: typeof note.changes?.moved === "number" ? note.changes.moved : 0 } : {}),
    ...(note.status === "done" || note.kind === "pace" ? note.measures : {}),
  };
}

/**
 * One of the body's notes, as the cerebellum takes it. Stopped from outside or hurt meanwhile, it
 * is marked cut short and teaches nothing. A stretch already walked is the exception to "stopped":
 * the ground was covered before the journey was interrupted, so its pace still counts.
 */
export function movementOf(note: MovementNote): Movement {
  return {
    kind: note.kind,
    name: note.name,
    keys: keysOf(note),
    measures: measuresOf(note),
    ...(note.changes ? { changes: changeList(note.changes) } : {}),
    at: note.at,
    ...((note.status === "interrupted" && note.kind !== "pace") || note.hurt ? { cutShort: true } : {}),
    ...(note.today ? { today: note.today } : {}),
  };
}

export interface MovementSources {
  /** The body's notes since the last tick (the primitives' and the journeys'). */
  notes(): MovementNote[];
  /** When the body was last hurt, in ms (null: never). */
  lastHurtAt?(): number | null;
}

/**
 * The movements that ended since the last tick: the body's own notes, and each whole skill from
 * the event that ended it (its time, and its changes if it reported any). A skill that was
 * interrupted, cut short by a reflex, given up on, or during which the body was hurt teaches nothing.
 */
export function playerMovements(sources: MovementSources): (ws: Workspace, now: number) => Movement[] {
  const seen = new WeakSet<SkillEvent>();
  const started = new Map<string, number>();
  const stoppedFromOutside = (e: SkillEvent) => e.type === "interrupted" || /^(cut short|gave up|timeout)/.test(e.reason ?? "");
  return (ws) => {
    const out = sources.notes().map(movementOf);
    for (const event of ws.recentEvents) {
      if (seen.has(event)) continue;
      seen.add(event);
      if (event.type === "started") {
        started.set(event.skill, event.timestamp);
        continue;
      }
      const from = started.get(event.skill);
      started.delete(event.skill);
      if (from === undefined) continue;
      const hurtAt = sources.lastHurtAt?.() ?? null;
      out.push({
        kind: "skill",
        name: event.skill,
        keys: [""],
        measures: event.type === "done" ? { seconds: (event.timestamp - from) / 1000 } : {},
        ...(event.changes ? { changes: changeList(event.changes) } : {}),
        at: event.timestamp,
        ...(stoppedFromOutside(event) || (hurtAt !== null && hurtAt >= from && hurtAt <= event.timestamp) ? { cutShort: true } : {}),
        today: { giveUpSeconds: TODAY_GIVE_UP_SECONDS, status: event.type },
      });
    }
    return out.sort((a, b) => a.at - b.at);
  };
}
