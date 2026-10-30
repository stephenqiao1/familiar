import type { Vec3 } from "vec3";

/** The parts of a mineflayer Bot the encoder reads. A real Bot satisfies this; tests use a fake. */
export interface EncodableBot {
  health: number;
  food: number;
  heldItem: { name: string } | null;
  entity: { id: number; position: Vec3 };
  time: { isDay: boolean };
  inventory: { items(): EncodableItem[] };
  entities: Record<string, EncodableEntity>;
  registry: {
    blocksArray: { name: string; minStateId: number; maxStateId: number }[];
    foodsByName: Record<string, { foodPoints: number; saturation: number } | undefined>;
  };
  blockAt(pos: Vec3): EncodableBlock | null;
  world: { getBlockStateId(pos: Vec3): number | undefined };
}

export interface EncodableItem {
  name: string;
  count: number;
  slot: number;
  durabilityUsed: number;
  maxDurability: number;
}

export interface EncodableBlock {
  name: string;
  boundingBox: string;
  light: number;
  skyLight: number;
}

export interface EncodableEntity {
  id: number;
  name?: string | undefined;
  type: string;
  position: Vec3;
}
