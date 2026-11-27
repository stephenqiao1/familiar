import type { State } from "@familiar/contracts";
import type { CellNow } from "@familiar/memory";
import type { MinecraftStateData } from "../encode/state-data.js";
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

/** The part of the day what is usual in a place is kept for: by day and by night different things are about. */
export const dayOrNight = (time: MinecraftStateData["time"]) => (time.isNight ? "night" : "day");

/**
 * The things that just changed in view, other than by appearing: which thing, its kind (a block
 * that changed and is not one of the listed things is a "block"), and what changed.
 */
export function changesIn(data: MinecraftStateData): { id: string; kind: string; what: string }[] {
  const { mobs, blocks, players, sudden } = data.nearby;
  const kindOf = new Map([...mobs, ...blocks].map((t) => [t.id, t.type] as const));
  for (const p of players) kindOf.set(p.id, "player");
  return sudden.filter((s) => s.what !== "appeared").map((s) => ({ id: s.id, kind: kindOf.get(s.id) ?? "block", what: s.what }));
}

/** The things in a state as the map counts them: creatures, useful blocks and players, each with its kind. */
export function thingsCounted(data: MinecraftStateData): { id: string; kind: string }[] {
  const { mobs, blocks, players } = data.nearby;
  return [...mobs.map((m) => ({ id: m.id, kind: m.type })), ...blocks.map((b) => ({ id: b.id, kind: b.type })), ...players.map((p) => ({ id: p.id, kind: "player" }))];
}

/** What the sensory area needs from the player: the things in its view, what just changed, and the part of the day, in the map's own terms. */
export function playerSensory(): { thingsOf(view: State): { id: string; kind: string }[] | null; changesOf(view: State): { id: string; kind: string; what: string }[]; bandOf(view: State): string | null } {
  const data = (view: State) => minecraftDataOf(view);
  return {
    thingsOf: (view) => ((d) => d && thingsCounted(d))(data(view)),
    changesOf: (view) => ((d) => (d ? changesIn(d) : []))(data(view)),
    bandOf: (view) => ((d) => d && dayOrNight(d.time))(data(view)),
  };
}

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
      const { self } = data;
      const seen: Record<string, number> = {};
      for (const { kind } of thingsCounted(data)) seen[kind] = (seen[kind] ?? 0) + 1;
      return { key: cellKey(self.dimension, self.position, size), spot: { ...self.position }, setting: self.skyLight >= OPEN_SKY_LIGHT && !self.enclosed ? "open" : "covered", seen, band: dayOrNight(data.time), changes: changesIn(data).map((c) => `${c.kind}:${c.what}`) };
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
