/** What a schemaVersion 2 Minecraft State carries in `data`. Distances are whole blocks. */
export interface MinecraftStateData {
  time: { isNight: boolean; lightLevel: number };
  self: {
    health: number;
    food: number;
    heldItem: string | null;
    /** Best weapon carried (sword > axe > pickaxe), or null for bare hands. */
    bestWeapon: string | null;
    pickaxeDurabilityPct: number | null;
    inventoryFullPct: number;
    torches: number;
    foodItems: number;
    distanceToBase: number;
  };
  nearby: {
    ores: Nearby[];
    hazards: Nearby[];
    mobs: (Nearby & { hostile: boolean })[];
  };
  current: { skill: string; target: string | null; secondsRunning: number } | null;
}

/** `id` is a target string (pos:x,y,z or entity:<id>) that can be handed straight to a skill. */
export interface Nearby {
  id: string;
  type: string;
  dist: number;
}
