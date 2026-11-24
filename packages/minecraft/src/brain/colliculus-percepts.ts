import { fieldOf, leanOf, type Features, type Lean, type Percept } from "@familiar/region-brainstem";
import type { MinecraftStateData } from "../encode/state-data.js";
import { sightedOf } from "./read-state.js";

// The player's colliculus settings: how what it sees, hears and feels becomes the physical
// features the map scores. Every number is a first guess to tune in play.

/** What the map is told about one thing. Physical facts only: nothing here says what the thing is. */
export interface Physical {
  /** Blocks away. */
  dist: number;
  /** Degrees from straight ahead. */
  angle: number;
  /** Degrees above (positive) or below eye level. */
  elevation: number;
  /** How big it looks: the degrees its height takes up in the view. */
  size: number;
  /** How fast it is coming nearer, in blocks per second. */
  closing: number;
  /** How fast it is moving at all, in blocks per second. */
  speed: number;
  /** It just appeared, started moving or changed. */
  sudden: boolean;
  /** A projectile heading this way. */
  incoming: boolean;
  /** How loud it is here, 0 to 1 (0 for something only seen). */
  loudness: number;
  /** It just hurt or pushed the bot. */
  touch: boolean;
}

/** Nearness fades to nothing at this distance. */
const NEAR_WITHIN = 16;
/** Closing this fast (blocks per second) is full looming; under `from` it is none. */
const LOOMING = { from: 4, full: 8 };
/** Moving this fast across the view is full motion; in the sharp middle of the view it counts for less. */
const MOTION = { from: 0.5, full: 4, central: 0.6, centralWithin: 30 };
/** A hurt this fresh is touch. */
const TOUCH_MS = 700;
/** Places are told apart this coarsely when getting used to a kind of thing somewhere. */
const PLACE_BLOCKS = 8;
/** Full light, as the state counts it. */
const FULL_LIGHT = 15;
const clamp = (n: number) => Math.min(1, Math.max(0, n));

/** How big something `height` blocks tall looks from `dist` blocks away, in degrees. */
export function apparentSize(height: number, dist: number): number {
  return Math.round((2 * Math.atan2(height / 2, Math.max(0.5, dist)) * 180) / Math.PI);
}

/** The features of one thing, from physical facts alone. */
export function featuresOf(p: Physical): Features {
  const motion = p.speed >= MOTION.from ? clamp(p.speed / MOTION.full) * (Math.abs(p.angle) <= MOTION.centralWithin ? MOTION.central : 1) : 0;
  return {
    suddenness: p.sudden ? 1 : 0,
    motion,
    looming: p.incoming ? 1 : p.closing >= LOOMING.from ? clamp(0.5 + (0.5 * (p.closing - LOOMING.from)) / (LOOMING.full - LOOMING.from)) : 0,
    nearness: clamp(1 - p.dist / NEAR_WITHIN),
    loudness: clamp(p.loudness),
    touch: p.touch ? 1 : 0,
  };
}

/** Roughly where something lies, from the bot's place, its heading and the thing's bearing. */
export function placeOfThing(data: MinecraftStateData, angle: number, dist: number): string {
  const heading = ((data.self.gaze.yaw + angle) * Math.PI) / 180;
  const { x, z } = data.self.position;
  return `${Math.round((x - Math.sin(heading) * dist) / PLACE_BLOCKS)},${Math.round((z - Math.cos(heading) * dist) / PLACE_BLOCKS)}`;
}

/** Everything seen, heard and felt, as the map takes it. `newSounds` says which sounds were not there last tick. */
export function perceptsOf(data: MinecraftStateData, isNewSound: (key: string) => boolean = () => true, own: (id: string) => boolean = () => false): Percept[] {
  const { nearby, self } = data;
  const sudden = new Map(nearby.sudden.map((s) => [s.id, s]));
  const percepts: Percept[] = [];
  const still: Physical = { dist: 0, angle: 0, elevation: 0, size: 0, closing: 0, speed: 0, sudden: false, incoming: false, loudness: 0, touch: false };

  // Sight: only what the eyes can see.
  const listed = new Set<string>();
  for (const thing of [...nearby.mobs, ...nearby.players, ...nearby.blocks]) {
    const sight = sightedOf(thing);
    if (!sight.seen) continue;
    listed.add(thing.id);
    const event = sudden.get(thing.id);
    const speed = sight.speed ?? Math.abs(sight.closing);
    const size = sight.height === undefined ? 0 : apparentSize(sight.height, thing.dist);
    const features = featuresOf({ ...still, dist: thing.dist, angle: sight.bearing.angle, elevation: sight.elevation ?? 0, size, closing: sight.closing, speed, sudden: event !== undefined && event.what !== "looming" });
    // Where it is on the map, how well lit, and the plain facts the lean goes by: nothing here says what it is.
    const map = { angle: sight.bearing.angle, elevation: sight.elevation ?? 0, ...(sight.light === undefined ? {} : { light: sight.light / FULL_LIGHT }), shape: { dist: thing.dist, across: Math.sqrt(Math.max(0, speed * speed - sight.closing * sight.closing)), closing: sight.closing, ...(sight.height === undefined ? {} : { height: sight.height, size }) } };
    percepts.push({ id: thing.id, kind: thing.type, place: placeOfThing(data, sight.bearing.angle, thing.dist), bearing: sight.bearing.side, via: "sight", features, fresh: event !== undefined && event.what !== "appeared", ...map, ...(event?.what === "changed" && own(thing.id) ? { own: true } : {}) });
  }
  // Sudden things that are not on those lists: a projectile, a block that changed.
  for (const event of nearby.sudden) {
    if (listed.has(event.id)) continue;
    const features = featuresOf({ ...still, dist: event.dist, angle: event.bearing.angle, sudden: event.what !== "looming", incoming: event.what === "looming" });
    const loomingIn = event.what === "looming";
    percepts.push({ id: event.id, kind: event.what === "changed" ? "block" : "unknown", bearing: event.bearing.side, via: "sight", features, fresh: true, angle: event.bearing.angle, elevation: event.elevation ?? 0, ...(loomingIn ? { shape: { dist: event.dist, across: 0, closing: LOOMING.full } } : {}), ...(own(event.id) ? { own: true } : {}) });
  }
  // Sound: where it came from.
  for (const sound of nearby.heard) {
    const id = `pos:${sound.position.x},${sound.position.y},${sound.position.z}`;
    const fresh = isNewSound(`${sound.type} ${id}`);
    const features = featuresOf({ ...still, dist: sound.dist, angle: sound.bearing.angle, sudden: fresh, loudness: sound.loudness });
    percepts.push({ id, kind: sound.type, place: placeOfThing(data, sound.bearing.angle, sound.dist), bearing: sound.bearing.side, via: "sound", features, fresh: fresh && sound.type !== "presence", ...(own(id) ? { own: true } : {}) });
  }
  // Touch: whatever just hurt the bot, or the way a push came from.
  const hurt = self.lastHurt;
  if (hurt && hurt.msAgo <= TOUCH_MS) {
    const by = hurt.by === null ? null : [...nearby.mobs, ...nearby.players].find((t) => t.id === hurt.by);
    percepts.push({ id: hurt.by ?? `pos:${hurt.at.x},${hurt.at.y},${hurt.at.z}`, kind: by?.type ?? "unknown", bearing: by ? sightedOf(by).bearing.side : "ahead", via: "touch", features: featuresOf({ ...still, touch: true }), fresh: true });
  } else if (self.pushed) {
    const { x, y, z } = self.position;
    const from = `pos:${Math.round(x - self.pushed.toward.x * 2)},${y + 1},${Math.round(z - self.pushed.toward.z * 2)}`;
    percepts.push({ id: from, kind: "unknown", bearing: "behind", via: "touch", features: featuresOf({ ...still, touch: true }), fresh: true });
  }
  return percepts;
}

/**
 * The lean one seen thing gives this very tick, by the colliculus's own table (lean.ts), from
 * the state alone. For the defence reflexes, which run before the colliculus and so see its
 * `attended` a tick late: a dive is over in a few ticks. Never "approach" (that is not theirs).
 */
export function leanFromState(data: MinecraftStateData, id: string): Lean | null {
  const seen = perceptsOf(data).find((p) => p.id === id && p.via === "sight");
  if (!seen?.shape) return null;
  return leanOf({ ...seen.shape, field: fieldOf(seen.elevation ?? 0), looming: seen.features.looming, safetyPresses: true });
}
