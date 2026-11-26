import type { MapStore, Spot } from "./map.js";
import { FEARED_CELL } from "./map-route.js";

// Replay: going over recent experience on the map. Backward after a notable outcome (which way
// led here), in order at rest (to firm up the ways walked), and forward before a journey (what
// lies on the way). Replay is not a reward, pays nothing, and is not a new experience.

/** Each cell further back gets this share of the one after it, and replay reaches this many cells back. */
const BACK = { share: 0.7, cells: 8 };
/** One going-over at rest counts as this much of a walk. */
const REHEARSAL = 0.5;

/**
 * Plays the recent cells backward from where something good or bad just happened: each cell on
 * the way there is marked "this way led to good" (or harm), less the further back. `trail` is
 * oldest first; `size` 0 to 1. Returns the marks made.
 */
export function replayBackward(map: MapStore, trail: readonly string[], sign: "good" | "harm", size: number): { cell: string; amount: number }[] {
  const order: string[] = [];
  for (let i = trail.length - 1; i >= 0 && order.length < BACK.cells; i--) if (!order.includes(trail[i]!)) order.push(trail[i]!);
  const marks = order.map((cell, back) => ({ cell, amount: Math.round(size * BACK.share ** back * 1000) / 1000 })).filter((m) => m.amount >= 0.01);
  for (const m of marks) map.mark(m.cell, sign, m.amount);
  return marks;
}

/** Plays a stretch of cells in the order they were visited: each way walked is gone over once more. Returns how many ways. */
export function replayInOrder(map: MapStore, cells: readonly string[], strength = 1): number {
  let ways = 0;
  for (let i = 1; i < cells.length; i++) if (cells[i] !== cells[i - 1] && map.rehearse(cells[i - 1]!, cells[i]!, REHEARSAL * strength)) ways++;
  return ways;
}

/** What playing a route forward finds on it. */
export interface RoutePreview {
  /** Cells on the way that led to harm, worst first (the journey's own end is left out). */
  feared: { cell: string; area: string; harm: number; spot: Spot }[];
  /** Cells on the way that led to good. */
  good: number;
}

/** Plays a route forward on the map, before it is walked. */
export function previewRoute(map: MapStore, route: readonly string[]): RoutePreview {
  const on = route.slice(1, -1).map((key) => map.cell(key)).filter((c) => c !== null);
  return {
    feared: on.filter((c) => (c.led?.harm ?? 0) >= FEARED_CELL).map((c) => ({ cell: c.key, area: c.area, harm: c.led!.harm, spot: c.spot })).sort((a, b) => b.harm - a.harm),
    good: on.filter((c) => (c.led?.good ?? 0) >= FEARED_CELL).length,
  };
}
