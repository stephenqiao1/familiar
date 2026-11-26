import type { State } from "@familiar/contracts";
import type { CellNow } from "@familiar/memory";
import { minecraftDataOf } from "./read-state.js";

// What a map cell is for a Minecraft player, and what ends an area. The hippocampus's map
// (packages/memory) only sees cell names. Change the size of a cell here. Every number is a first guess.

/** A cell is a cube this many blocks on a side, per dimension. */
export const CELL_BLOCKS = 8;
/**
 * Sky light at or above this is "open" (under the sky); below it "covered" (a cave, a roofed
 * house). A spot with a roof and walls close round it (`enclosed`) is covered whatever the light
 * says: on 1.21.11 this client can go on reading full sky light under a roof built after it joined.
 */
const OPEN_SKY_LIGHT = 8;
/** A door heard this close as the bot changes cell is a door it came through. */
const DOOR_WITHIN = 4;
/** A climb: this many blocks up or down in the last few seconds, steeper than this (across ÷ up). */
const CLIMB = { blocks: 3, overMs: 4000, steeperThan: 1.5 };

export const cellKey = (dimension: string, at: { x: number; y: number; z: number }, size = CELL_BLOCKS) =>
  `${dimension}:${Math.floor(at.x / size)},${Math.floor(at.y / size)},${Math.floor(at.z / size)}`;
/** The dimension a cell is in. */
export const dimensionOf = (key: string) => key.slice(0, key.lastIndexOf(":"));

export interface CellReader {
  /** The cell the bot is in: its name, where the bot stands, open or covered, and what is in view. */
  cellOf(state: State): CellNow | null;
  /** What the bot came through between two ticks: a door or a climb, or null. Keeps a few seconds of positions, so call it every tick. */
  barrier(before: State, after: State): string | null;
}

export function createCellReader(size = CELL_BLOCKS): CellReader {
  let steps: { at: number; x: number; y: number; z: number }[] = [];
  return {
    cellOf(state) {
      const data = minecraftDataOf(state);
      if (!data) return null;
      const { self, nearby } = data;
      const seen: Record<string, number> = {};
      for (const kind of [...nearby.mobs.map((m) => m.type), ...nearby.blocks.map((b) => b.type), ...nearby.players.map(() => "player")]) seen[kind] = (seen[kind] ?? 0) + 1;
      return { key: cellKey(self.dimension, self.position, size), spot: { ...self.position }, setting: self.skyLight >= OPEN_SKY_LIGHT && !self.enclosed ? "open" : "covered", seen };
    },
    barrier(before, after) {
      const [a, b] = [minecraftDataOf(before), minecraftDataOf(after)];
      if (!a || !b) return null;
      const now = after.timestamp;
      steps = [...steps.filter((s) => now - s.at <= CLIMB.overMs), { at: now, ...b.self.position }];
      if (cellKey(a.self.dimension, a.self.position, size) === cellKey(b.self.dimension, b.self.position, size)) return null;
      if (b.nearby.heard.some((h) => h.type === "door" && h.dist <= DOOR_WITHIN)) return "door";
      const from = steps[0]!;
      const up = Math.abs(b.self.position.y - from.y);
      const across = Math.hypot(b.self.position.x - from.x, b.self.position.z - from.z);
      return up >= CLIMB.blocks && across < up * CLIMB.steeperThan ? "climb" : null;
    },
  };
}
