import type { Skill, Workspace } from "@familiar/contracts";
import type { BrainstemOptions, Leaning } from "@familiar/region-brainstem";
import type { MinecraftStateData } from "../encode/state-data.js";
import { thingsInView } from "./cues.js";
import { DEFENCE_SKILL, playerDefence } from "./defence.js";
import { asleep } from "./focus.js";
import type { PostureNotes } from "../posture/runtime.js";
import { MEDULLA_URGES } from "./medulla.js";
import { postureTrace, unsteadyOf } from "./posture.js";
import { minecraftDataOf } from "./read-state.js";
import { FAR_DISTANCE, playerReflexes } from "./reflexes.js";
import { createPlayerStartles, startleSurroundings } from "./startle.js";

// The player's brainstem settings: what startles it and how its body feels. (What draws its eye is in colliculus.ts.)
// What startles it is in startle.ts.

const MAX = { health: 20 };
/** The skills a soft reflex may propose, and which way each takes the bot. */
const LEANINGS: Record<string, Leaning> = { flee: "away", attack: "toward", eat: null, steady: null };
const IDLE = "idle";

/** Which way a reflex's skill takes the bot: fleeing is away from the threat, attacking is toward it. */
export function leaningOf(skill: string): Leaning {
  return LEANINGS[skill] ?? null;
}

const hostilesInView = (d: MinecraftStateData) => d.nearby.mobs.filter((m) => m.hostile && m.dist <= FAR_DISTANCE);

/** Night, nothing hostile in view, and nothing to do: ready for bed. */
export function drowsy(ws: Workspace): boolean {
  const data = minecraftDataOf(ws.state);
  if (!data || !data.time.isNight || hostilesInView(data).length > 0) return false;
  return ws.current === null || ws.current.skill === IDLE;
}

/** The names a goal may hold back: every soft reflex, and the skills they propose. */
export const HOLDABLE = [...playerReflexes.filter((r) => r.kind === "soft").map((r) => r.name), ...MEDULLA_URGES, ...Object.keys(LEANINGS)];

/** One line for the planner: which reflexes it may hold back, and that some cannot be. */
export const REFLEX_NOTE =
  `Reflexes you may hold back (holdBack): ${HOLDABLE.join(", ")}. ` +
  `Life-saving reflexes (${playerReflexes.filter((r) => r.kind === "hard").map((r) => r.name).join(", ")}) cannot be held back.`;

/** What the brainstem region needs from the player (everything but the bot's own settings and alarm). */
export function playerBrainstem<Ctx>(
  skills: Skill<Ctx>[],
  ctx: Ctx,
  sore: () => number = () => 0,
  /** How strongly unsteadiness is shared (0: not at all), and what the posture system did since last asked. */
  posture: { unsteady: number; notes?: () => PostureNotes } = { unsteady: 0 },
): Pick<
  BrainstemOptions,
  "startle" | "surroundings" | "defence" | "activeDefences" | "thingsOf" | "responseProblem" | "acceptsTarget" | "canStart" | "holdable" | "asleep" | "drowsy" | "body" | "postureNotes" | "skills"
> {
  const find = (name: string) => skills.find((s) => s.name === name);
  return {
    startle: createPlayerStartles(),
    surroundings: startleSurroundings,
    defence: playerDefence,
    activeDefences: [DEFENCE_SKILL.flee, DEFENCE_SKILL.fight],
    thingsOf: thingsInView,
    responseProblem(name) {
      const skill = find(name);
      if (!skill) return "unknown skill";
      if (skill.reflexOnly) return "reflex-only skill";
      return skill.primitive ? "a primitive, not a skill" : null;
    },
    acceptsTarget: (name, target) => find(name)?.canRun(ctx, target) ?? false,
    canStart: (name) => find(name)?.canRun(ctx) ?? false,
    holdable: HOLDABLE,
    asleep,
    drowsy,
    body(state) {
      const self = minecraftDataOf(state)?.self;
      return self ? { health: self.health / MAX.health, stuck: self.locomotion.stuck, sore: sore(), ...(posture.unsteady > 0 ? { unsteady: unsteadyOf(state, posture.unsteady) } : {}) } : null;
    },
    postureNotes: (state) => postureTrace(state, posture.notes?.() ?? {}),
    skills: { brace: "brace", flinch: "flinch" },
  };
}
