import type { State, Workspace } from "@familiar/contracts";
import type { Area, Condition } from "@familiar/neocortex";
import { HOLD_MS, known, MIN_LOOKS, MOMENT_MS, SETTLE_MS, SIZE, UNEXPECTED_SIGNAL, USUAL_SHARE, type Surprise } from "./surprise.js";

/** What the sensory area reads of the hippocampus's record of each place (the map). It only reads. */
export interface UsualSource {
  /** What is usual in a cell at a part of the day: the looks that stands on, and the share of them each kind was in view. */
  usual(cell: string, band: string): { looks: number; share: Record<string, number> };
  /** How many looks the bot has had in an area. */
  looksIn(area: string): number;
  /** When a kind was first seen in an area, or null. */
  firstSeenIn(area: string, kind: string): number | null;
  /** When a change ("door:changed") was first seen anywhere, or null. */
  changeFirst(change: string): number | null;
}

export interface SensoryOptions {
  /** How much of each surprise is shared, 0 to 1. At 0 the area does nothing. */
  strength: number;
  /** The things in a view, each with its kind (the game says how), or null if it is not a state of the game. */
  thingsOf(view: State): { id: string; kind: string }[] | null;
  /** The things that just changed in a view other than by appearing, and what changed. Default: none. */
  changesOf?(view: State): { id: string; kind: string; what: string }[];
  /** The part of the day, as the map keeps what is usual ("day", "night"). */
  bandOf(view: State): string | null;
  /** The map's record of what is usual. Without it only expectations from above can be broken. */
  usual?: UsualSource;
  /** Reads a condition's text, for the expectations the area above adds. Default: none is understood. */
  parse?(text: string | undefined): Condition | null;
  /** True to do nothing this tick (asleep). Default: never. */
  paused?(ws: Workspace): boolean;
  /** Default: "sensory". */
  name?: string;
  /** Default: 0. */
  layer?: number;
}

/**
 * The sensory area: guesses what is in view and reports only where it was wrong. Its guess is
 * what was here a moment ago, plus what is usual in this place at this time of day (from the
 * hippocampus's map), plus what the area above says to expect (the goal's `expect`). It reports:
 *   new          a kind of thing never seen in this area before, in an area it has looked about;
 *   missing      a kind that is usually in view from this cell and is not;
 *   changed      a thing that changed in a way never seen before;
 *   expectation  an expectation from above that does not hold (this one counts fully).
 * Each is reported once, upward and for a few seconds; `unexpected` is the strongest of them.
 * It proposes nothing and makes no model call.
 */
export function createSensoryArea(options: SensoryOptions): Area {
  const { strength, usual, name = "sensory", layer = 0 } = options;
  /** When each kind was last in view. */
  const lastSeen = new Map<string, number>();
  /** What is being reported now. */
  let active: Surprise[] = [];
  /** What has been reported and is still so: a usual kind still missing, an expectation still broken. Each is reported once. */
  const standing = new Set<string>();
  let cell: { key: string; since: number } | null = null;

  return {
    name,
    layer,
    everyMs: 0,
    input: name,
    run({ ws, view, feedback }) {
      const things = strength > 0 && !options.paused?.(ws) ? options.thingsOf(view) : null;
      if (!things) {
        ws.setSignal(UNEXPECTED_SIGNAL, 0);
        return { action: [] };
      }
      const now = ws.state.timestamp;
      const place = ws.place;
      const band = options.bandOf(view);
      const target = ws.current?.target;
      const inView = new Map<string, string[]>();
      for (const t of things) inView.set(t.kind, [...(inView.get(t.kind) ?? []), t.id]);
      const moment = (kind: string) => now - (lastSeen.get(kind) ?? -Infinity) <= MOMENT_MS;
      if (cell?.key !== place?.cell) cell = place ? { key: place.cell, since: now } : null;
      const found: Surprise[] = [];
      const guess: { usual: string[] } = { usual: [] };

      if (usual && place) {
        // A kind never seen in this area: only in an area it has looked about enough to say so.
        const looks = usual.looksIn(place.area);
        if (looks >= MIN_LOOKS) {
          for (const [kind, ids] of inView) {
            if (moment(kind)) continue;
            const first = usual.firstSeenIn(place.area, kind);
            if (first === null || now - first <= MOMENT_MS) found.push({ what: "new", kind, ids, size: SIZE.new * known(looks), why: `a ${kind} here, where none was seen before`, at: now });
          }
        }
        // A kind that is usually in view from here, and is not (and was not a moment ago).
        const here = band === null ? null : usual.usual(place.cell, band);
        if (here && here.looks >= MIN_LOOKS) {
          for (const [kind, share] of Object.entries(here.share)) {
            if (share < USUAL_SHARE) continue;
            guess.usual.push(kind);
            const key = `missing|${place.cell}|${kind}`;
            if (inView.has(kind)) standing.delete(key);
            else if (!moment(kind) && !standing.has(key) && now - cell!.since >= SETTLE_MS) {
              standing.add(key);
              found.push({ what: "missing", kind, ids: [], size: SIZE.missing * share * known(here.looks), why: `no ${kind} here, where there usually is one`, at: now });
            }
          }
        }
        // A change never seen before (not the bot's own doing to what its skill is aimed at).
        for (const change of options.changesOf?.(view) ?? []) {
          if (change.id === target) continue;
          const first = usual.changeFirst(`${change.kind}:${change.what}`);
          const key = `changed|${change.kind}:${change.what}`;
          if ((first === null || now - first <= MOMENT_MS) && !standing.has(key)) {
            standing.add(key);
            found.push({ what: "changed", kind: change.kind, ids: [change.id], size: SIZE.changed, why: `a ${change.kind} ${change.what.replace(/_/g, " ")}, as none has before`, at: now });
          }
        }
      }

      // What the area above says to expect: broken, it counts fully.
      const unread: string[] = [];
      for (const expected of feedback?.goal?.expect ?? []) {
        const [what, when] = [options.parse?.(expected.what) ?? null, expected.when === undefined ? null : (options.parse?.(expected.when) ?? null)];
        if (!what || (expected.when !== undefined && !when)) {
          unread.push(what ? expected.when! : expected.what);
          continue;
        }
        const key = `expectation|${expected.what}|${expected.when ?? ""}`;
        const broken = (when?.holds(ws) ?? true) && !what.holds(ws);
        if (!broken) standing.delete(key);
        else if (!standing.has(key)) {
          standing.add(key);
          found.push({ what: "expectation", kind: expected.what, ids: [], size: SIZE.expectation, why: `expected "${expected.what}"${expected.when ? ` when "${expected.when}"` : ""}, and it is not so`, at: now });
        }
      }

      for (const kind of inView.keys()) lastSeen.set(kind, now);
      active = [...active.filter((s) => now - s.at < HOLD_MS), ...found];
      const strongest = Math.max(0, ...active.map((s) => s.size));
      ws.setSignal(UNEXPECTED_SIGNAL, strength * strongest);
      const trace = { guess: { moment: [...lastSeen].filter(([, at]) => now - at <= MOMENT_MS).map(([kind]) => kind), ...guess }, ...(found.length ? { unexpected: found } : {}), ...(unread.length ? { unread } : {}) };
      // Only the difference goes up: with none, nothing does.
      return { action: [], up: active.length ? { unexpected: active } : null, trace };
    },
  };
}
