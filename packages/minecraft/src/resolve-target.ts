import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import { neighbour } from "./facing.js";
import { findBlockNear } from "./find-nearby.js";
import type { Block, Entity } from "./mc-types.js";
import type { Target } from "./target.js";

export type ResolvedTarget =
  | { kind: "block"; block: Block }
  | { kind: "entity"; entity: Entity }
  | { kind: "position"; position: Vec3 }
  /** An item by name (it need not be carried). */
  | { kind: "item"; name: string };

const NEAREST_BLOCK_RANGE = 64;
/** How far the bot's arm reaches, in blocks. */
export const REACH = 4;

/** Finds what a target points at right now, or null if it isn't there (or isn't loaded, or is out of reach). */
export function resolveTarget(bot: Bot, target: Target): ResolvedTarget | null {
  switch (target.kind) {
    case "nearest": {
      if (bot.registry.blocksByName[target.name]) {
        const pos = findBlockNear(bot, (name) => name === target.name, NEAREST_BLOCK_RANGE);
        const block = pos && bot.blockAt(pos);
        return block ? { kind: "block", block } : null;
      }
      const entity = bot.nearestEntity((e) => e.name === target.name);
      return entity && { kind: "entity", entity };
    }
    case "pos":
      return { kind: "position", position: new Vec3(target.x, target.y, target.z) };
    case "entity": {
      const entity = bot.entities[target.id];
      return entity ? { kind: "entity", entity } : null;
    }
    case "player": {
      const entity = bot.players[target.username]?.entity;
      return entity ? { kind: "entity", entity } : null;
    }
    case "ahead":
      return lookedAt(bot);
    case "dir": {
      const position = neighbour(bot.entity, target.dir);
      const block = bot.blockAt(position);
      return block && block.boundingBox !== "empty" ? { kind: "block", block } : { kind: "position", position };
    }
    case "held":
      return bot.heldItem ? { kind: "item", name: bot.heldItem.name } : null;
    case "item":
      return bot.registry.itemsByName[target.name] ? { kind: "item", name: target.name } : null;
  }
}

/** The entity or block the bot is looking at within reach (the entity, if it is in front of the block). */
function lookedAt(bot: Bot): ResolvedTarget | null {
  const eye = bot.entity.position.offset(0, bot.entity.height, 0);
  const entity = bot.entityAtCursor(REACH);
  const block = bot.blockAtCursor(REACH);
  if (entity && (!block || entity.position.distanceTo(eye) <= block.position.offset(0.5, 0.5, 0.5).distanceTo(eye))) return { kind: "entity", entity };
  return block ? { kind: "block", block } : null;
}
