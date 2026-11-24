import { Vec3 } from "vec3";
import type { Senses } from "../senses.js";
import { bearingOf, elevationOf, eyesOf, FIELD, lightAt, sightOf, type Bearing } from "./bearing.js";
import type { EncodableBot } from "./encodable-bot.js";
import { posId } from "./scan-blocks.js";
import type { MinecraftStateData, Nearby, Sighted } from "./state-data.js";

// What the eyes and ears add to the state: for each nearby thing its bearing, whether it is seen
// and how fast it is closing; the things that just changed in view; the sounds heard; and what
// the head is pointed at.

type Near = MinecraftStateData["nearby"];
/** Closing faster than this (blocks per second) is looming. */
export const LOOMING_ABOVE = 4;
/** An event stays "just happened" for this long. */
const JUST_MS = 700;
/** Sounds carry this far; the loud ones further. */
const HEARD_WITHIN = { ordinary: 32, loud: 64 };
/** An unseen hostile this close is "heard" (see `unseenHostileHeard`). */
const PRESENCE = { within: 8, loudness: 0.2 };
/** The head is pointed at the nearest seen thing within this many degrees of straight ahead. */
const GAZE_WITHIN = 12;
const NO_SENSES: Senses = { closing: () => 0, speed: () => 0, appearedOthers: () => [], appearedAt: () => null, startedMovingAt: () => null, incoming: () => [], changed: () => [], heard: () => [] };

/** Where the thing an id names is: an entity's middle, or the middle of a block. Null if it is gone. */
export function positionOf(bot: EncodableBot, id: string): Vec3 | null {
  if (id.startsWith("entity:")) {
    const e = bot.entities[id.slice(7)];
    return e ? e.position.offset(0, (e.height ?? 1) / 2, 0) : null;
  }
  const [x, y, z] = id.replace("pos:", "").split(",").map(Number);
  return [x, y, z].every((n) => Number.isFinite(n)) ? new Vec3(x! + 0.5, y! + 0.5, z! + 0.5) : null;
}

/** Adds to a nearby thing its bearing, whether it is seen, and how fast it is closing. */
export function sighted<T extends Nearby>(bot: EncodableBot, thing: T, senses: Senses = NO_SENSES): T & Sighted {
  const at = positionOf(bot, thing.id);
  const { bearing, seen } = at ? sightOf(bot, at) : { bearing: { side: "ahead" as const, angle: 0 }, seen: false };
  const entity = thing.id.startsWith("entity:") ? Number(thing.id.slice(7)) : null;
  const speed = entity === null ? 0 : senses.speed(entity);
  // Up and down, how tall, and how well lit: physical facts for the map (nothing here says what the thing is).
  const place = at ? { elevation: elevationOf(eyesOf(bot), at), height: entity === null ? 1 : (bot.entities[String(entity)]?.height ?? 1), light: lightAt(bot, at) } : {};
  return { ...thing, bearing, seen, closing: entity === null ? 0 : senses.closing(entity), ...(speed > 0 ? { speed } : {}), ...place };
}

/**
 * The things that just changed in view: one that appeared, one that started moving, a block that
 * was placed, broken, opened or shut, and anything looming (closing fast, or a projectile heading
 * this way). Only what the eyes can see counts.
 */
export function suddenThings(bot: EncodableBot, things: (Nearby & Sighted)[], senses: Senses, now: number): Near["sudden"] {
  const sudden: Near["sudden"] = [];
  const just = (at: number | null) => at !== null && now - at <= JUST_MS;
  for (const t of things) {
    if (!t.seen || !t.id.startsWith("entity:")) continue;
    const id = Number(t.id.slice(7));
    const what = t.closing >= LOOMING_ABOVE ? "looming" : just(senses.startedMovingAt(id)) ? "started_moving" : just(senses.appearedAt(id)) ? "appeared" : null;
    if (what) sudden.push({ id: t.id, what, bearing: t.bearing, dist: t.dist, ...(t.elevation === undefined ? {} : { elevation: t.elevation }) });
  }
  const me = bot.entity.position;
  const eyes = eyesOf(bot);
  for (const p of senses.incoming(now)) {
    const at = bot.entities[String(p.id)]?.position ?? p.position;
    const { bearing, seen } = sightOf(bot, at);
    if (seen && !sudden.some((s) => s.id === `entity:${p.id}`)) sudden.push({ id: `entity:${p.id}`, what: "looming", bearing, dist: Math.round(at.distanceTo(me)), elevation: elevationOf(eyes, at) });
  }
  // Things that are not creatures, players or projectiles (a lit explosive, a falling block): seen appearing, not known for what they are.
  for (const o of senses.appearedOthers(now)) {
    const { bearing, seen } = sightOf(bot, o.position);
    if (seen) sudden.push({ id: `entity:${o.id}`, what: "appeared", bearing, dist: Math.round(o.position.distanceTo(me)), elevation: elevationOf(eyes, o.position) });
  }
  for (const c of senses.changed(now)) {
    const { bearing, seen } = sightOf(bot, c.position.offset(0.5, 0.5, 0.5));
    if (seen && !sudden.some((s) => s.id === posId(c.position))) sudden.push({ id: posId(c.position), what: "changed", bearing, dist: Math.round(c.position.distanceTo(me)), elevation: elevationOf(eyes, c.position.offset(0.5, 0.5, 0.5)) });
  }
  return sudden;
}

/**
 * STAND-IN FOR HEARING. The game does not deliver footsteps or growls in a form that can be
 * trusted, so a hostile mob within 8 blocks that is not seen counts as heard, faintly, with its
 * bearing. This is the one place where what a thing is leaks into the senses. Replace it when
 * real sounds are available.
 */
export function unseenHostileHeard(mobs: Near["mobs"], positionOfMob: (id: string) => Vec3 | null): Near["heard"] {
  return mobs
    .filter((m) => m.hostile && m.seen === false && m.dist <= PRESENCE.within)
    .flatMap((m) => {
      const at = positionOfMob(m.id);
      return at && m.bearing ? [{ type: "presence", bearing: m.bearing, dist: m.dist, position: whole(at), loudness: PRESENCE.loudness }] : [];
    });
}

/** The sounds heard lately: where each came from, and how loud it is here. */
export function heardThings(bot: EncodableBot, senses: Senses, now: number): Near["heard"] {
  const me = bot.entity.position;
  return senses.heard(now).flatMap((h) => {
    const dist = h.position.distanceTo(me);
    const reach = h.loudness >= 1 ? HEARD_WITHIN.loud : HEARD_WITHIN.ordinary;
    if (dist > reach) return [];
    const loudness = Math.round(h.loudness * (1 - (dist / reach) * 0.7) * 100) / 100;
    return [{ type: h.type, bearing: bearingOf(me, bot.entity.yaw ?? 0, h.position), dist: Math.round(dist), position: whole(h.position), loudness, msAgo: Math.max(0, now - h.at) }];
  });
}

/** What the head is pointed at: the nearest seen thing close to straight ahead (or nothing), and the compass heading in degrees. */
export function gazeOf(bot: EncodableBot, things: (Nearby & Sighted)[]): MinecraftStateData["self"]["gaze"] {
  const ahead = things.filter((t) => t.seen && Math.abs(t.bearing.angle) <= GAZE_WITHIN).sort((a, b) => a.dist - b.dist)[0];
  const degrees = Math.round((((bot.entity.yaw ?? 0) * 180) / Math.PI) % 360);
  const pitch = Math.round(((bot.entity.pitch ?? 0) * 180) / Math.PI) || 0;
  return { id: ahead?.id ?? null, yaw: (degrees + 360) % 360, pitch };
}

/** Whether a bearing is in the sharp middle of the view. */
export function isCentral(bearing: Bearing): boolean {
  return Math.abs(bearing.angle) <= FIELD.central;
}

const whole = (p: Vec3) => ({ x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) });
