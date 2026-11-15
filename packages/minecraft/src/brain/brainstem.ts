import type { Skill, Workspace } from "@familiar/contracts";
import type { BrainstemOptions, Leaning, StartleDetector, Thing } from "@familiar/region-brainstem";
import type { MinecraftStateData } from "../encode/state-data.js";
import { thingsInView } from "./cues.js";
import { asleep } from "./focus.js";
import { minecraftDataOf } from "./read-state.js";
import { CONTACT_DISTANCE, FAR_DISTANCE, playerReflexes } from "./reflexes.js";

// The player's brainstem settings: what startles it, what draws its eye, how its body feels.
// Add a startle detector: write one here and add it to playerStartles.

const MAX = { health: 20, air: 20, food: 20 };
/** A loud event this close startles. */
const LOUD_WITHIN = 16;
/** The skills a soft reflex may propose, and which way each takes the bot. */
const LEANINGS: Record<string, Leaning> = { flee: "away", attack: "toward", eat: null };
const IDLE = "idle";

/** Which way a reflex's skill takes the bot: fleeing is away from the threat, attacking is toward it. */
export function leaningOf(skill: string): Leaning {
  return LEANINGS[skill] ?? null;
}

/**
 * A look is proposed at full urgency. The spec's 0.35 never won in play: idling scores about 0.9
 * once its learned value and stay bonus are added. This is safe because the brainstem only
 * proposes a look when the bot is idle (or doing nothing) and no reflex, startle or loaded
 * response spoke on the same tick, and a look is over in a moment.
 */
const LOOK_URGENCY = 1;

/** A detector that reads two Minecraft states; silent before the first one arrives. */
function detector(name: string, check: (before: MinecraftStateData, after: MinecraftStateData) => { source: Thing | null } | null): StartleDetector {
  return {
    name,
    check({ before, after }) {
      const [a, b] = [minecraftDataOf(before), minecraftDataOf(after)];
      return a && b ? check(a, b) : null;
    },
  };
}

const hostilesInView = (d: MinecraftStateData) => d.nearby.mobs.filter((m) => m.hostile && m.dist <= FAR_DISTANCE);
/** The bot was hurt since `before`, by something (not by a fall, fire or hunger). */
const hurtBy = (a: MinecraftStateData, b: MinecraftStateData): string | null => {
  const hurt = b.self.lastHurt;
  const fresh = hurt !== null && (a.self.lastHurt === null || hurt.msAgo < a.self.lastHurt.msAgo);
  return fresh ? hurt.by : null;
};
const thingFor = (d: MinecraftStateData, id: string): Thing | null => {
  const seen = [...d.nearby.mobs, ...d.nearby.players].find((t) => t.id === id);
  return seen ? { id: seen.id, kind: seen.type } : null;
};

/** Hit by something while no threat was in view: the attacker is the source, if it can be seen now. */
export const hurtUnseen = detector("hurt_unseen", (a, b) => {
  const by = hurtBy(a, b);
  return by !== null && hostilesInView(a).length === 0 ? { source: thingFor(b, by) } : null;
});

/** A hostile first seen already on top of the bot. */
export const hostileUpClose = detector("hostile_up_close", (a, b) => {
  const known = new Set(a.nearby.mobs.map((m) => m.id));
  const mob = hostilesInView(b).find((m) => m.dist <= CONTACT_DISTANCE && !known.has(m.id));
  return mob ? { source: { id: mob.id, kind: mob.type } } : null;
});

/** An explosion close by. Its direction is not in the state, so there is nothing to face. */
export const loudNearby = detector("loud_nearby", (a, b) => {
  const loud = (d: MinecraftStateData) => d.nearby.loud.filter((e) => e.dist <= LOUD_WITHIN).length;
  return loud(b) > loud(a) ? { source: null } : null;
});

/** Everything that startles the player, most telling first. */
export const playerStartles: StartleDetector[] = [hostileUpClose, hurtUnseen, loudNearby];

/**
 * Something new or sudden worth a look: whoever just hurt the bot, else a hostile or a player
 * that has just come into view (within 16 blocks).
 */
export function somethingNew(before: MinecraftStateData, after: MinecraftStateData): Thing | null {
  const by = hurtBy(before, after);
  const attacker = by === null ? null : thingFor(after, by);
  if (attacker) return attacker;
  const known = new Set([...before.nearby.mobs, ...before.nearby.players].map((t) => t.id));
  const fresh = [...hostilesInView(after), ...after.nearby.players].filter((t) => !known.has(t.id)).sort((x, y) => x.dist - y.dist)[0];
  return fresh ? { id: fresh.id, kind: fresh.type } : null;
}

/** Night, nothing hostile in view, and nothing to do: ready for bed. */
export function drowsy(ws: Workspace): boolean {
  const data = minecraftDataOf(ws.state);
  if (!data || !data.time.isNight || hostilesInView(data).length > 0) return false;
  return ws.current === null || ws.current.skill === IDLE;
}

/** The names a goal may hold back: every soft reflex, and the skills they propose. */
export const HOLDABLE = [...playerReflexes.filter((r) => r.kind === "soft").map((r) => r.name), ...Object.keys(LEANINGS)];

/** One line for the planner: which reflexes it may hold back, and that some cannot be. */
export const REFLEX_NOTE =
  `Reflexes you may hold back (holdBack): ${HOLDABLE.join(", ")}. ` +
  `Life-saving reflexes (${playerReflexes.filter((r) => r.kind === "hard").map((r) => r.name).join(", ")}) cannot be held back.`;

/** What the brainstem region needs from the player (everything but the bot's own settings and alarm). */
export function playerBrainstem<Ctx>(skills: Skill<Ctx>[], ctx: Ctx): Pick<
  BrainstemOptions,
  "startle" | "novel" | "mayOrient" | "thingsOf" | "responseProblem" | "acceptsTarget" | "holdable" | "asleep" | "drowsy" | "body" | "skills" | "orientUrgency"
> {
  const find = (name: string) => skills.find((s) => s.name === name);
  return {
    startle: playerStartles,
    novel({ before, after }) {
      const [a, b] = [minecraftDataOf(before), minecraftDataOf(after)];
      return a && b ? somethingNew(a, b) : null;
    },
    // A look never interrupts real work: only idling, or nothing at all.
    mayOrient: (ws) => ws.current === null || ws.current.skill === IDLE,
    thingsOf: thingsInView,
    responseProblem(name) {
      const skill = find(name);
      if (!skill) return "unknown skill";
      if (skill.reflexOnly) return "reflex-only skill";
      return skill.primitive ? "a primitive, not a skill" : null;
    },
    acceptsTarget: (name, target) => find(name)?.canRun(ctx, target) ?? false,
    holdable: HOLDABLE,
    asleep,
    drowsy,
    body(state) {
      const self = minecraftDataOf(state)?.self;
      return self ? { health: self.health / MAX.health, air: 1 - self.air / MAX.air, hunger: 1 - self.food / MAX.food } : null;
    },
    skills: { brace: "brace", lookAt: "look_at" },
    orientUrgency: LOOK_URGENCY,
  };
}
