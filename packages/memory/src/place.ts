import type { State, Workspace } from "@familiar/contracts";
import type { CellNow, MapStore } from "./map.js";
import { replayBackward, replayInOrder } from "./map-replay.js";
import type { Trail } from "./trail.js";

// The hippocampus's sense of place: each tick it puts the bot on the map, shares where it is
// (`ws.place`) and how unfamiliar that is, and keeps the order of cells visited. It also runs
// the two replays that need no journey: backward after an outcome, in order at rest.

/** How unfamiliar the place is, 0 (well known) to 1 (never been). Read by dopamine's curiosity. */
export const UNFAMILIAR_SIGNAL = "unfamiliar";

export interface PlaceOptions {
  map: MapStore;
  trail: Trail;
  /** The cell the bot is in, or null if unknown. The game's side decides what a cell is. */
  cellOf(state: State): CellNow | null;
  /** What the bot came through between two ticks, if anything ("door", "climb"). Default: nothing. */
  barrier?(before: State, after: State): string | null;
  /** How strongly replay marks the map, 0 to 1 (0: no replay). */
  replay: number;
  /** How often the map was used for journeys so far, for the trace. Default: not traced. */
  used?(): Record<string, number>;
}

export interface PlaceKeeper {
  /** Puts the bot on the map and shares the place. Returns what to trace. */
  tick(ws: Workspace, now: number): Record<string, unknown>;
  /** Something notably good or bad just happened here (`size` 0 to 1): the way here is replayed backward. */
  /** `before`: the outcome happened where the bot was a tick ago (it died and woke somewhere else), so a cell entered this tick is not part of the way. */
  outcome(sign: "good" | "harm", size: number, now: number, before?: boolean): { cell: string; amount: number }[];
  /** At rest: the cells since the last rest are replayed in order. Returns how many ways were gone over. */
  rest(): number;
}

export function createPlaceKeeper(options: PlaceOptions): PlaceKeeper {
  const { map, trail, cellOf, barrier, replay, used } = options;
  let before: State | null = null;
  let worstMs = 0;
  /** When the bot last entered another cell. */
  let enteredAt = -Infinity;
  return {
    tick(ws, now) {
      const started = performance.now();
      const cell = cellOf(ws.state);
      if (!cell) {
        ws.setPlace(null);
        return {};
      }
      const moved = map.at(cell, now, before ? (barrier?.(before, ws.state) ?? null) : null);
      before = ws.state;
      if (moved.entered) enteredAt = now;
      trail.push(cell.key, now);
      const familiarity = Math.round(map.familiarity(cell.key) * 1000) / 1000;
      const area = map.cell(cell.key)!.area;
      ws.setPlace({ cell: cell.key, area, familiarity });
      ws.setSignal(UNFAMILIAR_SIGNAL, 1 - familiarity);
      const ms = performance.now() - started;
      worstMs = Math.max(worstMs, ms);
      return { place: { cell: cell.key, area, familiarity, ...(moved.entered ? { entered: true } : {}), cells: map.cells().length, ms: Math.round(ms * 1000) / 1000, worstMs: Math.round(worstMs * 1000) / 1000, ...(used ? { used: used() } : {}) } };
    },
    outcome(sign, size, now, before = false) {
      if (replay <= 0) return [];
      const way = trail.recent(now);
      return replayBackward(map, before && enteredAt === now ? way.slice(0, -1) : way, sign, Math.min(1, size) * replay);
    },
    rest() {
      if (replay <= 0) return 0;
      const ways = replayInOrder(map, trail.sinceRest(), replay);
      trail.clearRest();
      return ways;
    },
  };
}
