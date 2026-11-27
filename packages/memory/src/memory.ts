// A small memory of events and places, loosely modelled on the hippocampus. Everything else uses
// only `record`, `recall`, `knownPlaces` and `facts` (plus `tag` for the alarm, `consolidate` for
// rest, and `entries` for saving).
//
// Left for later, on purpose (hook only):
// TODO(memory): sharing memories between bots.

import { buildLeadsTo, eventLabel, pairOf, signOf } from "./leads-to.js";

export type MemoryKind = "danger" | "death" | "reward" | "discovery" | "social" | "failure" | "goal_done";

/** A rounded position and the dimension it is in. */
export interface Place {
  x: number;
  y: number;
  z: number;
  dimension: string;
}

export interface Outcome {
  feeling: "good" | "bad" | "neutral";
  /** How good (above 0) or bad (below 0) it was. */
  value: number;
}

/** Something worth remembering, before it is stored. */
export interface MemoryEvent {
  kind: MemoryKind;
  place: Place;
  /** One plain sentence, built by code. */
  summary: string;
  /** Who or what was involved (mob types, item names, skill names, ...). */
  involved: string[];
  outcome: Outcome;
  /** The circumstances, as short words (e.g. "night"). General facts keep what their memories share. */
  context?: string[];
  /** Record only if no memory of this kind involving the same things exists (e.g. a first sighting). */
  once?: boolean;
}

/** A general fact built by code from several memories that agree (e.g. "zombie is dangerous at night"). */
export interface Fact {
  id: string;
  text: string;
  kind: MemoryKind;
  /** The thing the fact is about. */
  involved: string;
  feeling: "good" | "bad";
  context: string[];
  /** How many memories supported it when it was last worked out. */
  support: number;
  /** 0 to 1: grows with support, falls each time a new memory contradicts it. */
  confidence: number;
  /** For a "leads to" fact (one kind of event following another): the pair it counts. Left out for a plain fact. */
  after?: string;
}

/** One part of a consolidation pass. */
export type ConsolidationPhase = "prune" | "merge" | "generalise" | "sequence";

export interface Memory extends Omit<MemoryEvent, "once"> {
  id: string;
  /** When it happened (ms); a repeat at the same place moves it forward. */
  time: number;
  /** 0 to 1, as of `strengthAt`; it fades from there. */
  strength: number;
  strengthAt: number;
  /** The memory recorded just before this one, when that was less than two minutes earlier. */
  previous?: string;
}

/** A named spot: a fixed one (base, bed, a chest) or one with a strong memory. */
export interface KnownPlace {
  name: string;
  place: Place;
  /** For a spot named after a memory: that memory's kind. */
  kind?: MemoryKind;
}

export interface RecallQuery {
  /** Prefer memories near here. */
  place?: Place;
  kind?: MemoryKind;
  /** Prefer memories involving this (a mob type, an item, ...). */
  involving?: string;
  limit: number;
  /** Recalling bumps a memory's strength a little. False to look without that. Default: true. */
  touch?: boolean;
}

export interface MemoryOptions {
  /** Most memories kept; when full, the weakest is dropped. Default: 500. */
  capacity?: number;
  /** How long a weak memory takes to lose half its strength, in ms. Default: 40 minutes (2 in-game days). */
  halfLifeMs?: number;
  saved?: { memories?: Memory[]; places?: KnownPlace[]; facts?: Fact[] };
  /**
   * Above 0, the order of events is kept: each memory links to the one before it, and two memories
   * are one only when they also had the same sign of outcome. 0: as before. Default: 0.
   */
  order?: number;
}

export interface MemoryStore {
  /**
   * Stores an event (at the given starting strength), or strengthens the memory of the same kind,
   * about the same things, at the same place within the last minute. Null if a `once` event is already known.
   * A memory that contradicts a general fact lowers that fact's confidence.
   */
  record(event: MemoryEvent, now: number, startingStrength?: number): { memory: Memory; merged: boolean } | null;
  /** The most relevant memories: near the place, involving the thing, strong, and recent. Strengths are as of `now`. */
  recall(query: RecallQuery, now: number): Memory[];
  /** Fixed named places, plus every spot with a strong memory. */
  knownPlaces(now: number): KnownPlace[];
  /** Names a fixed place (base, bed, a chest); naming it again moves it. */
  namePlace(name: string, place: Place): void;
  /** Raises a memory's strength to at least this (the alarm's stamp on an important moment). */
  tag(id: string, strength: number, now: number): void;
  /** General facts, most confident first; ones about `involving` come before the rest. */
  facts(query: { involving?: string; limit: number }): Fact[];
  /**
   * One part of sorting memories at rest; returns how many memories or facts it changed.
   * prune: drop memories that have faded to almost nothing. merge: fold near-duplicates into one.
   * generalise: write or update a fact for every group of `support` or more memories that share a
   * kind, a thing and an outcome. sequence: write a "leads to" fact for every kind of event that
   * followed another `support` times or more (only when the order of events is kept).
   */
  consolidate(phase: ConsolidationPhase, now: number, support?: number): number;
  /** Signs: events of the last few seconds that have been found to lead to something ("leads to" facts), by label. */
  signs(now: number): string[];
  /** The last event stored, by its label (kind and first thing involved), and when. Null: none yet. */
  latest(): { label: string; at: number } | null;
  /** Every "leads to" pair known, as [the sign, what follows it], by label. */
  leadsTo(): [string, string][];
  /** Everything, for saving. */
  entries(): { memories: Memory[]; places: KnownPlace[]; facts: Fact[] };
}

/** An event counts as a sign for this long after it happened. */
const SIGN_MS = 5000;

export const STARTING_STRENGTH = 0.3;
/** A memory this strong marks its spot as a known place. */
export const STRONG = 0.6;
/** Repeats of the same kind this close together, in time and space, are one memory. */
const MERGE_MS = 60_000;
const SAME_PLACE_BLOCKS = 8;
const MERGE_BOOST = 0.1;
const RECALL_BOOST = 0.05;
/** Recall: distance and age at which nearness and recency have halved. */
const NEAR_BLOCKS = 16;
const RECENT_MS = 1_200_000;
/** Consolidation: memories weaker than this are dropped. */
const PRUNE_BELOW = 0.05;
/** A fact needs this many agreeing memories, unless told otherwise. */
export const FACT_SUPPORT = 3;
/** What one contradicting memory costs a fact, and the confidence below which it is deleted. */
const CONTRADICTION = 0.2;
const FACT_FLOOR = 0.2;
/** A memory links to the one before it when they are less than this far apart. */
const LINKED_WITHIN_MS = 120_000;

/** Confidence from support: half at exactly the support needed, growing toward 0.95. */
function confidenceFor(count: number, needed: number): number {
  return Math.min(0.95, 1 - 0.5 ** (count / needed));
}

/** A plain sentence for a fact, built from the pattern. */
function factText(kind: MemoryKind, thing: string, feeling: "good" | "bad", context: string[]): string {
  const when = context.includes("night") ? " at night" : context.includes("day") ? " by day" : "";
  const name = thing.replace(/_/g, " ");
  if (kind === "danger" || kind === "death") return `${name} is dangerous${when}`;
  if (kind === "failure") return `${name} often fails${when}`;
  return `${name} tends to go ${feeling === "good" ? "well" : "badly"}${when}`;
}

export function distance(a: Place, b: Place): number {
  return a.dimension === b.dimension ? Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) : Infinity;
}

export function createMemory(options: MemoryOptions = {}): MemoryStore {
  const { capacity = 500, halfLifeMs = 2_400_000, saved = {}, order = 0 } = options;
  let memories: Memory[] = (saved.memories ?? []).map((m) => ({ ...m }));
  const named = new Map((saved.places ?? []).map((p) => [p.name, p.place]));
  let facts: Fact[] = (saved.facts ?? []).map((f) => ({ ...f }));
  let nextId = memories.reduce((max, m) => Math.max(max, Number(m.id) || 0), 0) + 1;
  let latest: { id: string; time: number } | null = null;
  /** Events kept apart: with the order kept, a good and a bad outcome are never one memory. */
  const sameSign = (a: Outcome, b: Outcome) => order <= 0 || Math.sign(a.value) === Math.sign(b.value);

  /** Strength now: it halves every half-life, and strong memories have a much longer one. */
  function strengthNow(m: Memory, now: number): number {
    const halfLife = halfLifeMs * Math.max(1, m.strength / STARTING_STRENGTH) ** 3;
    return m.strength * 0.5 ** (Math.max(0, now - m.strengthAt) / halfLife);
  }

  /** The event recorded last (for signs). */
  let justNow: { kind: MemoryKind; involved: string[]; time: number } | null = null;

  function setStrength(m: Memory, strength: number, now: number): void {
    m.strength = Math.min(1, strength);
    m.strengthAt = now;
  }

  return {
    record(event, now, startingStrength = STARTING_STRENGTH) {
      const { once, ...fields } = event;
      justNow = { kind: event.kind, involved: event.involved, time: now };
      const same = (m: Memory) => m.kind === event.kind && event.involved.every((i) => m.involved.includes(i));
      if (once && memories.some(same)) return null;
      // Guardrail against wrong facts: a memory with the opposite outcome weakens a fact about the same thing.
      if (event.outcome.feeling !== "neutral") {
        for (const fact of facts) if (event.involved.includes(fact.involved) && fact.feeling !== event.outcome.feeling) fact.confidence -= CONTRADICTION;
        facts = facts.filter((f) => f.confidence >= FACT_FLOOR);
      }
      const repeat = memories.find(
        (m) => m.kind === event.kind && m.involved.join() === event.involved.join() && sameSign(m.outcome, event.outcome) && now - m.time <= MERGE_MS && distance(m.place, event.place) <= SAME_PLACE_BLOCKS,
      );
      if (repeat) {
        setStrength(repeat, strengthNow(repeat, now) + MERGE_BOOST, now);
        repeat.time = now;
        return { memory: { ...repeat }, merged: true };
      }
      const memory: Memory = { ...fields, involved: [...event.involved], id: String(nextId++), time: now, strength: startingStrength, strengthAt: now };
      if (order > 0 && latest && now - latest.time < LINKED_WITHIN_MS) memory.previous = latest.id;
      latest = { id: memory.id, time: now };
      memories.push(memory);
      if (memories.length > capacity) {
        const weakest = memories.reduce((a, b) => (strengthNow(b, now) < strengthNow(a, now) ? b : a));
        memories = memories.filter((m) => m !== weakest);
      }
      return { memory: { ...memory }, merged: false };
    },

    recall({ place, kind, involving, limit, touch = true }, now) {
      const score = (m: Memory) =>
        strengthNow(m, now) +
        0.5 ** ((now - m.time) / RECENT_MS) * 0.3 +
        (place ? (1 / (1 + distance(m.place, place) / NEAR_BLOCKS)) * 2 : 0) +
        (involving !== undefined && m.involved.includes(involving) ? 1 : 0);
      const found = memories
        .filter((m) => kind === undefined || m.kind === kind)
        .sort((a, b) => score(b) - score(a))
        .slice(0, limit);
      if (touch) for (const m of found) setStrength(m, strengthNow(m, now) + RECALL_BOOST, now);
      return found.map((m) => ({ ...m, strength: strengthNow(m, now) }));
    },

    knownPlaces(now) {
      const places: KnownPlace[] = [...named].map(([name, place]) => ({ name, place }));
      const strong = memories.filter((m) => strengthNow(m, now) >= STRONG).sort((a, b) => strengthNow(b, now) - strengthNow(a, now));
      for (const m of strong) {
        // One entry per spot: the strongest memory there names it.
        if (places.some((p) => p.kind !== undefined && distance(p.place, m.place) <= SAME_PLACE_BLOCKS)) continue;
        places.push({ name: `${m.kind.replace("_", " ")}: ${m.involved[0] ?? m.summary}`, place: m.place, kind: m.kind });
      }
      return places;
    },

    namePlace(name, place) {
      named.set(name, place);
    },

    tag(id, strength, now) {
      const m = memories.find((x) => x.id === id);
      if (m && strength > strengthNow(m, now)) setStrength(m, strength, now);
    },

    facts({ involving, limit }) {
      const about = (f: Fact) => (involving !== undefined && f.involved === involving ? 1 : 0);
      return [...facts].sort((a, b) => about(b) - about(a) || b.confidence - a.confidence).slice(0, limit).map((f) => ({ ...f }));
    },

    consolidate(phase, now, support = FACT_SUPPORT) {
      if (phase === "prune") {
        const before = memories.length;
        memories = memories.filter((m) => strengthNow(m, now) >= PRUNE_BELOW);
        return before - memories.length;
      }
      if (phase === "merge") {
        const kept: Memory[] = [];
        for (const m of [...memories].sort((a, b) => strengthNow(b, now) - strengthNow(a, now))) {
          const twin = kept.find((k) => k.kind === m.kind && k.involved.join() === m.involved.join() && sameSign(k.outcome, m.outcome) && distance(k.place, m.place) <= SAME_PLACE_BLOCKS);
          if (!twin) {
            kept.push(m);
            continue;
          }
          setStrength(twin, strengthNow(twin, now) + MERGE_BOOST, now);
          twin.time = Math.max(twin.time, m.time);
        }
        const merged = memories.length - kept.length;
        memories = kept;
        return merged;
      }
      if (phase === "sequence") return order > 0 ? buildLeadsTo(memories, facts, support, confidenceFor) : 0;
      // generalise
      const groups = new Map<string, Memory[]>();
      for (const m of memories) {
        if (m.outcome.feeling === "neutral" || m.involved[0] === undefined) continue;
        const key = `${m.kind}|${m.involved[0]}|${m.outcome.feeling}`;
        groups.set(key, [...(groups.get(key) ?? []), m]);
      }
      let written = 0;
      for (const [key, group] of groups) {
        if (group.length < support) continue;
        const [kind, involved, feeling] = key.split("|") as [MemoryKind, string, "good" | "bad"];
        const context = (group[0]!.context ?? []).filter((c) => group.every((m) => m.context?.includes(c)));
        const existing = facts.find((f) => f.after === undefined && f.kind === kind && f.involved === involved && f.feeling === feeling);
        if (!existing) {
          facts.push({ id: `f${facts.length + 1}-${involved}`, text: factText(kind, involved, feeling, context), kind, involved, feeling, context, support: group.length, confidence: confidenceFor(group.length, support) });
          written++;
        } else if (group.length > existing.support) {
          // More support raises confidence by the difference, so earlier contradictions still count.
          existing.confidence = Math.min(0.95, existing.confidence + confidenceFor(group.length, support) - confidenceFor(existing.support, support));
          existing.support = group.length;
          written++;
        }
      }
      return written;
    },

    signs(now) {
      const sign = justNow && now - justNow.time <= SIGN_MS ? signOf(justNow, facts) : null;
      return sign ? [sign] : [];
    },

    latest: () => (justNow ? { label: eventLabel(justNow), at: justNow.time } : null),
    leadsTo: () => facts.flatMap((f) => (f.after ? [pairOf(f.after)] : [])),

    entries: () => ({
      memories: memories.map((m) => ({ ...m })),
      places: [...named].map(([name, place]) => ({ name, place })),
      facts: facts.map((f) => ({ ...f })),
    }),
  };
}

/** How many general facts a planner is given. */
const TOP_FACTS = 3;
/** A memory this close colours how a place feels. */
const FELT_WITHIN_BLOCKS = 24;

/** How a place feels from memory: the strongest good or bad memory close by, or null. Does not count as recalling. */
export function feelingNear(memory: MemoryStore, place: Place, now: number): { nearby: "good" | "bad"; kind: MemoryKind } | null {
  const close = memory
    .recall({ place, limit: 10, touch: false }, now)
    .filter((m) => m.outcome.feeling !== "neutral" && distance(m.place, place) <= FELT_WITHIN_BLOCKS)
    .sort((a, b) => b.strength - a.strength)[0];
  return close ? { nearby: close.outcome.feeling as "good" | "bad", kind: close.kind } : null;
}

/** For a planner: the most relevant memories as short sentences, the top general facts, and the known places. Counts as recalling. */
export function memoryNotes(memory: MemoryStore, place: Place | null, now: number, limit = 5, wayTo?: (to: Place) => string | null): string[] {
  const at = (p: Place) => `${p.x},${p.y},${p.z}${place && p.dimension !== place.dimension ? ` in ${p.dimension}` : ""}`;
  const memories = memory.recall({ ...(place ? { place } : {}), limit }, now);
  const places = memory.knownPlaces(now);
  const learned = memory.facts({ limit: TOP_FACTS });
  // Played forward on the map before any journey: what lies on the known way to each place.
  const way = (to: Place) => {
    const line = place && to.dimension === place.dimension ? wayTo?.(to) : null;
    return line ? ` (${line})` : "";
  };
  return [
    ...(memories.length ? ["Memories:", ...memories.map((m) => `- ${m.summary} (at ${at(m.place)})`)] : []),
    ...(learned.length ? ["Learned from experience:", ...learned.map((f) => `- ${f.text}`)] : []),
    ...(places.length ? ["Known places:", ...places.map((p) => `- ${p.name} at ${at(p.place)}${way(p.place)}`)] : []),
  ];
}
