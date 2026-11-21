import type { State } from "@familiar/contracts";
import { SCHEMA_VERSION } from "../encode/encode-state.js";
import { cheapDefence } from "../defence/assess.js";
import { couldHarm, FAR_DISTANCE } from "../defence/size-up.js";
import type { Defence, MinecraftStateData, Sighted } from "../encode/state-data.js";

/** A mob that could harm the bot and has not noticed it (see nearestThreat) is a threat this close. */
export const DANGER_DISTANCE = 8;

/** A state's Minecraft data, or null if it is not a Minecraft state (e.g. before the first one arrives). */
export function minecraftDataOf(state: State): MinecraftStateData | null {
  return state.schemaVersion === SCHEMA_VERSION ? (state.data as unknown as MinecraftStateData) : null;
}

const worked = new WeakMap<MinecraftStateData, Defence>();

/** The state's defence reading: the threat sense's if it made one, else the cheap rules' (worked out once per state). */
export function defenceOf(data: MinecraftStateData): Defence {
  if (data.defence) return data.defence;
  if (!worked.has(data)) worked.set(data, cheapDefence(data));
  return worked.get(data)!;
}

/**
 * The closest mob that could harm the bot from where it is, or null, with `within`: how far off
 * that one counts. One that has not noticed the bot counts inside DANGER_DISTANCE. One that has
 * noticed it counts as far off as threats are sized up at all: it is coming, so having run out
 * of arm's way is not being safe, and nothing lesser is worth turning back for. What counts is
 * the defence circuit's own sizing up, so there is one opinion of each mob: it is a threat (by
 * the game's word or by what the bot has learned) and it could harm the bot (see couldHarm). A
 * mob shut in a cage, or across a gap it cannot cross, is not.
 */
export function nearestThreat(data: MinecraftStateData) {
  const within = new Map(defenceOf(data).threats.filter(couldHarm).map((t) => [t.id, t.noticed ? FAR_DISTANCE : DANGER_DISTANCE]));
  const mob = data.nearby.mobs.filter((m) => m.dist <= (within.get(m.id) ?? -1)).sort((a, b) => a.dist - b.dist)[0];
  return mob ? { ...mob, within: within.get(mob.id)! } : null;
}

/** What the eyes say of a nearby thing; one from a state made without eyes counts as seen, straight ahead and still. */
export function sightedOf(thing: Partial<Sighted>): Sighted {
  return { bearing: thing.bearing ?? { side: "ahead", angle: 0 }, seen: thing.seen ?? true, closing: thing.closing ?? 0, ...(thing.speed === undefined ? {} : { speed: thing.speed }), ...(thing.lastSeen ? { lastSeen: thing.lastSeen } : {}) };
}
