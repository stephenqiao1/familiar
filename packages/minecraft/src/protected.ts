/** Blocks the bot must never break: its base and other player-built storage and workstations. */
export function isProtectedBlock(name: string): boolean {
  return PROTECTED.has(name) || name.endsWith("_bed");
}

const PROTECTED = new Set(["chest", "trapped_chest", "barrel", "crafting_table", "furnace", "blast_furnace", "smoker"]);
