/** What a schemaVersion 9 Minecraft State carries in `data`. Distances are whole blocks. */
export interface MinecraftStateData {
  time: { isNight: boolean; lightLevel: number };
  self: {
    /** Whole-block position. */
    position: { x: number; y: number; z: number };
    dimension: string;
    health: number;
    food: number;
    heldItem: string | null;
    /** Best weapon carried (sword > axe > pickaxe), or null for bare hands. */
    bestWeapon: string | null;
    inventoryFullPct: number;
    foodItems: number;
    /** Item name → total count carried. */
    inventory: Record<string, number>;
    distanceToBase: number;
    /** The biome the bot stands in, or null if unknown. */
    biome: string | null;
    /** Sky light where the bot stands (0 = no view of the sky, e.g. underground). */
    skyLight: number;
    /** Sheltered: a roof overhead and a wall on at least three sides, each within 6 blocks. */
    enclosed: boolean;
    /** In bed, asleep. */
    asleep: boolean;
    /** Times the bot has died since it joined. */
    deaths: number;
  };
  nearby: {
    hazards: Nearby[];
    mobs: (Nearby & { hostile: boolean })[];
    /** Chests, ripe crops and bells within 16 blocks. */
    blocks: Nearby[];
    /** Other players within 24 blocks (`type` is "player"). */
    players: Nearby[];
  };
  /** How this place feels from memory (the strongest good or bad memory close by), or null. */
  memory: { nearby: "good" | "bad"; kind: string } | null;
  current: { skill: string; target: string | null; secondsRunning: number } | null;
}

/** `id` is a target string (pos:x,y,z or entity:<id>) that can be handed straight to a skill. */
export interface Nearby {
  id: string;
  type: string;
  dist: number;
}
