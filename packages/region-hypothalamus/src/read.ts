import type { BodyClock, NeedReading, State } from "@familiar/contracts";
import { pressesAt } from "./ahead.js";
import { clockGain } from "./clock.js";
import type { Need, NeedContext } from "./need.js";
import { DEFAULT_DRIVES, weightOf, type DriveSettings } from "./settings.js";
import { stressGain } from "./stress.js";

/** A need's level with what ranks it: enough to work out how hard it presses. */
type Levelled = Pick<NeedReading, "name" | "level" | "rank">;

/**
 * How hard each need presses for action: its level (or `pressing`, where something has already
 * tuned it), unless a more vital need (a higher rank) presses at all, which silences it. Staying
 * alive always comes first: with a threat about, nothing lesser is worth setting off for,
 * however far the threat is inside the range that counts. The levels themselves (for learning
 * what relieves a need) are not changed.
 */
export function pressing<T extends Levelled & { pressing?: number }>(needs: readonly T[]): (T & { pressing: number })[] {
  return needs.map((n) => ({ ...n, pressing: needs.some((other) => other.rank > n.rank && other.level > 0) ? 0 : (n.pressing ?? n.level) }));
}

export interface ReadOptions {
  /** A body signal shared this tick. Default: none are. */
  signal?: NeedContext["signal"];
  /** How much is enough right now for a need with a target. Default: its base. */
  targetOf?(need: Need): number;
  /** The time of day. Default: the body has no clock. */
  clock?: BodyClock | null;
  /** Where the weights come from. Default: the usual ones. */
  settings?: Pick<DriveSettings, "weights" | "weight">;
}

/** Every need in a state, read once. A need that throws, or does not apply, is left out. */
export function readNeeds(needs: readonly Need[], state: State, options: ReadOptions = {}): NeedReading[] {
  const signal = options.signal ?? (() => undefined);
  return pressing(
    needs.flatMap((need) => {
      try {
        const target = need.target === undefined ? undefined : (options.targetOf?.(need) ?? need.target);
        const level = need.level(state, { signal, target: target ?? 0, clock: options.clock ?? null });
        if (typeof level !== "number" || !Number.isFinite(level)) return [];
        return [{ name: need.name, kind: need.kind, level: Math.min(1, Math.max(0, level)), rank: need.rank ?? 0, weight: weightOf(need, options.settings ?? DEFAULT_DRIVES), ...(target === undefined ? {} : { target }) }];
      } catch {
        return []; // a need that cannot be read is left out, not guessed
      }
    }),
  );
}

/** What tunes how hard a need presses, beyond its level. */
export interface Tuning {
  /** Where the level is heading (see ahead.ts), if anything looks ahead. */
  projected?: number;
  clock: BodyClock | null;
  stress: number;
  /** A skill that relieves this need is running. */
  relieving: boolean;
  settings: Pick<DriveSettings, "lookAhead" | "clock" | "stress">;
}

/**
 * How hard one need presses before the more vital ones have their say: its level, raised by
 * where it is heading, lowered at the wrong time of day, under stress (a need that can wait)
 * and while something that relieves it is already under way. With every strength 0: its level.
 */
export function tuned(need: Pick<Need, "by" | "spare">, level: number, { projected, clock, stress, relieving, settings }: Tuning, easing: number): number {
  const ahead = projected === undefined ? level : pressesAt(level, projected, settings.lookAhead);
  return ahead * clockGain(need.by, clock, settings.clock) * stressGain(need.spare, stress, settings.stress) * (relieving ? 1 - settings.lookAhead * easing : 1);
}
