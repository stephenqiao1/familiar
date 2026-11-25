import type { Choice, SelectionSettings } from "@familiar/basal-ganglia";
import type { Candidate, Skill, State, Workspace } from "@familiar/contracts";
import { needsNow, situationOf, thingsInView } from "@familiar/minecraft";
import {
  aimAt,
  brakeFactor,
  DOPAMINE_SIGNAL,
  holdNow,
  NEUTRAL_SEARCH,
  PATIENCE_SIGNAL,
  reliefOf,
  skillValue,
  switchMarginFactor,
  SWITCHING_SIGNAL,
  WANT_SIGNAL,
  type DopaminePersonality,
  type PatienceSettings,
  type Persistence,
  type Scorebook,
} from "@familiar/neuromodulators";
import { COMPETE, DESPERATE_SIGNAL } from "@familiar/region-hypothalamus";
import { URGE_SIGNAL } from "@familiar/region-brainstem";

// What the rules about who wins read: the scorebook, the modulators' signals, the needs and the
// running skill's persistence. One place, so that every term (and the old arbiter kept for
// comparison) reads the same things in the same way.

export interface SelectionParts<Ctx> {
  scorebook: Scorebook;
  personality: DopaminePersonality;
  patience: PatienceSettings;
  /** Default: no bonus for the running skill, and nothing is ever given up on. */
  persistence?: Persistence;
  skills: Skill<Ctx>[];
  /** The strength of each part of how choices are made (from bots.json). Default: all on. */
  selection?: SelectionSettings;
  /** Without channels: a look may run alongside a skill that leaves the head free. Default: false. */
  sameTime?: boolean;
  /** Told what each choice came to (the striatum). Default: nobody. */
  onChoice?(choice: Choice, ws: Workspace): void;
  /** The time, for what goes by the clock (the stay bonus, the wait after giving up). Default: the wall clock. A replay passes the recorded time. */
  now?(): number;
}

/** The current patience, or the bot's resting level when the serotonin region is off. */
export function patienceOf(ws: Pick<Workspace, "signals">, patience: PatienceSettings): number {
  return ws.signals[PATIENCE_SIGNAL]?.value ?? patience.resting;
}

export function selectionInputs<Ctx>(parts: SelectionParts<Ctx>) {
  const { scorebook, personality, patience, persistence, now = () => Date.now() } = parts;
  const risky = new Set(parts.skills.filter((s) => s.risky).map((s) => s.name));
  // Both are asked for every candidate by several terms, and each is worked out from the whole state: once per state is enough.
  const once = <T>(read: (state: State) => T) => {
    let last: { state: State; value: T } | null = null;
    return (state: State) => (last?.state === state ? last.value : (last = { state, value: read(state) }).value);
  };
  const situation = once(situationOf);
  const inView = once(thingsInView);
  /** What is learned about a target: the thing in the state, else the remembered one. */
  const aimOf = (state: State, target: string) => {
    const seen = inView(state).find((t) => t.id === target);
    return seen ? aimAt(seen) : scorebook.things().find((t) => t.id === target);
  };
  /** Where the option would be carried out, and at what. */
  const where = (ws: Workspace, { action }: Candidate) => {
    const target = "target" in action ? action.target : undefined;
    return [situation(ws.state), target === undefined ? undefined : aimOf(ws.state, target)] as const;
  };
  return {
    /** What a skill is worth here: its learned benefit against its cost, tilted by the dopamine level. */
    valueOf: (skill: string, ws: Workspace) => skillValue(scorebook.get(situation(ws.state), skill), ws.signals[DOPAMINE_SIGNAL]?.value ?? personality.restingDA),
    /** The bonus for being the skill already running, while it is getting somewhere. */
    stayOf: (skill: string) => persistence?.stayBonus(skill, now()) ?? 0,
    /** Searching makes switching easier, settling makes it harder. */
    switchingOf: (ws: Workspace) => switchMarginFactor(ws.signals[SWITCHING_SIGNAL]?.value ?? NEUTRAL_SEARCH),
    /** How strongly the body is asking for something. */
    urgeOf: (ws: Workspace) => ws.signals[URGE_SIGNAL]?.value ?? 0,
    /** While something is wanted: less, the more pressing the worst need the option is not expected to relieve. Otherwise 1. */
    holdOf(skill: string, candidate: Candidate, ws: Workspace) {
      if (!((ws.signals[WANT_SIGNAL]?.value ?? 0) > 0)) return 1;
      const [situation, aim] = where(ws, candidate);
      return holdNow(Object.fromEntries(needsNow(ws).map((n) => [n.name, n.pressing])), (need) => scorebook.get(situation, reliefOf(skill, need), aim).expected, personality.wanting);
    },
    /** How hard the patience brake bears on an option: by how costly it has been learned to be here, aimed at this. A skill marked risky starts as costly and one not marked as harmless; what happens then moves both. */
    brakeStrengthOf(skill: string, candidate: Candidate, ws: Workspace) {
      const [situation, aim] = where(ws, candidate);
      const costly = Math.min(1, Math.max(0, (risky.has(skill) ? 1 : 0) + scorebook.get(situation, skill, aim).cost - 1));
      return patience.brake * costly;
    },
    /** The brake itself: patience holds back (or, when low, lets loose). */
    brake: (strength: number, ws: Workspace) => brakeFactor(patienceOf(ws, patience), strength),
    desperateOf: (ws: Workspace) => ws.signals[DESPERATE_SIGNAL]?.value ?? 0,
    /** How much of the brake a desperate need takes off, at most. */
    desperateEases: COMPETE.brakeOff,
    /** The skill was given up on a moment ago and may not be started again yet. */
    heldBack: (skill: string) => persistence?.heldBack(skill, now()) ?? false,
  };
}
