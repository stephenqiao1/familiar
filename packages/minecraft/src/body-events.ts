import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import { resetBody } from "./body.js";
import type { LoudEvent } from "./encode/encode-state.js";
import { touchingOf } from "./encode/touching.js";
import type { Hurt } from "./pain.js";

const KEEP_LOUD_MS = 5000;
/** A push faster than this (blocks per tick) is not in blocks per tick: leave it to Mineflayer. */
const MAX_KNOCK = 10;
const MOVE_KEYS = ["forward", "back", "left", "right"] as const;
/** Movement the bot did not command adds up over this long; this much of it is a push. */
const PUSH = { windowMs: 300, blocks: 0.5 };
/** After its own movement stops the body slides a little: that is not a push. */
const SLIDE_MS = 300;
/** The direction of travel is taken over this long; slower than this (blocks) is standing still. */
const MOTION = { windowMs: 150, blocks: 0.05 };

/** A direction across the ground (a unit vector). */
export interface Heading {
  x: number;
  z: number;
}

/** Things the body feels as events, not as state: being hurt, loud bangs, and how it is moving. */
export interface BodyEvents {
  /** The last time the bot was hurt: when, by whom, what kind, where, and what it was touching. Null if never. */
  lastHurt(): Hurt | null;
  /** Explosions heard in the last few seconds. */
  loud(): LoudEvent[];
  /** Movement the bot did not command in the last moment, if it adds up to a push. */
  pushed(): { blocks: number; toward: Heading } | null;
  /** Which way the body is moving across the ground right now, or null if it is still. */
  motion(): Heading | null;
}

/** The game's names for kinds of damage, as each bot's server sent them at login (index = the id damage events carry). */
const damageTypes = new WeakMap<Bot, string[]>();

/**
 * Notes the server's list of damage kinds. It arrives once, while the bot is still logging in,
 * so this must be called as soon as the bot is created.
 */
export function rememberDamageTypes(bot: Bot): void {
  bot._client.on("registry_data", (packet: { id?: string; entries?: { key: string }[] }) => {
    if (String(packet.id).includes("damage_type") && packet.entries) damageTypes.set(bot, packet.entries.map((e) => e.key.replace("minecraft:", "")));
  });
}

/**
 * Listens for the bot being hurt, for explosions and for its own movement, and keeps the body's
 * flags right across a death. `travelling` says whether the locomotion controller is on a journey.
 *
 * The hurt comes from the server's "damage_event" packet, which names the kind of damage and the
 * attacker; Mineflayer's own "entityHurt" passes on only the attacker. Explosions have no public
 * Mineflayer event either, so they are read from the "explosion" packet.
 * TODO(senses): thunder and other loud sounds, once sound names can be trusted.
 */
export function trackBodyEvents(bot: Bot, travelling: () => boolean = () => false): BodyEvents {
  let lastHurt: Hurt | null = null;
  let loud: LoudEvent[] = [];
  let moves: { at: number; dx: number; dz: number; meant: boolean }[] = [];
  let before: Vec3 | null = null;
  let lastMeant = -Infinity;

  bot._client.on("damage_event", (packet: { entityId: number; sourceTypeId: number; sourceCauseId: number }) => {
    if (packet.entityId !== bot.entity?.id) return;
    const { x, y, z } = bot.entity.position.floored();
    // The attacker's id arrives plus one; 0 means there was none (a fall, a cactus, fire).
    const by = packet.sourceCauseId > 0 ? `entity:${packet.sourceCauseId - 1}` : null;
    lastHurt = { at: Date.now(), by, kind: damageTypes.get(bot)?.[packet.sourceTypeId] ?? null, where: { x, y, z }, touching: touchingOf(bot) };
  });
  bot._client.on("explosion", (packet: { center?: { x: number; y: number; z: number } }) => {
    const c = packet.center;
    if (c) loud.push({ type: "explosion", position: new Vec3(c.x, c.y, c.z), at: Date.now() });
  });
  // Being knocked back. On 1.21.11 the server sends the push already in blocks per tick, but
  // Mineflayer still divides it by 8000 (the old packet's scale), so a hit moved the bot nowhere:
  // it could not be shoved at all. This puts the real push back. (It runs after Mineflayer's own handler.)
  bot._client.on("entity_velocity", (packet: { entityId: number; velocity?: { x: number; y: number; z: number } }) => {
    const v = packet.velocity;
    if (packet.entityId !== bot.entity?.id || !v || Math.hypot(v.x, v.y, v.z) > MAX_KNOCK) return;
    bot.entity.velocity.set(v.x, v.y, v.z);
  });
  bot.on("physicsTick", () => {
    const now = Date.now();
    const here = bot.entity.position;
    const meant = travelling() || MOVE_KEYS.some((key) => bot.getControlState(key));
    if (meant) lastMeant = now;
    if (before) moves.push({ at: now, dx: here.x - before.x, dz: here.z - before.z, meant: meant || now - lastMeant < SLIDE_MS });
    before = here.clone();
    moves = moves.filter((m) => now - m.at <= PUSH.windowMs);
  });
  const forget = () => {
    resetBody(bot.entity);
    moves = [];
    before = null;
  };
  bot.on("death", forget);
  bot.on("spawn", forget);
  // A teleport is not movement.
  bot.on("forcedMove", () => {
    moves = [];
    before = null;
  });

  /** The ground covered by the given moves, and which way. */
  const sum = (list: typeof moves) => {
    const [dx, dz] = [list.reduce((s, m) => s + m.dx, 0), list.reduce((s, m) => s + m.dz, 0)];
    const blocks = Math.hypot(dx, dz);
    return { blocks, toward: blocks > 0 ? { x: dx / blocks, z: dz / blocks } : { x: 0, z: 0 } };
  };

  return {
    lastHurt: () => lastHurt,
    loud() {
      loud = loud.filter((e) => Date.now() - e.at <= KEEP_LOUD_MS);
      return loud;
    },
    pushed() {
      const unmeant = sum(moves.filter((m) => !m.meant && Date.now() - m.at <= PUSH.windowMs));
      return unmeant.blocks >= PUSH.blocks ? { blocks: Math.round(unmeant.blocks * 10) / 10, toward: unmeant.toward } : null;
    },
    motion() {
      const recent = sum(moves.filter((m) => Date.now() - m.at <= MOTION.windowMs));
      return recent.blocks >= MOTION.blocks ? recent.toward : null;
    },
  };
}
