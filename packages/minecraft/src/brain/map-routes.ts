import { nearestCell, previewRoute, routeThrough, FEARED_CELL, type MapStore, type Spot } from "@familiar/memory";
import { Vec3 } from "vec3";
import type { RouteHint } from "../locomotion/index.js";
import { CELL_BLOCKS, cellKey, dimensionOf } from "./place.js";

// Journeys on the hippocampus's map: before one starts the route is played forward, locomotion
// is given the known spots to pass and the cells to go round, and the planner one line on what
// lies on the way. Every number is a first guess.

/** A journey's end counts as on the map when a known cell's spot is within this many blocks of it. */
const END_WITHIN = 12;
/** Known spots are given only for a way of at least this many cells (nearer than that, the end is as good as in sight). */
const FAR_CELLS = 3;
/** Known spots are not given when the way by them is more than this many times the straight line: the pathfinder is left to find its own way. */
const DETOUR = 1.5;
/** Cells that led to harm are gone round out to this far from either end, at most this many. */
const AVOID = { within: 64, most: 8, radius: CELL_BLOCKS * 0.75 };

export interface MapRoutesOptions {
  map: MapStore;
  /** The dimension the bot is in. */
  dimension(): string;
  /** 0: no spots are given to locomotion. */
  waypoints: number;
  /** 0: nothing is gone round and the planner is told nothing. */
  replay: number;
  /** What happened at a spot, in a few words, for the planner's line. Default: nothing said. */
  whatHappened?(spot: Spot): string | null;
  size?: number;
}

export interface MapRoutes {
  /** For locomotion, as a journey starts. */
  hint(from: Spot, to: Spot): RouteHint | null;
  /** For the planner: one line on what lies on the known way from here to there, or null. */
  wayTo(from: Spot, to: Spot): string | null;
  /** How often the map was used, for the trace. */
  counts(): { journeys: number; bySpots: number; wentRound: number };
}

export function createMapRoutes(options: MapRoutesOptions): MapRoutes {
  const { map, dimension, waypoints, replay, whatHappened, size = CELL_BLOCKS } = options;
  const counts = { journeys: 0, bySpots: 0, wentRound: 0 };
  const here = (key: string) => dimensionOf(key) === dimension();
  const centre = (key: string) => {
    const [x, y, z] = key.slice(key.lastIndexOf(":") + 1).split(",").map(Number) as [number, number, number];
    return { x: (x + 0.5) * size, y: (y + 0.5) * size, z: (z + 0.5) * size };
  };
  const far = (a: Spot, b: Spot) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  function known(from: Spot, to: Spot): string[] | null {
    const start = cellKey(dimension(), from, size);
    const end = nearestCell(map, to, END_WITHIN, here);
    return end ? routeThrough(map, start, end, replay > 0 ? 1 : 0) : null;
  }
  return {
    hint(from, to) {
      counts.journeys++;
      const route = known(from, to);
      const spots = waypoints > 0 && route && route.length >= FAR_CELLS ? route.slice(1, -1).map((key) => map.cell(key)!.spot) : [];
      // A known way that is a long way round (the bot once walked the other three sides of a field) is no help.
      const byThem = [from, ...spots, to].reduce((sum, spot, i, all) => (i ? sum + far(all[i - 1]!, spot) : 0), 0);
      const via = byThem <= DETOUR * far(from, to) ? spots.map((s) => new Vec3(s.x, s.y, s.z)) : [];
      const endCell = cellKey(dimension(), to, size);
      const avoid =
        replay > 0
          ? map.cells().filter((c) => here(c.key) && (c.led?.harm ?? 0) >= FEARED_CELL && c.key !== endCell && !route?.includes(c.key) && Math.min(far(c.spot, from), far(c.spot, to)) <= AVOID.within)
              .map((c) => ({ c, centre: centre(c.key) }))
              // Not one whose circle would shut in either end of the journey, or a spot it is to pass.
              .filter(({ centre }) => [from, to, ...via].every((spot) => far(centre, spot) > AVOID.radius))
              .sort((a, b) => b.c.led!.harm - a.c.led!.harm).slice(0, AVOID.most).map(({ c, centre }) => ({ name: `map:${c.key}`, centre, radius: AVOID.radius }))
          : [];
      if (via.length) counts.bySpots++;
      if (avoid.length) counts.wentRound++;
      return via.length || avoid.length ? { via, avoid } : null;
    },
    wayTo(from, to) {
      if (replay <= 0) return null;
      const route = known(from, to);
      const worst = route && previewRoute(map, route).feared[0];
      if (!worst) return null;
      const what = whatHappened?.(worst.spot);
      return `the way passes ${what ? `where this happened: ${what}` : "a place that led to harm"}`;
    },
    counts: () => ({ ...counts }),
  };
}
