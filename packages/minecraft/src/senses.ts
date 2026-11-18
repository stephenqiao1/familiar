import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";

// What the eyes and ears pick up as events, between one state and the next: how each nearby
// thing is moving, things that appear or start to move, blocks that change, and sounds.
//
// Sounds. On 1.21.11 Mineflayer names sounds wrongly (a cow's hurt arrives as "coral_block.step"),
// so no sound is ever told apart by name. What does arrive reliably is used instead: where a
// sound came from, its category and its volume; an explosion's centre; a lightning bolt
// appearing; something being hurt; a door, gate or trapdoor changing; a projectile appearing.
// Left out: which creature made a sound, footsteps as such, chest lids, note blocks.

/** A sound, as it was heard. */
export interface HeardEvent {
  /** "explosion", "thunder", "hurt", "door", "shot", or "sound" for anything else. */
  type: string;
  position: Vec3;
  /** How loud at its source, 0 to 1 (before distance is allowed for). */
  loudness: number;
  at: number;
}

/** What the state encoder asks of the senses. */
export interface Senses {
  /** How fast an entity is moving toward the bot by its own movement, in blocks per second (negative: away). */
  closing(entityId: number): number;
  /** How fast an entity is moving at all, in blocks per second. */
  speed(entityId: number): number;
  /** When an entity was first noticed, or null if not tracked. */
  appearedAt(entityId: number): number | null;
  /** When an entity last went from still to moving, or null. */
  startedMovingAt(entityId: number): number | null;
  /** Things that are not creatures, players, projectiles or dropped items that appeared in the last moment (a lit explosive, a falling block). */
  appearedOthers(now: number): { id: number; position: Vec3 }[];
  /** Projectiles that appeared lately heading the bot's way. */
  incoming(now: number): { id: number; position: Vec3 }[];
  /** Blocks close by that were placed, broken, opened or shut lately. */
  changed(now: number): { position: Vec3; at: number }[];
  /** Sounds heard lately, oldest first. */
  heard(now: number): HeardEvent[];
}

const TRACK_WITHIN = 32;
/** Entities are sampled every this many game ticks (a quarter of a second). */
const SAMPLE_TICKS = 5;
const MOVING = { above: 1, stillFor: 1000 };
const KEEP_MS = { heard: 2000, changed: 1000, incoming: 1500 };
const CHANGED_WITHIN = 8;
/** A projectile is coming this way if its path passes this close. */
const PASSES_WITHIN = 2.5;
const OWN_SOUND_WITHIN = 1.5;
const JUST_APPEARED_MS = 700;
/** "Other" entities that are not things to turn to. */
const NOT_THINGS = new Set(["item", "experience_orb", "lightning_bolt", "area_effect_cloud", "marker", "item_display", "block_display", "text_display", "interaction"]);
const LOUD: Record<string, number> = { explosion: 1, thunder: 1, shot: 0.5, hurt: 0.45, door: 0.4 };
const SOUND_SCALE = 0.4;
const OPENS = /door|gate/;

interface Track {
  at: Vec3;
  when: number;
  closing: number;
  speed: number;
  appeared: number;
  stillSince: number | null;
  started: number | null;
}

/** Starts listening and watching. One per bot. */
export function trackSenses(bot: Bot): Senses {
  const tracks = new Map<number, Track>();
  let heard: HeardEvent[] = [];
  let changed: { position: Vec3; at: number }[] = [];
  let incoming: { id: number; position: Vec3; at: number }[] = [];
  let ticks = 0;
  const me = () => bot.entity.position;
  const hear = (type: string, position: Vec3, loudness = LOUD[type] ?? SOUND_SCALE) => {
    if (position.distanceTo(me()) > OWN_SOUND_WITHIN) heard.push({ type, position, loudness, at: Date.now() });
  };

  bot.on("physicsTick", () => {
    if (++ticks % SAMPLE_TICKS !== 0) return;
    const now = Date.now();
    for (const e of Object.values(bot.entities)) {
      if (e === bot.entity || e.position.distanceTo(me()) > TRACK_WITHIN) continue;
      const was = tracks.get(e.id);
      if (!was) {
        tracks.set(e.id, { at: e.position.clone(), when: now, closing: 0, speed: 0, appeared: now, stillSince: now, started: null });
        continue;
      }
      const seconds = Math.max(0.05, (now - was.when) / 1000);
      const moved = e.position.minus(was.at);
      const toMe = me().minus(was.at);
      const far = Math.hypot(toMe.x, toMe.y, toMe.z) || 1;
      // Only the thing's own movement counts: walking up to a still cow does not make the cow close in.
      const closing = (moved.x * toMe.x + moved.y * toMe.y + moved.z * toMe.z) / far / seconds;
      const speed = Math.hypot(moved.x, moved.y, moved.z) / seconds;
      const moving = speed > MOVING.above;
      const started = moving && was.stillSince !== null && now - was.stillSince >= MOVING.stillFor ? now : was.started;
      tracks.set(e.id, { at: e.position.clone(), when: now, closing: (was.closing + closing) / 2, speed: (was.speed + speed) / 2, appeared: was.appeared, stillSince: moving ? null : (was.stillSince ?? now), started });
    }
    for (const id of tracks.keys()) if (!bot.entities[id]) tracks.delete(id);
    heard = heard.filter((h) => now - h.at <= KEEP_MS.heard);
    changed = changed.filter((c) => now - c.at <= KEEP_MS.changed);
    incoming = incoming.filter((p) => now - p.at <= KEEP_MS.incoming && bot.entities[p.id]);
  });

  bot._client.on("explosion", (packet: { center?: { x: number; y: number; z: number } }) => {
    if (packet.center) hear("explosion", new Vec3(packet.center.x, packet.center.y, packet.center.z));
  });
  bot._client.on("sound_effect", (packet: { x: number; y: number; z: number; volume?: number }) => {
    // Positions arrive in eighths of a block.
    hear("sound", new Vec3(packet.x / 8, packet.y / 8, packet.z / 8), Math.min(1, (packet.volume ?? 1) * SOUND_SCALE));
  });
  bot.on("entitySpawn", (e) => {
    if (e.name === "lightning_bolt") hear("thunder", e.position.clone());
  });
  // A projectile appearing. Its speed is read from the server's own packet: on 1.21.11 Mineflayer
  // divides it by 8000 (the old packet's scale), so every arrow looked as if it were standing still.
  // (This runs after Mineflayer's own handler, so the entity is already known.)
  bot._client.on("spawn_entity", (packet: { entityId: number; velocity?: { x: number; y: number; z: number } }) => {
    const e = bot.entities[packet.entityId];
    if (!e || e.type !== "projectile") return;
    hear("shot", e.position.clone());
    const velocity = packet.velocity ?? e.velocity;
    if (headingFor(e.position, velocity, me().offset(0, 1, 0))) incoming.push({ id: e.id, position: e.position.clone(), at: Date.now() });
  });
  bot.on("entityHurt", (e) => {
    if (e !== bot.entity) hear("hurt", e.position.clone());
  });
  bot.on("blockUpdate", (before, after) => {
    if (!before || !after || after.position.distanceTo(me()) > CHANGED_WITHIN) return;
    const swung = OPENS.test(after.name) && before.name === after.name && before.getProperties().open !== after.getProperties().open;
    if (swung) hear("door", after.position.offset(0.5, 0.5, 0.5));
    if (swung || (before.boundingBox === "block") !== (after.boundingBox === "block")) changed.push({ position: after.position.clone(), at: Date.now() });
  });
  const forget = () => {
    tracks.clear();
    heard = [];
    changed = [];
    incoming = [];
  };
  bot.on("death", forget);
  bot.on("forcedMove", () => tracks.clear());

  return {
    closing: (id) => Math.round((tracks.get(id)?.closing ?? 0) * 10) / 10 || 0,
    speed: (id) => Math.round((tracks.get(id)?.speed ?? 0) * 10) / 10,
    appearedAt: (id) => tracks.get(id)?.appeared ?? null,
    startedMovingAt: (id) => tracks.get(id)?.started ?? null,
    appearedOthers: (now) =>
      Object.values(bot.entities).flatMap((e) => {
        const appeared = tracks.get(e.id)?.appeared;
        return e.type === "other" && !NOT_THINGS.has(e.name ?? "") && appeared !== undefined && now - appeared <= JUST_APPEARED_MS ? [{ id: e.id, position: e.position.clone() }] : [];
      }),
    incoming: (now) => incoming.filter((p) => now - p.at <= KEEP_MS.incoming),
    changed: (now) => changed.filter((c) => now - c.at <= KEEP_MS.changed),
    heard: (now) => heard.filter((h) => now - h.at <= KEEP_MS.heard),
  };
}

/** Whether something at `from` moving with `velocity` is heading for `target`: moving toward it, on a path that passes close. */
export function headingFor(from: Vec3, velocity: { x: number; y: number; z: number }, target: Vec3): boolean {
  const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
  if (speed < 0.05) return false;
  const to = target.minus(from);
  const along = (to.x * velocity.x + to.y * velocity.y + to.z * velocity.z) / speed;
  if (along <= 0) return false;
  const miss = Math.sqrt(Math.max(0, to.x * to.x + to.y * to.y + to.z * to.z - along * along));
  return miss <= PASSES_WITHIN;
}
