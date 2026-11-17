// The body's own flags, read from the bot's own entity as the server last sent it.

/** Full breath, in the game's ticks of air; the state reports it as 0 to 20. */
const FULL_AIR_TICKS = 300;
const AIR_TICKS_PER_POINT = 15;
/** Where the server keeps these in an entity's metadata. */
const FLAGS = 0;
const AIR = 1;
const FROZEN = 7;
const ON_FIRE = 1;
/** Fully frozen, in the game's ticks spent in powder snow. */
const FULL_FREEZE_TICKS = 140;

/** An entity's metadata and status effects, as far as the body needs them. */
interface HasMetadata {
  metadata?: unknown[];
  /** Active status effects, keyed by id (as Mineflayer keeps them). */
  effects?: unknown;
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

/** How frozen the body is, 0 to 1 (it climbs while standing in powder snow). */
export function freezingOf(entity: HasMetadata): number {
  const ticks = entity.metadata?.[FROZEN];
  return typeof ticks === "number" ? Math.min(1, Math.max(0, ticks / FULL_FREEZE_TICKS)) : 0;
}

/** The names of the status effects on the body right now ("poison", "hunger"), in lower case. */
export function effectsOf(entity: HasMetadata, nameOf: (id: number) => string | undefined): string[] {
  return Object.values((entity.effects ?? {}) as Record<string, { id?: number } | undefined>).flatMap((effect) => {
    const name = typeof effect?.id === "number" ? nameOf(effect.id) : undefined;
    return name ? [name.toLowerCase().replace(/\s+/g, "_")] : [];
  });
}

/**
 * Clears the flags after a death. The server only sends what changed, and a fresh body's values
 * are the defaults, so without this the bot would stay "on fire", "breathless", "frozen" and
 * "poisoned" after respawning (status effects are never taken off a body that has died).
 */
export function resetBody(entity: HasMetadata): void {
  const effects = entity.effects as Record<string, unknown> | undefined;
  if (effects) for (const id of Object.keys(effects)) delete effects[id];
  if (!entity.metadata) return;
  entity.metadata[FLAGS] = 0;
  entity.metadata[AIR] = FULL_AIR_TICKS;
  entity.metadata[FROZEN] = 0;
}
