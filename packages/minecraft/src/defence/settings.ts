// One bot's defence: what it is born knowing about threats, and how strong each part of the
// defence circuit is. Change a bot's innate knowledge in bots.json, not here.

/** Born knowing never to fight these by reflex: creepers explode, and the rest hit from a distance. */
export const USUAL_NEVER_FIGHT = ["creeper", "skeleton", "stray", "bogged", "pillager", "blaze", "ghast", "witch", "shulker", "breeze", "drowned", "guardian", "elder_guardian"];

export interface DefenceSettings {
  /**
   * The kinds the bot is born treating as threats: "game" trusts the game's own hostile flag;
   * a list names them; an empty list is a bot that has to learn every threat by being hurt.
   */
  innateThreats: "game" | string[];
  /** The kinds it is born knowing not to fight by reflex (until it has beaten them often enough). */
  innateNeverFight: string[];
  /** Holding still for a threat that has not noticed: scales that reflex's urgency. 0 never freezes. */
  freeze: number;
  /** Routing a journey round a threat that has not noticed. On above 0. */
  avoid: number;
  /** Being cornered changes the defence (freeze, then fight). On above 0. */
  cornered: number;
  /** How far danger and bravery move the flight distance. 0 leaves it at a flat 8 blocks. */
  flightDistance: number;
  /** Learning from what happens: which kinds are dangerous, beatable, or hit from afar. On above 0. */
  learnThreats: number;
  /** How far pain is dulled while fleeing or fighting. 0 never. */
  analgesia: number;
  /** Resting to recover after a fight or flight: scales that reflex's urgency. 0 never. */
  recuperate: number;
  /** Asking the pathfinder whether a threat can reach the bot and whether there is a way out. Off (0) uses the cheap guess and never counts the bot cornered. */
  reachCheck: number;
}

export const DEFAULT_DEFENCE: DefenceSettings = {
  innateThreats: "game",
  innateNeverFight: USUAL_NEVER_FIGHT,
  freeze: 1,
  avoid: 1,
  cornered: 1,
  flightDistance: 1,
  learnThreats: 1,
  analgesia: 1,
  recuperate: 1,
  reachCheck: 1,
};

const KEYS = ["freeze", "avoid", "cornered", "flightDistance", "learnThreats", "analgesia", "recuperate", "reachCheck"] as const;
const names = (list: unknown): list is string[] => Array.isArray(list) && list.every((name) => typeof name === "string" && name.length > 0);

/** What is wrong with the settings, or null if they are fine. */
export function defenceProblem(s: DefenceSettings): string | null {
  if (s.innateThreats !== "game" && !names(s.innateThreats)) return `defence.innateThreats must be "game" or a list of mob names`;
  if (!names(s.innateNeverFight)) return "defence.innateNeverFight must be a list of mob names";
  for (const key of KEYS) if (!(s[key] >= 0 && s[key] <= 1)) return `defence.${key} must be 0 to 1, got ${s[key]}`;
  return null;
}
