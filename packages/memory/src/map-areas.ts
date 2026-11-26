import type { MapCell, MapLink } from "./map.js";

// Areas: cells that connect with nothing in between (no door, no climb) and share a setting (the
// same light) form one area: a cave, a house, a field. An area is the "where" other regions use.

/**
 * Labels every cell with its area, keeping labels steady as the map grows: a group of joined
 * cells keeps the label most of its cells already had; when two groups claim one label the
 * larger keeps it and the other gets a new one. Returns the next unused area number.
 */
export function labelAreas(cells: MapCell[], links: MapLink[], settingOf: (c: MapCell) => string, nextArea: number): number {
  const byKey = new Map(cells.map((c) => [c.key, c]));
  const joined = new Map<string, string[]>();
  for (const l of links) {
    const [a, b] = [byKey.get(l.a), byKey.get(l.b)];
    if (!a || !b || l.barrier || settingOf(a) !== settingOf(b)) continue;
    joined.set(a.key, [...(joined.get(a.key) ?? []), b.key]);
    joined.set(b.key, [...(joined.get(b.key) ?? []), a.key]);
  }
  const groups: MapCell[][] = [];
  const done = new Set<string>();
  for (const start of cells) {
    if (done.has(start.key)) continue;
    const group: MapCell[] = [];
    const queue = [start.key];
    done.add(start.key);
    while (queue.length) {
      const key = queue.pop()!;
      group.push(byKey.get(key)!);
      for (const next of joined.get(key) ?? []) if (!done.has(next)) (done.add(next), queue.push(next));
    }
    groups.push(group);
  }
  const taken = new Set<string>();
  for (const group of groups.sort((x, y) => y.length - x.length)) {
    const votes = new Map<string, number>();
    for (const c of group) if (c.area && !taken.has(c.area)) votes.set(c.area, (votes.get(c.area) ?? 0) + 1);
    const label = [...votes].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0]?.[0] ?? `a${nextArea++}`;
    taken.add(label);
    for (const c of group) c.area = label;
  }
  return nextArea;
}
