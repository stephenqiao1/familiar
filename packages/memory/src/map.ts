import { labelAreas } from "./map-areas.js";

// The hippocampus's map: the cells the bot has been in, which it has walked between and how long
// that took, and what it saw in each. Learned by moving about; no reward is needed. Game-free: the
// game's side says what a cell is (`CellNow`). Every number is a first guess.

export interface Spot {
  x: number;
  y: number;
  z: number;
}

/** The cell the bot is in right now, as the game's side reads it. */
export interface CellNow {
  /** Unique name of the cell (it includes the dimension). */
  key: string;
  /** Where the bot stands in it: a spot known to be reachable. */
  spot: Spot;
  /** What kind of surroundings this is ("open", "covered"): two cells of different kinds are different areas. */
  setting: string;
  /** Kinds of things in view, and how many of each. */
  seen: Record<string, number>;
  /** The part of the day ("day", "night"): what is usual here is kept for each. Left out: no record of what is usual is kept. */
  band?: string;
  /** Changes just seen, each as "<kind>:<what changed>" ("door:changed"). Default: none. */
  changes?: string[];
}

export interface MapCell {
  key: string;
  /** The last spot the bot stood on here. */
  spot: Spot;
  /** The area it belongs to: cells joined by plain links with the same setting. */
  area: string;
  /** Ticks spent in each setting; the most common is the cell's setting. */
  settings: Record<string, number>;
  visits: number;
  dwellMs: number;
  lastAt: number;
  /** What was seen here: kind → how many, as of `at` (it fades from there). */
  seen: Record<string, { count: number; at: number }>;
  /** Left by replay: how strongly passing through here led to good, or to harm (each 0 to 1). */
  led?: { good: number; harm: number };
  /** How many times the bot has looked about here, by part of the day (once on coming in, then once every half minute it stays). */
  looks?: Record<string, number>;
  /** Of those looks, how many had each kind of thing in view: part of the day → kind → looks. */
  had?: Record<string, Record<string, number>>;
  /** When each kind of thing was first seen from here. */
  first?: Record<string, number>;
}

/** Two cells the bot has walked between. */
export interface MapLink {
  a: string;
  b: string;
  /** The quickest it has got from entering one to entering the other. */
  ms: number;
  walks: number;
  /** Strengthened by replay at rest (counted like extra walks). */
  rehearsed: number;
  /** What lay between them, if anything ("door", "climb"): a barrier ends an area. */
  barrier?: string;
}

export interface SavedMap {
  cells: MapCell[];
  links: MapLink[];
  nextArea: number;
  /** Every change seen so far ("door:changed"), and when it was first seen. */
  changes?: Record<string, number>;
}

export interface MapOptions {
  saved?: Partial<SavedMap>;
  /** How fast a place becomes familiar, 0 to 1. Default: 1. */
  rate?: number;
  /** Two cells whose spots are further apart than this were not walked between (a teleport, a respawn). Default: 24. */
  reach?: number;
  /** How long a sighting takes to fade to half if not seen again, in ms. Default: 40 minutes (2 game days). */
  seenHalfLifeMs?: number;
}

export interface MapStore {
  /** Call every tick with the cell the bot is in. `barrier`: what it just came through, if it changed cell. Returns whether it entered another cell. */
  at(cell: CellNow, now: number, barrier?: string | null): { entered: boolean; from: string | null };
  cell(key: string): MapCell | null;
  cells(): MapCell[];
  links(): MapLink[];
  /** The links out of one cell. */
  linksOf(key: string): MapLink[];
  /** 0 (never been) to 1 (well known): grows with visits and time spent. */
  familiarity(key: string): number;
  /** What was seen in a cell, faded: kind → count. */
  seenIn(key: string, now: number): Record<string, number>;
  /** What is usual in a cell at a part of the day: how many looks that stands on, and the share of them each kind was in view. */
  usual(key: string, band: string): { looks: number; share: Record<string, number> };
  /** How many looks the bot has had from the cells of an area, at any time of day. */
  looksIn(area: string): number;
  /** When a kind of thing was first seen from any cell of an area, or null if never. */
  firstSeenIn(area: string, kind: string): number | null;
  /** When a change ("door:changed") was first seen anywhere, or null if never. */
  changeFirst(change: string): number | null;
  /** Replay's mark on a cell: adds to "led to good" or "led to harm" (never above 1). */
  mark(key: string, sign: "good" | "harm", amount: number): void;
  /** Replay at rest: a link gone over again counts toward its strength. */
  rehearse(a: string, b: string, amount: number): boolean;
  entries(): SavedMap;
}

/** Visits (and half-minutes spent) at which a cell is half familiar. */
const HALF_FAMILIAR = 4;
const DWELL_COUNTS_MS = 30_000;
const SEEN_GONE = 0.25;
/** While the bot stays in a cell, it counts as having looked about again this often. */
export const LOOK_EVERY_MS = 30_000;
export const linkKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export function createMap(options: MapOptions = {}): MapStore {
  const { saved = {}, rate = 1, reach = 24, seenHalfLifeMs = 2_400_000 } = options;
  const cells = new Map((saved.cells ?? []).map((c) => [c.key, structuredClone(c)]));
  const links = new Map((saved.links ?? []).map((l) => [linkKey(l.a, l.b), { ...l }]));
  let nextArea = saved.nextArea ?? 1;
  const changes: Record<string, number> = { ...saved.changes };
  let here: { key: string; since: number; last: number } | null = null;
  /** When the bot last looked about in the cell it is in. */
  let lookedAt = -Infinity;
  const faded = (s: { count: number; at: number }, now: number) => s.count * 0.5 ** (Math.max(0, now - s.at) / seenHalfLifeMs);
  const settingOf = (c: MapCell) => Object.entries(c.settings).sort((x, y) => y[1] - x[1])[0]?.[0] ?? "";
  const relabel = () => void (nextArea = labelAreas([...cells.values()], [...links.values()], settingOf, nextArea));

  return {
    at(now_, now, barrier = null) {
      let cell = cells.get(now_.key);
      const entered = here?.key !== now_.key;
      const from = entered ? (here?.key ?? null) : null;
      let changed = false;
      if (!cell) {
        cell = { key: now_.key, spot: { ...now_.spot }, area: "", settings: {}, visits: 0, dwellMs: 0, lastAt: now, seen: {} };
        cells.set(cell.key, cell);
        changed = true;
      }
      const was = settingOf(cell);
      cell.settings[now_.setting] = (cell.settings[now_.setting] ?? 0) + 1;
      changed ||= settingOf(cell) !== was;
      if (entered) {
        cell.visits++;
        const prev = here && cells.get(here.key);
        if (prev && here && Math.hypot(prev.spot.x - now_.spot.x, prev.spot.y - now_.spot.y, prev.spot.z - now_.spot.z) <= reach) {
          const id = linkKey(prev.key, cell.key);
          const link = links.get(id) ?? { a: prev.key, b: cell.key, ms: 0, walks: 0, rehearsed: 0 };
          // The quickest crossing so far: time spent standing about in a cell is not the way's length.
          const took = Math.max(0, now - here.since);
          link.ms = link.walks ? Math.min(link.ms, took) : took;
          link.walks++;
          // A way once walked with nothing in between is a plain way, whatever lay there another time.
          const [isNew, had] = [!links.has(id), link.barrier];
          if (!barrier) delete link.barrier;
          else if (isNew) link.barrier = barrier;
          changed ||= isNew || had !== link.barrier;
          links.set(id, link);
        }
        here = { key: cell.key, since: now, last: now };
      } else if (here) {
        cell.dwellMs += Math.max(0, now - here.last);
        here.last = now;
      }
      cell.spot = { ...now_.spot };
      cell.lastAt = now;
      for (const [kind, count] of Object.entries(now_.seen)) cell.seen[kind] = { count: Math.max(count, cell.seen[kind] ? faded(cell.seen[kind], now) : 0), at: now };
      for (const [kind, s] of Object.entries(cell.seen)) if (faded(s, now) < SEEN_GONE) delete cell.seen[kind];
      // What is usual here: every kind's first sighting, and a count of looks with and without it.
      const first = (cell.first ??= {});
      for (const kind of Object.keys(now_.seen)) first[kind] ??= now;
      for (const change of now_.changes ?? []) changes[change] ??= now;
      if (now_.band !== undefined && (entered || now - lookedAt >= LOOK_EVERY_MS)) {
        lookedAt = now;
        const looks = (cell.looks ??= {});
        looks[now_.band] = (looks[now_.band] ?? 0) + 1;
        const had = ((cell.had ??= {})[now_.band] ??= {});
        for (const kind of Object.keys(now_.seen)) had[kind] = (had[kind] ?? 0) + 1;
      }
      if (changed) relabel();
      return { entered, from };
    },
    cell: (key) => cells.get(key) ?? null,
    cells: () => [...cells.values()],
    links: () => [...links.values()],
    linksOf: (key) => [...links.values()].filter((l) => l.a === key || l.b === key),
    familiarity(key) {
      const c = cells.get(key);
      return c ? 1 - 0.5 ** (((c.visits + c.dwellMs / DWELL_COUNTS_MS) * rate) / HALF_FAMILIAR) : 0;
    },
    seenIn(key, now) {
      return Object.fromEntries(Object.entries(cells.get(key)?.seen ?? {}).map(([kind, s]) => [kind, Math.round(faded(s, now) * 10) / 10]));
    },
    usual(key, band) {
      const c = cells.get(key);
      const looks = c?.looks?.[band] ?? 0;
      return { looks, share: looks ? Object.fromEntries(Object.entries(c?.had?.[band] ?? {}).map(([kind, n]) => [kind, n / looks])) : {} };
    },
    looksIn(area) {
      let looks = 0;
      for (const c of cells.values()) if (c.area === area) for (const n of Object.values(c.looks ?? {})) looks += n;
      return looks;
    },
    firstSeenIn(area, kind) {
      let first: number | null = null;
      for (const c of cells.values()) {
        const at = c.area === area ? c.first?.[kind] : undefined;
        if (at !== undefined && (first === null || at < first)) first = at;
      }
      return first;
    },
    changeFirst: (change) => changes[change] ?? null,
    mark(key, sign, amount) {
      const c = cells.get(key);
      if (!c) return;
      c.led ??= { good: 0, harm: 0 };
      c.led[sign] = Math.min(1, c.led[sign] + amount);
    },
    rehearse(a, b, amount) {
      const link = links.get(linkKey(a, b));
      if (link) link.rehearsed += amount;
      return link !== undefined;
    },
    entries: () => ({ cells: [...cells.values()].map((c) => structuredClone(c)), links: [...links.values()].map((l) => ({ ...l })), nextArea, changes: { ...changes } }),
  };
}
