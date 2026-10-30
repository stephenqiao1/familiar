import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import { findBlockNear } from "./find-nearby.js";
import type { Block, Entity } from "./mc-types.js";
import type { Target } from "./target.js";

export type ResolvedTarget =
  | { kind: "block"; block: Block }
  | { kind: "entity"; entity: Entity }
  | { kind: "position"; position: Vec3 };

const NEAREST_BLOCK_RANGE = 64;

/** Finds what a target points at right now, or null if it isn't there (or isn't loaded). */
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
  }
}
