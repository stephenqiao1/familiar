import type { State } from "@familiar/contracts";
import { BAD_SURPRISE_SIGNAL, BIG_SURPRISE, changedThreshold, FOCUS_SIGNAL, type AlarmTrigger } from "@familiar/neuromodulators";
import { LOOMING_SIGNAL, STARTLE_SIGNAL } from "@familiar/region-brainstem";
import { minecraftDataOf, nearestThreat } from "./read-state.js";

// What raises the player's alarm. Each trigger says how much to add right now (0 to 1).
// Add or remove one: write it here and edit playerAlarms. Every number is a first guess.

const MAX_HEALTH = 20;
/** Losing a third of full health in one tick is a full alarm; half a heart is a small one. */
const DAMAGE_FOR_FULL_ALARM = MAX_HEALTH / 3;
/** Enough on its own to count as a sudden jump (more than 0.5), so the bot drops what it was doing. */
const HOSTILE_APPEARED = 0.6;
/** A startle adds this on top of whatever caused it (a hit, a mob appearing). */
const STARTLED = 0.3;
/** Something looming at full strength adds this. */
const LOOMED = 0.6;
/** A mob seen as a threat within this long is the same threat coming back, not a new one. */
const SAME_THREAT_MS = 30_000;

/** Damage taken since the last tick, scaled by how much. */
export const damage: AlarmTrigger = {
  name: "damage",
  check({ before, after }) {
    const [a, b] = [minecraftDataOf(before), minecraftDataOf(after)];
    if (!a || !b) return 0;
    return Math.min(1, Math.max(0, a.self.health - b.self.health) / DAMAGE_FOR_FULL_ALARM);
  },
};

/**
 * A hostile mob appears close by when none was. The same mob stepping out of range and back in
 * within half a minute is not a new threat.
 */
export function hostileAppeared(): AlarmTrigger {
  const lastSeen = new Map<string, number>();
  return {
    name: "hostile_appeared",
    check({ before, after }) {
      const [a, b] = [minecraftDataOf(before), minecraftDataOf(after)];
      const threat = b && nearestThreat(b);
      if (!a || !threat) return 0;
      const known = after.timestamp - (lastSeen.get(threat.id) ?? -Infinity) <= SAME_THREAT_MS;
      lastSeen.set(threat.id, after.timestamp);
      return !nearestThreat(a) && !known ? HOSTILE_APPEARED : 0;
    },
  };
}

/**
 * A big bad surprise: a skill's outcome fell well short of what dopamine expected. A pleasant
 * surprise does not count: escaping a zombie, or finding something new, should not alarm the bot.
 * With `byFocus`, how big counts as "the world changed" depends on focus: the surprise must be
 * above focus / (0.5 + focus). Somewhere known to be chaotic focus is high, so ordinary surprises
 * don't keep tripping the alarm; somewhere calm and familiar a smaller one is enough.
 */
export function bigSurprise(byFocus = false): AlarmTrigger {
  return {
    name: "big_surprise",
    check({ ws }) {
      const surprise = ws.signals[BAD_SURPRISE_SIGNAL]?.value ?? 0;
      const focus = ws.signals[FOCUS_SIGNAL]?.value;
      const changed = byFocus && focus !== undefined ? surprise > changedThreshold(focus) : surprise >= BIG_SURPRISE;
      return changed ? surprise / 2 : 0;
    },
  };
}

/** The brainstem was startled this tick (a hit from nowhere, a mob up close, something loud). */
export const startled: AlarmTrigger = {
  name: "startle",
  check: ({ ws }) => ((ws.signals[STARTLE_SIGNAL]?.value ?? 0) > 0 ? STARTLED : 0),
};

/** Something is coming at the bot fast (the colliculus's `looming` signal): once, as it starts. Enough on its own to count as a sudden jump. */
export function looming(): AlarmTrigger {
  let was = 0;
  return {
    name: "looming",
    check({ ws }) {
      const level = ws.signals[LOOMING_SIGNAL]?.value ?? 0;
      const rose = level > 0 && was === 0;
      was = level;
      return rose ? LOOMED * level : 0;
    },
  };
}

// TODO(alarm): a hostile mob targeting the bot (the state doesn't say who a mob is after).
// TODO(alarm): another player being attacked (not sensed yet). Explosions and thunder reach alarm through startle.

/** Everything that raises the player's alarm. `surpriseByFocus`: let focus set how big a surprise counts. */
export function playerAlarms(surpriseByFocus = false): AlarmTrigger[] {
  return [damage, hostileAppeared(), startled, looming(), bigSurprise(surpriseByFocus)];
}

/** A threat is present (alarm does not fade): a hostile mob close by. */
export function threatPresent(state: State): boolean {
  const data = minecraftDataOf(state);
  return data !== null && nearestThreat(data) !== null;
}
