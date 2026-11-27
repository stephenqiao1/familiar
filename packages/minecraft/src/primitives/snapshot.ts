import type { Changes } from "@familiar/contracts";
import type { Bot } from "mineflayer";
import type { Vec3 } from "vec3";
import { countByName } from "../encode/encode-self.js";
import type { Entity } from "../mc-types.js";

/** What a primitive is aimed at, for watching what happens to it. */
export interface Focus {
  block?: Vec3;
  entity?: Entity;
}

/** The parts of the bot and its target worth comparing before and after a movement. */
export interface Snapshot {
  position: { x: number; y: number; z: number };
  /** Radians. */
  yaw: number;
  pitch: number;
  /** Item name → count carried. */
  items: Record<string, number>;
  held: string | null;
  health: number;
  food: number;
  sneaking: boolean;
  /** The open container's type, or null if none is open. */
  window: string | null;
  /** Dropped items lying within a few blocks. */
  drops?: number;
  /** The target block's type (undefined if the movement has no target block). */
  targetBlock?: string | null;
  /** The target block's state (a lever thrown, a door open), as the game numbers it. */
  targetState?: number | null;
  /** The solid blocks straight above the target block, nearest first, "air" for anything else (so a block coming down can be noticed). */
  above?: string[];
  /** Whether the target entity is still there, and how many times it has been seen hurt. */
  targetEntity?: { present: boolean; hurts: number };
}

/** Reads the snapshot now. `hurts`: how many times the target entity has been seen hurt so far. */
export function takeSnapshot(bot: Bot, focus: Focus, hurts = 0): Snapshot {
  const { x, y, z } = bot.entity.position;
  const snapshot: Snapshot = {
    position: { x, y, z },
    yaw: bot.entity.yaw,
    pitch: bot.entity.pitch,
    // With a container open the bot's own items are tracked in that window, not in its inventory.
    items: countByName((bot.currentWindow ?? bot.inventory).items()),
    held: bot.heldItem?.name ?? null,
    health: bot.health,
    food: bot.food,
    sneaking: bot.getControlState("sneak"),
    window: bot.currentWindow ? String(bot.currentWindow.type) : null,
    drops: Object.values(bot.entities).filter((e) => e.name === "item" && e.position.distanceTo(bot.entity.position) <= DROPS_WITHIN).length,
  };
  if (focus.block) {
    const block = bot.blockAt(focus.block);
    snapshot.targetBlock = block?.name ?? null;
    snapshot.targetState = (block as { stateId?: number } | null)?.stateId ?? null;
    snapshot.above = ABOVE.map((dy) => {
      const block = bot.blockAt(focus.block!.offset(0, dy, 0));
      return block?.boundingBox === "block" ? block.name : "air";
    });
  }
  if (focus.entity) snapshot.targetEntity = { present: focus.entity.isValid && bot.entities[focus.entity.id] === focus.entity, hurts };
  return snapshot;
}

/** How far above the target block is watched. */
const ABOVE = [1, 2, 3];
/** Dropped items are counted this close to the bot. */
const DROPS_WITHIN = 5;
/** Smaller differences than these are noise, not change. */
const MOVED_MIN = 0.2;
const TURNED_MIN_DEGREES = 2;

/** What is different between two snapshots. Only what changed is listed; nothing changed gives {}. */
export function changesBetween(before: Snapshot, after: Snapshot): Changes {
  const changes: Changes = {};
  const moved = Math.hypot(after.position.x - before.position.x, after.position.y - before.position.y, after.position.z - before.position.z);
  if (moved >= MOVED_MIN) changes.moved = round(moved);
  const turned = Math.max(angle(after.yaw - before.yaw), Math.abs(after.pitch - before.pitch)) * (180 / Math.PI);
  if (turned >= TURNED_MIN_DEGREES) changes.turned = Math.round(turned);

  const gained: Record<string, number> = {};
  const lost: Record<string, number> = {};
  for (const name of new Set([...Object.keys(before.items), ...Object.keys(after.items)])) {
    const delta = (after.items[name] ?? 0) - (before.items[name] ?? 0);
    if (delta > 0) gained[name] = delta;
    if (delta < 0) lost[name] = -delta;
  }
  if (Object.keys(gained).length) changes.gained = gained;
  if (Object.keys(lost).length) changes.lost = lost;
  if (after.held !== before.held) changes.held = after.held ?? "nothing";

  if (after.targetBlock !== before.targetBlock) {
    changes.targetBlockWas = before.targetBlock ?? "unknown";
    changes.targetBlock = after.targetBlock ?? "unknown";
  }
  // The same block in another state: a lever thrown, a door opened, a crop grown.
  else if (before.targetState != null && after.targetState != null && after.targetState !== before.targetState) changes.targetChanged = true;
  // The target went and the solid block above it left its place: it came down (it may still be in the air).
  const was = before.above?.[0];
  const targetWent = after.targetBlock !== before.targetBlock || after.targetBlock === was;
  if (was !== undefined && was !== "air" && targetWent && before.above!.join() !== after.above?.join()) changes.cameDown = was;
  if (after.health !== before.health) changes.health = round(after.health - before.health);
  if (after.food !== before.food) changes.food = round(after.food - before.food);
  if (before.targetEntity && after.targetEntity) {
    if (after.targetEntity.hurts > before.targetEntity.hurts) changes.targetHurt = true;
    if (before.targetEntity.present && !after.targetEntity.present) changes.targetGone = true;
  }
  // Items that appeared on the ground nearby (a block's drop, something tossed), or were picked up.
  const drops = (after.drops ?? 0) - (before.drops ?? 0);
  if (drops !== 0) changes.drops = drops;
  if (after.sneaking !== before.sneaking) changes.sneaking = after.sneaking;
  if (before.window === null && after.window !== null) changes.opened = after.window;
  if (before.window !== null && after.window === null) changes.closed = before.window;
  return changes;
}

/** The size of a turn in radians, taking the short way round. */
function angle(delta: number): number {
  const wrapped = Math.abs(delta) % (2 * Math.PI);
  return Math.min(wrapped, 2 * Math.PI - wrapped);
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
