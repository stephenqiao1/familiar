import type { MapStore, Spot } from "./map.js";

// Routes on the map: only through cells the bot has been in, along ways it has walked. A map
// allows a shortcut that no single remembered journey took.

/** A way never timed is taken to cost this long. */
const UNTIMED_MS = 4000;
/** A cell that led to harm costs this much extra, times how strongly (so another way is taken when there is one). */
const HARM_MS = 120_000;
/** A cell at or above this "led to harm" is worth going round, and worth telling the planner about. */
export const FEARED_CELL = 0.5;

/** The known cell whose spot is nearest a point (within `within` blocks), or null. `sameSpace`: keeps to cells of one dimension. */
export function nearestCell(map: MapStore, spot: Spot, within: number, sameSpace: (key: string) => boolean = () => true): string | null {
  let best: { key: string; d: number } | null = null;
  for (const c of map.cells()) {
    if (!sameSpace(c.key)) continue;
    const d = Math.hypot(c.spot.x - spot.x, c.spot.y - spot.y, c.spot.z - spot.z);
    if (d <= within && (!best || d < best.d)) best = { key: c.key, d };
  }
  return best?.key ?? null;
}

/**
 * The quickest known way from one cell to another: the cells in order, both ends included, or
 * null if the map does not connect them. Well-worn and rehearsed ways count as quicker; a cell
 * that led to harm counts as slow (`avoidHarm` 0 switches that off).
 */
export function routeThrough(map: MapStore, from: string, to: string, avoidHarm = 1): string[] | null {
  if (!map.cell(from) || !map.cell(to)) return null;
  const out = new Map<string, { to: string; ms: number }[]>();
  for (const l of map.links()) {
    const worn = 1 - 0.5 ** ((l.walks + l.rehearsed) / 3);
    const ms = (l.ms || UNTIMED_MS) / (0.5 + worn);
    out.set(l.a, [...(out.get(l.a) ?? []), { to: l.b, ms }]);
    out.set(l.b, [...(out.get(l.b) ?? []), { to: l.a, ms }]);
  }
  const cost = new Map([[from, 0]]);
  const came = new Map<string, string>();
  const open = new Set([from]);
  while (open.size) {
    let at = "";
    for (const key of open) if (at === "" || cost.get(key)! < cost.get(at)!) at = key;
    if (at === to) break;
    open.delete(at);
    for (const step of out.get(at) ?? []) {
      const harm = step.to === to ? 0 : (map.cell(step.to)?.led?.harm ?? 0) * HARM_MS * avoidHarm;
      const total = cost.get(at)! + step.ms + harm;
      if (total >= (cost.get(step.to) ?? Infinity)) continue;
      cost.set(step.to, total);
      came.set(step.to, at);
      open.add(step.to);
    }
  }
  if (from !== to && !came.has(to)) return null;
  const route = [to];
  while (route[0] !== from) route.unshift(came.get(route[0]!)!);
  return route;
}
