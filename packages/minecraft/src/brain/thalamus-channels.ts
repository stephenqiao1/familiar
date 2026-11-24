import type { State } from "@familiar/contracts";
import type { Channel, Form, Item, Split, Told } from "@familiar/region-thalamus";
import type { MinecraftStateData } from "../encode/state-data.js";
import { placeOfThing } from "./colliculus-percepts.js";
import { defenceOf, minecraftDataOf } from "./read-state.js";

// How the player's state is taken apart for the thalamus, and put back together. Each list of
// nearby things is a channel of items; each item has a full form (as the state has it), a brief
// form (id, kind, distance and bearing) and can be merely counted. The body, what it carries,
// the time, the feeling of the place and the defence's choice are always passed whole.
// Add a channel: give it a base here and say which items are its own in `splitState`.

/** Where each channel's items start from (the driver), before anything raises them. */
export const CHANNEL_BASE = { threats: 0.45, players: 0.35, changes: 0.35, things: 0.3, hazards: 0.3, sounds: 0.3, creatures: 0.25 };
type ChannelName = keyof typeof CHANNEL_BASE;
/** A hazard this close is never held back. */
const HAZARD_WITHIN = 3;
/** How pressing each stage of threat is to the thalamus: 0 none, 1 seen, 2 coming or on the body. */
const PRESSING: Record<string, number> = { possible: 1, seen: 1, coming: 2, on_it: 2 };
/** Anything in the threats channel is at least a threat in view: a hostile not yet sized up, or one that is only possible (behind, not looking). */
const IN_VIEW = 1;
/** A sound this fresh is news. */
const NEW_SOUND_MS = 700;

type Near = MinecraftStateData["nearby"];
type Mob = Near["mobs"][number];
const size = (value: unknown) => JSON.stringify(value).length + 1;

/**
 * Sizes remembered from one state to the next. Measuring a form means writing it out as JSON,
 * and a thing's size barely moves between ticks, so each is measured afresh only every few
 * states. One per bot; without one, everything is measured every time.
 */
export interface Sizes {
  /** The size under this key: measured now if it is new or due, else as last measured. */
  of(key: string, measure: () => number): number;
  /** A new state has begun. */
  next(): void;
}
/** A size is measured again after this many states. */
const MEASURE_EVERY = 8;
export function createSizes(): Sizes {
  const known = new Map<string, { size: number; at: number }>();
  let states = 0;
  return {
    of(key, measure) {
      const had = known.get(key);
      if (had && states - had.at < MEASURE_EVERY) return had.size;
      const now = measure();
      known.set(key, { size: now, at: states });
      return now;
    },
    next() {
      states++;
      // Forget what has not been seen for a while.
      if (states % (MEASURE_EVERY * 8) === 0) for (const [key, had] of known) if (states - had.at > MEASURE_EVERY * 2) known.delete(key);
    },
  };
}
const EVERY_TIME: Sizes = { of: (_key, measure) => measure(), next: () => {} };
/** The brief form of a nearby thing: what it is, how far and which way. (A mob keeps the two flags its shape requires.) */
const brief = <T extends { id: string; type: string; dist: number; bearing?: unknown }>(t: T) => ({ id: t.id, type: t.type, dist: t.dist, ...(t.bearing === undefined ? {} : { bearing: t.bearing }) });
const briefMob = (m: Mob): Mob => ({ ...brief(m), hostile: m.hostile, reachable: m.reachable }) as Mob;
const soundId = (h: Near["heard"][number]) => `sound:${h.type}@${h.position.x},${h.position.y},${h.position.z}`;

/** The state as channels of items, with what it costs and how to put a view back together. A state that is not the player's has no channels and is passed whole. */
export function splitState(state: State, sizes: Sizes = EVERY_TIME): Split {
  const data = minecraftDataOf(state);
  if (!data) return { channels: [], fixed: size(state), assemble: () => state };
  sizes.next();
  const full = (id: string, thing: unknown) => sizes.of(`full ${id}`, () => size(thing));
  const short = (id: string, thing: () => unknown) => sizes.of(`brief ${id}`, () => size(thing()));
  const { nearby } = data;
  // The defence circuit's own sizing up (from the state; worked out by the cheap rules if the state carries none).
  const threats = new Map(defenceOf(data).threats.map((t) => [t.id, t]));
  const carried = new Set((data.defence?.threats ?? []).map((t) => t.id));
  const news = new Map(nearby.sudden.map((s) => [s.id, s]));
  const listed = new Set([...nearby.mobs, ...nearby.players, ...nearby.blocks].map((t) => t.id));
  const lists: Record<ChannelName, Item[]> = { threats: [], players: [], changes: [], things: [], hazards: [], sounds: [], creatures: [] };
  const fresh = (id: string) => (news.has(id) ? { fresh: true } : {});
  /** What a thing's full form carries beside its own entry: how the defence sized it up, and that it is news. */
  const extras = (id: string) => (carried.has(id) ? sizes.of(`threat ${id}`, () => size(threats.get(id))) : 0) + (news.has(id) ? size(news.get(id)) : 0);

  for (const m of nearby.mobs) {
    const threat = threats.get(m.id);
    lists[threat || m.hostile ? "threats" : "creatures"].push({ id: m.id, kind: m.type, dist: m.dist, ...fresh(m.id), threat: threat ? (PRESSING[threat.stage] ?? IN_VIEW) : m.hostile ? IN_VIEW : 0, cost: { full: full(m.id, m) + extras(m.id), brief: short(m.id, () => briefMob(m)) } });
  }
  for (const p of nearby.players) lists.players.push({ id: p.id, kind: p.type, dist: p.dist, ...fresh(p.id), cost: { full: full(p.id, p) + extras(p.id), brief: short(p.id, () => brief(p)) } });
  for (const b of nearby.blocks) lists.things.push({ id: b.id, kind: b.type, dist: b.dist, ...fresh(b.id), cost: { full: full(b.id, b) + extras(b.id), brief: short(b.id, () => brief(b)) } });
  for (const h of nearby.hazards) lists.hazards.push({ id: h.id, kind: h.type, dist: h.dist, vital: h.dist <= HAZARD_WITHIN, cost: { full: full(h.id, h), brief: full(h.id, h) } });
  for (const h of nearby.heard) lists.sounds.push({ id: soundId(h), kind: h.type, dist: h.dist, place: placeOfThing(data, h.bearing.angle, h.dist), ...((h.msAgo ?? 0) <= NEW_SOUND_MS ? { fresh: true } : {}), cost: { full: size(h), brief: size(h) } });
  // Things that just changed and are on no list: a projectile, a block placed or broken. Something coming at the body presses.
  for (const s of nearby.sudden) if (!listed.has(s.id)) lists.changes.push({ id: s.id, kind: s.what === "changed" ? "block" : "unknown", dist: s.dist, fresh: true, threat: s.what === "looming" ? 2 : 0, cost: { full: size(s), brief: size(s) } });

  const channels: Channel[] = (Object.keys(CHANNEL_BASE) as ChannelName[]).map((name) => ({ name, base: CHANNEL_BASE[name], items: lists[name] }));
  const emptied = (): MinecraftStateData => ({ ...data, nearby: { hazards: [], mobs: [], blocks: [], players: [], sudden: [], heard: [] }, ...(data.defence ? { defence: { ...data.defence, threats: [] } } : {}) });
  return { channels, fixed: sizes.of("fixed", () => size({ ...state, data: emptied() })), assemble: (forms, note) => assemble(state, data, forms, note) };
}

/** The view: each list with only what was kept, in the form it was given. Nothing is changed; what was held back is counted in `told`. */
function assemble(state: State, data: MinecraftStateData, forms: ReadonlyMap<string, Form>, note: Told): State {
  const { nearby } = data;
  const form = (id: string) => forms.get(id) ?? "counted";
  const kept = <T extends { id: string }>(things: T[], shorten: (t: T) => T): T[] => things.flatMap((t) => (form(t.id) === "full" ? [t] : form(t.id) === "brief" ? [shorten(t)] : []));
  const listed = new Set([...nearby.mobs, ...nearby.players, ...nearby.blocks].map((t) => t.id));
  const view: Near = {
    hazards: kept(nearby.hazards, (h) => h),
    mobs: kept(nearby.mobs, briefMob),
    blocks: kept(nearby.blocks, (b) => brief(b) as typeof b),
    players: kept(nearby.players, (p) => brief(p) as typeof p),
    // That a listed thing is news goes with its full form; a change on no list is its own item.
    sudden: nearby.sudden.filter((s) => (listed.has(s.id) ? form(s.id) === "full" : form(s.id) !== "counted")),
    heard: nearby.heard.filter((h) => form(soundId(h)) !== "counted"),
  };
  const defence = data.defence && { ...data.defence, threats: data.defence.threats.filter((t) => form(t.id) === "full") };
  const told = Object.keys(note.heldBack).length || note.new.length ? { told: { ...(Object.keys(note.heldBack).length ? { heldBack: note.heldBack } : {}), ...(note.new.length ? { new: note.new } : {}) } } : {};
  const out: MinecraftStateData = { ...data, nearby: view, ...(defence ? { defence } : {}), ...told };
  return { ...state, data: { ...out } };
}
