import type { Skill, Workspace } from "@familiar/contracts";
import { REWARD_SIGNAL } from "@familiar/neuromodulators";
import type { ColliculusOptions } from "@familiar/region-brainstem";
import { apparentSize, featuresOf, leanFromState, perceptsOf, type Physical } from "./colliculus-percepts.js";
import { asleep } from "./focus.js";
import { createScan } from "./glance.js";
import { REFLEX_SKILLS } from "./protective-reflexes.js";
import { defenceOf, minecraftDataOf } from "./read-state.js";
import { selfCaused } from "./startle.js";

export { apparentSize, createScan, featuresOf, leanFromState, perceptsOf, type Physical };

// What the colliculus region needs from the player: its percepts (colliculus-percepts.ts), its
// glances (glance.ts), and how the running skill and the body bear on a look.

const IDLE = "idle";
/**
 * A look that takes over from idling is proposed at full urgency: a graded one (0.35 to 0.7)
 * never wins in play, since idling scores about 0.9 with its learned value and stay bonus. This
 * is safe because it only happens with nothing running (idling itself leaves the head free, so
 * a look runs beside it), when no reflex, startle or loaded response spoke, and a look is over
 * in a moment.
 */
const TAKE_OVER_URGENCY = 1;

/** What the bot does to the thing a skill is aimed at is its own doing for this long after (a chest it opened, a block it worked on). */
const OWN_TARGET_MS = 4500;
/** Whether `id` is the target of the running skill, or of one that ran in the last few seconds. */
function actedOn(ws: Workspace, id: string): boolean {
  const now = ws.state.timestamp;
  return ws.current?.target === id || ws.recentEvents.some((event) => event.target === id && now - event.timestamp <= OWN_TARGET_MS);
}

/** The place a `pos:x,y,z` id names, or null for anything else. */
function pointOf(id: string): { x: number; y: number; z: number } | null {
  const at = /^pos:(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)$/.exec(id);
  return at ? { x: Number(at[1]), y: Number(at[2]), z: Number(at[3]) } : null;
}


/** Whether a skill leaves the head free (a skill that declares no parts uses the whole body). */
export function headFree(skill: { parts?: string[] } | undefined): boolean {
  return skill?.parts !== undefined && !skill.parts.includes("head");
}

/** Whether a skill uses no part of the body at all (idling): anything may run beside it. */
export function usesNothing(skill: { parts?: string[] } | undefined): boolean {
  return skill?.parts !== undefined && skill.parts.length === 0;
}

/** What the colliculus region needs from the player (everything but the bot's own settings and the brain's dials). */
export function playerColliculus<Ctx>(
  skills: Skill<Ctx>[],
  sameTime = false,
  /** How far the bot glances up and down as well as round (its `colliculus.elevation`). */
  upDown = 0,
): Pick<ColliculusOptions, "percepts" | "asleep" | "busy" | "eventful" | "idle" | "looksAlongside" | "scan" | "lookSkill" | "idleLookUrgency" | "pitchOf" | "defenceOf"> {
  const find = (name: string | undefined) => skills.find((s) => s.name === name);
  const scan = createScan();
  let sounds = new Set<string>();
  let before: { health: number; rewardAt: number } | null = null;
  return {
    percepts(ws) {
      const data = minecraftDataOf(ws.state);
      if (!data) return [];
      const heard = new Set<string>();
      // A block the bot itself just broke or placed is its own doing: looked at, but no news.
      const percepts = perceptsOf(data, (key) => (heard.add(key), !sounds.has(key)), (id) => selfCaused(data, ws, pointOf(id), id) || actedOn(ws, id));
      sounds = heard;
      return percepts;
    },
    asleep,
    busy(ws) {
      const running = ws.current?.skill;
      if (running === undefined) return null;
      if (REFLEX_SKILLS.includes(running) || running === "steady") return "reflex";
      return find(running)?.demanding ? "demanding" : null;
    },
    // Hurt, or rewarded, since the last tick: whatever is attended was worth the look.
    eventful(ws) {
      const data = minecraftDataOf(ws.state);
      if (!data) return false;
      const reward = ws.signals[REWARD_SIGNAL];
      const now = { health: data.self.health, rewardAt: reward && reward.value > 0 ? reward.at : (before?.rewardAt ?? 0) };
      const followed = before !== null && (now.health < before.health || now.rewardAt !== before.rewardAt);
      before = now;
      return followed;
    },
    idle: (ws: Workspace) => ws.current === null || ws.current.skill === IDLE,
    // Beside a skill that uses no part of the body (idling) always; beside one that leaves the head free with `sameTime`.
    looksAlongside: (ws) => ws.current !== null && (usesNothing(find(ws.current.skill)) || (sameTime && headFree(find(ws.current.skill)))),
    scan(ws) {
      const data = minecraftDataOf(ws.state);
      // Travelling, the head looks where the body is going.
      return data && !data.self.locomotion.moving ? scan(data, ws.state.timestamp, upDown) : null;
    },
    pitchOf: (ws) => minecraftDataOf(ws.state)?.self.gaze.pitch ?? 0,
    // The defence chosen and the thing it is about, for telling whether a look was worth it.
    defenceOf(ws) {
      const data = minecraftDataOf(ws.state);
      if (!data) return null;
      const { mode, target } = defenceOf(data).choice;
      return { mode, target };
    },
    lookSkill: "look_at",
    idleLookUrgency: TAKE_OVER_URGENCY,
  };
}
