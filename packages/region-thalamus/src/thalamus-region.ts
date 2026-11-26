import type { Region, State, Workspace } from "@familiar/contracts";
import { createAsks } from "./asks.js";
import { fullShare, limitFor, mostItems } from "./budget.js";
import { createBursts, type Bursts } from "./burst.js";
import { fill, makeRoom, type Candidate } from "./fill.js";
import { openedBy } from "./gate.js";
import type { Form, Item, Split } from "./item.js";
import { priorityOf, type Facts } from "./priority.js";
import { DEFAULT_LIMIT, type ThalamusSettings } from "./settings.js";
import { BURST_SIGNAL } from "./signals.js";

export interface ThalamusOptions {
  /** Who gets a view: the deciding layers, by region name. Every other region reads the full state. */
  readers: string[];
  settings: ThalamusSettings;
  /** How many of each kind of nearby thing a view keeps this tick, with the gate off. Default: all of them. */
  nearby?(ws: Workspace): number;
  /** Cuts a state down to its nearest `count` of each kind of nearby thing (the game says how). Default: no cut. */
  trim?(state: State, count: number): State;
  /** Leaves in a state only what the body can know of: what it sees, hears or just saw (the game says how). Used with `fieldOfView` above 0. */
  inView?(state: State): State;
  /** Takes a state apart into channels of items (the game says how). Without it there is no gate. */
  split?(state: State): Split;
  /** How much this kind of thing is wanted right now, 0 to 1. Default: 0. */
  wantOf?(kind: string, ws: Workspace): number;
  /** How far this thing has been got used to, 0 to 1. Default: 0. */
  usedTo?(item: Item, ws: Workspace): number;
  /** How much harm this thing has been learned to predict, 0 to 1 (the amygdala's word): a feared thing is passed on in full. Default: 0. */
  fearOf?(item: Item, ws: Workspace): number;
  /** Focus, 0 to 1. Default: 0.5. */
  focusOf?(ws: Workspace): number;
  /** Arousal, 0 to 1. Default: 0.5. */
  arousalOf?(ws: Workspace): number;
  /** How strongly something just stood out, 0 to 1 (the colliculus's `orienting`). Default: 0. */
  orientingOf?(ws: Workspace): number;
  /** This reader is paused: no view is built for it. Default: never. */
  paused?(reader: string, ws: Workspace): boolean;
  /** A skill whose target is not a task (the look itself). Default: none. */
  lookSkill?: string;
  /** How big a view is. Default: its length as JSON. */
  sizeOf?(state: State): number;
  /** Default: "thalamus". */
  name?: string;
  /** Default: 0 (runs inside every tick). */
  layer?: number;
}

export const THALAMUS_LIMIT_MS = 2;
/** A burst with `orienting` at least this high sets the deciding layers back to full rate. */
export const STRONG_BURST = 0.6;
/** The trace lists at most this many of a view's items. */
const TRACED_ITEMS = 12;

/**
 * The thalamus: the gateway between the full state and the deciding layers. The brain keeps
 * the full state for its own work; each tick the thalamus builds a view of it for each reader
 * and stores it in the workspace (`ws.view(reader)`). A view only ever selects and shortens:
 * it never changes a value or invents one. It never calls a model.
 *   a) the field of view: only what the body sees, hears or just saw, when that is switched on;
 *   b) channels and items: the game splits the state into channels of items (item.ts);
 *   c) priority: each item's channel base, raised by modulators (priority.ts);
 *   d) the gate: each channel is open or turned down (gate.ts);
 *   e) the fill: forms are handed out by priority up to the reader's limit, which arousal sizes
 *      and focus shapes (fill.ts, budget.ts); what is held back is counted;
 *   f) the burst: news in a turned-down channel is passed once, in brief (burst.ts);
 *   g) the planner's asks open channels too (asks.ts).
 * With `gate` at 0, or no way to split a state, a view is the nearest few of each kind of thing.
 * It must be listed before the readers, so that they read this tick's view.
 */
export function createThalamusRegion(options: ThalamusOptions): Region {
  const { readers, settings, name = "thalamus", layer = 0 } = options;
  const sizeOf = options.sizeOf ?? ((state: State) => JSON.stringify(state).length);
  const bursts = new Map<string, Bursts>(readers.map((reader) => [reader, createBursts()]));
  const asks = createAsks();
  let worstMs = 0;

  /** The view by count alone: the nearest few of each kind, then the field of view. */
  function byCount(ws: Workspace, trace: Record<string, unknown>): void {
    const full = ws.state;
    const nearby = options.nearby?.(ws);
    let view = full;
    if (options.trim && nearby !== undefined) view = options.trim(view, nearby);
    if (settings.fieldOfView > 0 && options.inView) view = options.inView(view);
    for (const reader of readers) ws.setView(reader, view);
    const size = sizeOf(view);
    Object.assign(trace, { ...(nearby === undefined ? {} : { nearby }), fullSize: view === full ? size : sizeOf(full), views: Object.fromEntries(readers.map((reader) => [reader, { size }])) });
  }

  /** The gated view: by priority, up to each reader's limit. */
  function gated(ws: Workspace, split: Split, trace: Record<string, unknown>): void {
    const now = ws.state.timestamp;
    const strengths = { spotlight: settings.spotlight, threats: settings.threats, wants: settings.wants, detail: settings.detail };
    const target = ws.current && ws.current.skill !== options.lookSkill ? (ws.current.target ?? null) : null;
    const watched = ws.goal?.watchFor ?? [];
    const items = split.channels.flatMap((channel) => channel.items.map((item) => ({ item, channel })));
    const answers = (ask: string, item: Item) => ask === item.kind || ask === item.id;
    const asked = settings.detail > 0 ? (ws.goal?.detail ?? []) : [];
    const inForce = asks.active(asked, new Set(asked.filter((ask) => items.some(({ item }) => answers(ask, item)))), now);
    const facts = new Map<string, Facts>();
    for (const { item, channel } of items) {
      facts.set(item.id, {
        base: channel.base,
        attended: ws.attended?.id === item.id,
        target: target === item.id,
        threat: item.threat ?? 0,
        asked: inForce.some((ask) => answers(ask, item)),
        wanted: options.wantOf?.(item.kind, ws) ?? 0,
        watched: watched.includes(item.kind),
        ...(item.fresh ? { fresh: true } : {}),
        ...(item.dist === undefined ? {} : { dist: item.dist }),
        usedTo: options.usedTo?.(item, ws) ?? 0,
        feared: options.fearOf?.(item, ws) ?? 0,
      });
    }
    const open = new Map(split.channels.map((channel) => [channel.name, openedBy(channel.items.map((item) => facts.get(item.id)!), strengths)]));
    const weighed = new Map(items.map(({ item }) => [item.id, priorityOf(facts.get(item.id)!, strengths)]));
    const candidates: Candidate[] = items.map(({ item, channel }) => {
      const f = facts.get(item.id)!;
      const spot = settings.spotlight > 0 && (f.attended === true || f.target === true);
      return { id: item.id, channel: channel.name, priority: weighed.get(item.id)!.priority, cost: item.cost, open: open.get(channel.name) !== null, must: spot || (item.threat ?? 0) >= 2 || item.vital === true, floor: (item.threat ?? 0) >= 1 };
    });
    const [focus, arousal, orienting] = [options.focusOf?.(ws) ?? 0.5, options.arousalOf?.(ws) ?? 0.5, options.orientingOf?.(ws) ?? 0];
    const news = items.filter(({ item, channel }) => item.fresh && open.get(channel.name) === null).map(({ item }) => ({ id: item.id, source: item.place ? `${item.kind} at ${item.place}` : item.id }));
    const views: Record<string, unknown> = {};
    let strong = false;
    for (const reader of readers) {
      if (options.paused?.(reader, ws)) {
        views[reader] = { paused: true };
        continue;
      }
      const limit = limitFor(settings.limits[reader] ?? DEFAULT_LIMIT, arousal, settings.size);
      const filled = fill({ items: candidates, limit, fixed: split.fixed, fullShare: fullShare(focus, settings.shape), shaped: settings.shape > 0, most: mostItems(arousal, settings.size) });
      // The burst: news in a turned-down channel is passed this once, marked as new. If it was only counted it is
      // given its brief form whatever the budget, the lowest full item giving way if there is no room.
      const burst: string[] = [];
      const gaveWay: string[] = [];
      for (const id of settings.burst > 0 ? bursts.get(reader)!.due(news, now) : []) {
        burst.push(id);
        if (filled.forms.get(id) !== "counted") continue;
        const item = candidates.find((c) => c.id === id)!;
        if (filled.spent + item.cost.brief > limit) {
          const dropped = makeRoom(filled, candidates);
          if (dropped) gaveWay.push(dropped);
        }
        filled.forms.set(id, "brief");
        filled.spent += item.cost.brief;
        filled.heldBack[item.channel]! -= 1;
        if (filled.heldBack[item.channel] === 0) delete filled.heldBack[item.channel];
      }
      if (burst.length && orienting >= STRONG_BURST) strong = true;
      const view = split.assemble(filled.forms, { heldBack: filled.heldBack, new: burst });
      ws.setView(reader, view);
      // How many items of each channel got each form, in one pass.
      const tally = new Map<string, Record<Form, number>>();
      for (const c of candidates) {
        const counts = tally.get(c.channel) ?? { full: 0, brief: 0, counted: 0 };
        counts[filled.forms.get(c.id) ?? "counted"]++;
        tally.set(c.channel, counts);
      }
      views[reader] = {
        limit,
        // The size is what was spent: the forms' own sizes added up (within a few characters of the view as JSON).
        spent: filled.spent,
        size: filled.spent,
        ...(filled.over > 0 ? { over: filled.over, warning: `what may never be held back went ${filled.over} over the limit by itself` } : {}),
        channels: Object.fromEntries(split.channels.filter((c) => c.items.length).map((c) => [c.name, { open: open.get(c.name) ?? false, ...(tally.get(c.name) ?? { full: 0, brief: 0, counted: 0 }) }])),
        items: candidates
          .filter((c) => filled.forms.get(c.id) !== "counted")
          .sort((a, b) => b.priority - a.priority)
          .slice(0, TRACED_ITEMS)
          .map((c) => ({ id: c.id, form: filled.forms.get(c.id), priority: round(c.priority), by: weighed.get(c.id)!.by })),
        ...(burst.length ? { bursts: burst, ...(gaveWay.length ? { gaveWay } : {}) } : {}),
        heldBack: filled.heldBack,
      };
    }
    if (settings.burst > 0) ws.setSignal(BURST_SIGNAL, strong ? 1 : 0);
    Object.assign(trace, { fullSize: split.fixed + items.reduce((sum, { item }) => sum + item.cost.full, 0), fixed: split.fixed, focus: round(focus), arousal: round(arousal), ...(inForce.length ? { asks: inForce } : {}), views });
  }

  return {
    name,
    layer,
    everyMs: 0,
    run(ws) {
      const started = performance.now();
      const trace: Record<string, unknown> = {};
      if (settings.gate > 0 && options.split) gated(ws, options.split(settings.fieldOfView > 0 && options.inView ? options.inView(ws.state) : ws.state), trace);
      else byCount(ws, trace);
      const ms = performance.now() - started;
      trace.ms = Math.round(ms * 1000) / 1000;
      if (ms > worstMs) {
        worstMs = ms;
        trace.worstMs = Math.round(ms * 1000) / 1000;
      }
      return { proposals: [], trace };
    },
  };
}

const round = (n: number) => Math.round(n * 100) / 100;
