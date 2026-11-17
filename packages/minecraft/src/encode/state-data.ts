/** What a schemaVersion 14 Minecraft State carries in `data`. Distances are whole blocks. */
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
    /** Food carried that is not known to be bad. */
    foodItems: number;
    /** Food carried that the bot knows to be bad for it. */
    badFoodItems: number;
    /** The hidden reserve behind the food bar, 0 to 20: the food bar only falls once this is used up. */
    saturation: number;
    /** The status effects on the body, by the game's names in lower case ("poison", "hunger", "regeneration"). */
    effects: string[];
    /** How frozen, 0 to 1 (it climbs while standing in powder snow). */
    freezing: number;
    /** Game minutes since the bot last slept. */
    sinceSleepMinutes: number;
    /** Health has gone up in the last few seconds. */
    healing: boolean;
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
    /**
     * What holds the bot up: the block (`on`), how it behaves (`kind`: solid; loose, a block that
     * falls when unsupported; slippery; slow; liquid; climbing; riding; none, in the air), how many
     * of the four sides open onto a drop of 3 or more (`edges`), and the open space above the head
     * (`headroom`, up to 3).
     */
    support: { on: string; kind: "solid" | "loose" | "slippery" | "slow" | "liquid" | "climbing" | "riding" | "none"; edges: number; headroom: number };
    /** How the body is moving, in blocks per second, and whether it is on the ground. */
    velocity: { x: number; y: number; z: number; onGround: boolean };
    /**
     * Only while in the air: how far down the fall ends, onto what (a block name or "void"),
     * whether it would cost health, and a better place to land within 2 blocks sideways if there
     * is one (`steer`, a target).
     */
    landing: { blocks: number; onto: string; hurts: boolean; steer: string | null } | null;
    /** True for one tick when the bot's position jumped more than 8 blocks without it travelling there (teleport, respawn, portal). */
    displaced: boolean;
    /** How steady the body is, 0 to 1: 1 on flat solid ground with room around, 0 in the air over a landing that would hurt. */
    balance: number;
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
