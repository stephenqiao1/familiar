/** What a schemaVersion 12 Minecraft State carries in `data`. Distances are whole blocks. */
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
    /** Breath left, 0 to 20 (20 = full). */
    air: number;
    /** Burning (it keeps burning for a while after leaving the fire). */
    onFire: boolean;
    /** Feet or head in lava. */
    inLava: boolean;
    /** Feet or head in water. */
    inWater: boolean;
    /** Off the ground with a drop of 3 or more blocks below. */
    falling: boolean;
    /** What the locomotion controller is doing: travelling or not, the pattern and gait, and whether it is stuck. */
    locomotion: { moving: boolean; pattern: "walk" | "swim" | "dash" | null; gait: "walk" | "jog" | "sprint"; stuck: boolean };
    /**
     * The last time the bot was hurt (within the last minute): by whom if there was an attacker,
     * the game's own name for the kind of damage ("cactus", "hot_floor", "fall", "mob_attack"), and
     * the whole-block position where it happened.
     */
    lastHurt: { msAgo: number; by: string | null; kind: string | null; at: { x: number; y: number; z: number } } | null;
    /** The blocks the body is touching: at the feet, at the head, under the feet and on the four sides. */
    touching: { feet: string; head: string; below: string; sides: string[] };
    /** The head is inside a solid block: being buried. */
    inBlock: boolean;
    /**
     * Moved without meaning to (more than about half a block in the last moment, with no journey
     * under way and no movement key held): how far, which way, and the first danger within 2
     * blocks that way (a "drop", or a block known to hurt). Null if not pushed.
     */
    pushed: { blocks: number; toward: { x: number; z: number }; danger: Danger | null } | null;
    /** Which way the body is moving across the ground, and the first danger within 2 blocks that way. Null if still. */
    motion: { toward: { x: number; z: number }; danger: Danger | null } | null;
  };
  nearby: {
    /** Lava, fire and drops of 3 or more within 8 blocks, and other blocks the bot knows hurt within 3. */
    hazards: Nearby[];
    /** `reachable`: in line of sight and within 3 blocks of the bot's height (a cheap stand-in for "can get to me"). */
    mobs: (Nearby & { hostile: boolean; reachable: boolean })[];
    /** Chests, ripe crops and bells within 16 blocks. */
    blocks: Nearby[];
    /** Other players within 24 blocks (`type` is "player"). */
    players: Nearby[];
    /** Loud events heard in the last 2 seconds (explosions for now), with no target id. */
    loud: { type: string; dist: number }[];
  };
  /** How this place feels from memory (the strongest good or bad memory close by), or null. */
  memory: { nearby: "good" | "bad"; kind: string } | null;
  current: { skill: string; target: string | null; secondsRunning: number } | null;
}

/** Something dangerous along a direction: a "drop", or the name of a block known to hurt, and how many blocks away (1 or 2). */
export interface Danger {
  what: string;
  blocks: number;
}

/** `id` is a target string (pos:x,y,z or entity:<id>) that can be handed straight to a skill. */
export interface Nearby {
  id: string;
  type: string;
  dist: number;
}
