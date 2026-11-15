// The body's own flags, read from the bot's own entity as the server last sent it.

/** Full breath, in the game's ticks of air; the state reports it as 0 to 20. */
const FULL_AIR_TICKS = 300;
const AIR_TICKS_PER_POINT = 15;
/** Where the server keeps these in an entity's metadata. */
const FLAGS = 0;
const AIR = 1;
const ON_FIRE = 1;

/** An entity's metadata, as far as the body needs it. */
interface HasMetadata {
  metadata?: unknown[];
}

/**
 * Breath left, 0 to 20. Read from the bot's own entity, not `bot.oxygenLevel`: on newer versions
 * Mineflayer sets that from any entity's air, so a fish out of water makes the bot look breathless.
 */
export function airOf(entity: HasMetadata): number {
  const ticks = entity.metadata?.[AIR];
  return typeof ticks === "number" ? Math.max(0, Math.round(ticks / AIR_TICKS_PER_POINT)) : FULL_AIR_TICKS / AIR_TICKS_PER_POINT;
}

/** Burning: the server marks it with bit 1 of the entity's flags. */
export function isBurning(entity: HasMetadata): boolean {
  const flags = entity.metadata?.[FLAGS];
  return typeof flags === "number" && (flags & ON_FIRE) === ON_FIRE;
}

/**
 * Clears the flags after a death. The server only sends what changed, and a fresh body's values
 * are the defaults, so without this the bot would stay "on fire" and "breathless" after respawning.
 */
export function resetBody(entity: HasMetadata): void {
  if (!entity.metadata) return;
  entity.metadata[FLAGS] = 0;
  entity.metadata[AIR] = FULL_AIR_TICKS;
}
