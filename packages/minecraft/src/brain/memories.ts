import type { State } from "@familiar/contracts";
import type { MemoryTrigger, Place } from "@familiar/memory";
import { NOVELTY_SIGNAL, REWARD_SIGNAL } from "@familiar/neuromodulators";
import type { MinecraftStateData } from "../encode/state-data.js";
import { noticedIn } from "./cues.js";
import { minecraftDataOf, nearestThreat } from "./read-state.js";

// The moments the player remembers. Each trigger builds one plain sentence from the event (no
// LLM). Add or remove one: write it here and edit playerMemories. Every number is a first guess.

/** Losing this much health in one tick is worth remembering. */
const SIGNIFICANT_DAMAGE = 4;
/** A reward this big in one tick is worth remembering. */
const NOTABLE_REWARD = 0.5;
/** A mob seen as a threat within this long is the same encounter. */
const SAME_ENCOUNTER_MS = 60_000;

/** Where the bot is, for memory. */
export function placeOf(state: State): Place | null {
  const data = minecraftDataOf(state);
  return data && { ...data.self.position, dimension: data.self.dimension };
}

/** "at night in plains" / "in plains". */
function setting(d: MinecraftStateData): string {
  return `${d.time.isNight ? "at night " : ""}in ${d.self.biome ?? "an unknown place"}`;
}

/** The circumstances a general fact may keep: night or day. */
const context = (d: MinecraftStateData) => [d.time.isNight ? "night" : "day"];

const both = (before: State, after: State) => {
  const [a, b] = [minecraftDataOf(before), minecraftDataOf(after)];
  return a && b ? { a, b } : null;
};

export const tookDamage: MemoryTrigger = {
  name: "took_damage",
  check({ before, after }) {
    const s = both(before, after);
    if (!s) return null;
    const lost = s.a.self.health - s.b.self.health;
    if (lost < SIGNIFICANT_DAMAGE || s.b.self.deaths > s.a.self.deaths) return null;
    const threat = nearestThreat(s.b) ?? nearestThreat(s.a);
    return {
      kind: "danger",
      summary: `Took heavy damage${threat ? ` from a ${threat.type}` : ""} ${setting(s.b)}`,
      involved: threat ? [threat.type] : [],
      outcome: { feeling: "bad", value: -lost / 20 },
      context: context(s.b),
    };
  },
};

/**
 * A hostile mob appears close by when none was: remembered even if the bot gets away unhurt.
 * The same mob coming back into range within a minute is the same encounter, not a new memory.
 */
export function closeCall(): MemoryTrigger {
  const lastSeen = new Map<string, number>();
  return {
    name: "close_call",
    check({ before, after }) {
      const s = both(before, after);
      const threat = s && nearestThreat(s.b);
      if (!s || !threat) return null;
      const sameEncounter = after.timestamp - (lastSeen.get(threat.id) ?? -Infinity) <= SAME_ENCOUNTER_MS;
      lastSeen.set(threat.id, after.timestamp);
      if (nearestThreat(s.a) || sameEncounter) return null;
      // A hit in the same moment is remembered as damage (or death), not twice.
      if (s.a.self.health - s.b.self.health >= SIGNIFICANT_DAMAGE || s.b.self.deaths > s.a.self.deaths) return null;
      return {
        kind: "danger",
        summary: `Was surprised by a ${threat.type} ${setting(s.b)}`,
        involved: [threat.type],
        outcome: { feeling: "bad", value: -0.2 },
        context: context(s.b),
      };
    },
  };
}

export const died: MemoryTrigger = {
  name: "died",
  check({ before, after }) {
    const s = both(before, after);
    if (!s || s.b.self.deaths <= s.a.self.deaths) return null;
    const threat = nearestThreat(s.a);
    // The death happened where the bot was, not where it respawned.
    return {
      atPlaceBefore: true,
      kind: "death",
      summary: `Died${threat ? ` to a ${threat.type}` : ""} ${setting(s.a)}`,
      involved: threat ? [threat.type] : [],
      outcome: { feeling: "bad", value: -1 },
      context: context(s.a),
    };
  },
};

export const notableReward: MemoryTrigger = {
  name: "notable_reward",
  check({ after, ws }) {
    const data = minecraftDataOf(after);
    // Novelty has its own memory (first sight), so it does not count here.
    const reward = (ws.signals[REWARD_SIGNAL]?.value ?? 0) - (ws.signals[NOVELTY_SIGNAL]?.value ?? 0);
    if (!data || reward < NOTABLE_REWARD) return null;
    const doing = data.current?.skill;
    return {
      kind: "reward",
      summary: `Something went well${doing ? ` while doing ${doing}` : ""} ${setting(data)}`,
      involved: doing ? [doing] : [],
      outcome: { feeling: "good", value: reward },
      context: context(data),
    };
  },
};

/** First sight of a kind of thing or place (mob, useful block, player, biome). Items are left to novelty. */
export const firstSight: MemoryTrigger = {
  name: "first_sight",
  check({ before, after }) {
    const data = minecraftDataOf(after);
    if (!data) return null;
    const was = new Set(noticedIn(before));
    const arrived = noticedIn(after).find((kind) => !was.has(kind) && !kind.startsWith("item:"));
    if (arrived === undefined) return null;
    const thing = arrived.replace("biome:", "");
    return {
      kind: "discovery",
      summary: arrived.startsWith("biome:") ? `First came to ${thing}` : `First saw a ${thing} ${setting(data)}`,
      involved: [thing],
      outcome: { feeling: "neutral", value: 0 },
      once: true,
    };
  },
};

export const skillFailed: MemoryTrigger = {
  name: "skill_failed",
  check({ after, events }) {
    const data = minecraftDataOf(after);
    // "cannot run" is a skill that never started, not one that failed badly.
    const failed = events.find((e) => e.type === "failed" && e.reason !== "cannot run" && e.reason !== "unknown skill");
    if (!data || !failed) return null;
    return {
      kind: "failure",
      summary: `Failed to ${failed.skill.replace(/_/g, " ")}${failed.reason ? ` (${failed.reason})` : ""} ${setting(data)}`,
      involved: [failed.skill],
      outcome: { feeling: "bad", value: -0.2 },
      context: context(data),
    };
  },
};

/** The goal's last step was just judged finished. */
export function goalDone(): MemoryTrigger {
  let lastDoneAt: number | null = null;
  return {
    name: "goal_done",
    check({ after, ws }) {
      const data = minecraftDataOf(after);
      const goal = ws.goal;
      if (!data || !goal || goal.stepDoneAt === lastDoneAt) return null;
      lastDoneAt = goal.stepDoneAt;
      if (goal.steps.length === 0 || goal.stepsDone < goal.steps.length) return null;
      return { kind: "goal_done", summary: `Finished a goal: ${goal.text}`, involved: [], outcome: { feeling: "good", value: 0.5 } };
    },
  };
}

// TODO(memory): a "social" trigger (a meaningful exchange with another player) once social features exist.

/**
 * A block type has just become known to hurt (it hurt on two separate occasions). Heavy damage
 * has a memory of its own (`tookDamage`); this one is for the lesson, which a cactus prick is too
 * small to leave otherwise.
 */
export function learnedWhatHurts(justLearned: () => string[]): MemoryTrigger {
  return {
    name: "learned_what_hurts",
    check({ after }) {
      const names = justLearned();
      const d = minecraftDataOf(after);
      if (!names.length || !d) return null;
      return { kind: "danger", summary: `Learned that ${names.join(" and ")} hurts to touch`, involved: names, outcome: { feeling: "bad", value: -0.3 }, context: context(d) };
    },
  };
}

/**
 * A fresh set of every moment the player remembers (some triggers keep their own state).
 * `justLearned`: the block types just learned to hurt, if the bot learns them.
 */
export function playerMemories(justLearned?: () => string[]): MemoryTrigger[] {
  return [tookDamage, closeCall(), died, notableReward, firstSight, skillFailed, goalDone(), ...(justLearned ? [learnedWhatHurts(justLearned)] : [])];
}
