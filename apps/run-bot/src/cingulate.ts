import type { DecisionEngine, Planner, Skill, Workspace } from "@familiar/contracts";
import { CONFLICT_SIGNAL } from "@familiar/basal-ganglia";
import { UNFAMILIAR_SIGNAL } from "@familiar/memory";
import { BAD_SURPRISE_SIGNAL, REPLAN_SIGNAL, REWARD_SIGNAL, SURPRISE_SIGNAL, type Scorebook } from "@familiar/neuromodulators";
import { PAIN_SIGNAL, STUCK_SIGNAL, TIRED_SIGNAL, URGE_SIGNAL } from "@familiar/region-brainstem";
import { MISMATCH_SIGNAL } from "@familiar/region-cerebellum";
import { PLAN_COSTS, type CingulateOptions, type Source } from "@familiar/region-cingulate";
import { STRESS_SIGNAL } from "@familiar/region-hypothalamus";
import { REFLEX_SIGNAL } from "@familiar/region-reflex";
import { UNEXPECTED_SIGNAL, type Surprise } from "@familiar/region-sensory";

// What the cingulate reads, for the player's brain: the sources of trouble, what is at stake,
// how likely more thought is to help, what has been spent, and the progress being made. Every
// source is one entry in `sources`; to add one, add an entry.

/** A skill tried this many times is well known. */
const WELL_KNOWN_RUNS = 5;
/** An urge of the body this strong is already dealing with it, as a reflex is. */
const URGE_HAS_IT = 0.5;
const MINUTE_MS = 60_000;

/** Counts the thinking the bot does: each call of the instinct engine is one, each plan fifteen. */
export interface CallCounter {
  /** The engine and the planner, counted. */
  engine<E extends DecisionEngine>(engine: E): E;
  planner<P extends Planner>(planner: P): P;
  /** Calls in the minute up to `now` (and `now` is the time later calls are stamped with). */
  spent(now: number): number;
}

export function createCallCounter(): CallCounter {
  let calls: { at: number; cost: number }[] = [];
  let clock = 0;
  const note = (cost: number) => void calls.push({ at: clock, cost });
  return {
    engine: (engine) => ({ ...engine, name: engine.name, decide: (state, questions) => (note(1), engine.decide(state, questions)), ...(engine.lastTiming ? { lastTiming: () => engine.lastTiming!() } : {}) }),
    planner: (planner) => ({ ...planner, name: planner.name, plan: (request, signal) => (note(PLAN_COSTS), planner.plan(request, signal)), ...(planner.nameRoutine ? { nameRoutine: (request, signal) => planner.nameRoutine!(request, signal) } : {}), ...(planner.review ? { review: (request, signal) => (note(PLAN_COSTS), planner.review!(request, signal)) } : {}) }),
    spent(now) {
      clock = now;
      calls = calls.filter((c) => now - c.at <= MINUTE_MS);
      return calls.reduce((sum, c) => sum + c.cost, 0);
    },
  };
}

export interface PlayerCingulate<Ctx> {
  scorebook: Scorebook;
  skills: readonly Skill<Ctx>[];
  /** The scorebook's situation for a state. */
  situationOf(state: Workspace["state"]): string;
  /** The step the motor area says is stuck and is still about the goal's current step, or null. */
  stuckStep(ws: Workspace): { text: string; why: string } | null;
  /** What the sensory area is reporting, strongest first. */
  surprises(ws: Workspace): Surprise[];
  /** The amygdala's latest surprise, 0 to 1 (0 with none since last asked). */
  amygdalaSurprise(): number;
  /** Where the body is, for the ground it covers. */
  placeOf(state: Workspace["state"]): { x: number; y: number; z: number } | null;
  /** The body is at rest (asleep): nothing is judged for what it pays. Default: never. */
  resting?(ws: Workspace): boolean;
  calls: CallCounter;
}

const level = (ws: Workspace, signal: string) => ws.signals[signal]?.value ?? 0;
/** What the body is doing: the running skill and what it is aimed at. */
const doing = (ws: Workspace) => (ws.current ? [ws.current.skill, ...(ws.current.target ? [ws.current.target] : [])] : []);

/** Every source of trouble the player's brain has (slow progress is the cingulate's own). */
export function troubleSources<Ctx>(parts: Pick<PlayerCingulate<Ctx>, "stuckStep" | "surprises">): Source[] {
  return [
    // Two responses clashing: a near tie the basal ganglia are waiting on.
    { name: "conflict", read: (ws) => ({ strength: level(ws, CONFLICT_SIGNAL), about: doing(ws) }) },
    // A movement that came out other than predicted.
    { name: "mismatch", read: (ws) => ({ strength: level(ws, MISMATCH_SIGNAL), about: doing(ws) }) },
    // The scene is not as this place usually is, or as the goal said to expect.
    { name: "unexpected", read: (ws) => ({ strength: level(ws, UNEXPECTED_SIGNAL), about: parts.surprises(ws).flatMap((s) => [...s.ids, s.kind]) }) },
    // The goal's current step is stuck.
    { name: "stuck step", read: (ws) => ({ strength: parts.stuckStep(ws) ? 1 : 0, about: doing(ws) }) },
    // A skill just ended worse than expected.
    { name: "bad surprise", read: (ws) => level(ws, BAD_SURPRISE_SIGNAL) },
    { name: "pain", read: (ws) => ({ strength: level(ws, PAIN_SIGNAL), about: ["body"] }) },
    // The body did something nothing explains.
    { name: "uneasy", read: (ws) => ({ strength: ws.feeling?.uneasy.level ?? 0, about: ["body"] }) },
    // The alarm system asks for another plan (the body was moved somewhere else, what it wants most changed, a goal is not paying off).
    { name: "replan", read: (ws) => level(ws, REPLAN_SIGNAL) },
    // The legs are stuck: trying to get free, or just gave up.
    { name: "stuck", read: (ws) => ({ strength: level(ws, STUCK_SIGNAL), about: doing(ws) }) },
  ];
}

/** The words for each kind of trouble in the planner's note. */
const SAID: Record<string, string> = { conflict: "two choices nearly tied", mismatch: "a movement went other than expected", unexpected: "something unexpected", "stuck step": "a stuck step", "bad surprise": "a skill ended worse than expected", pain: "pain", uneasy: "the body changed with no cause to be seen", replan: "things have changed", stuck: "the legs are stuck", "slow progress": "what it is doing is not paying" };

/**
 * Why the planner is being woken, in one line: the events behind the trouble (the strongest
 * first, each with all its faces), and for a stuck step or a surprise the words of whoever reported it.
 */
export function troubleNote(ws: Workspace, parts: Pick<PlayerCingulate<unknown>, "stuckStep" | "surprises">): string {
  const events = (ws.trouble?.events ?? []).slice(0, 2);
  const kinds = new Set(events.flatMap((e) => e.kinds));
  const said = events.map((e) => e.kinds.map((k) => SAID[k] ?? k).join(" and ")).join("; also ");
  const stuck = kinds.has("stuck step") ? parts.stuckStep(ws) : null;
  const surprise = kinds.has("unexpected") ? parts.surprises(ws)[0] : undefined;
  const detail = [stuck ? `The current step ("${stuck.text}") is stuck: ${stuck.why}.` : "", surprise ? `Not as expected: ${surprise.why}.` : ""].filter(Boolean).join(" ");
  return `There is trouble: ${said}.${detail ? ` ${detail}` : ""} ${stuck ? "Plan another way." : "Plan with that in mind."}`;
}

/** What the cingulate region needs from the player's brain (everything but its settings). */
export function playerCingulate<Ctx>(parts: PlayerCingulate<Ctx>): Omit<CingulateOptions, "settings"> {
  const { scorebook, skills } = parts;
  let before: { at: { x: number; y: number; z: number } | null; stepDoneAt: number | null } | null = null;
  const entry = (ws: Workspace) => (ws.current ? scorebook.get(parts.situationOf(ws.state), ws.current.skill) : null);
  return {
    sources: troubleSources(parts),
    stake: (ws) => ({
      // By the weight the hypothalamus gives each need: being short of torches presses fully and still matters a quarter as much as hunger.
      need: Math.max(0, ...(ws.needs?.readings ?? []).map((n) => n.pressing * Math.min(1, n.weight))),
      goal: ws.goal?.priority ?? 0,
      skill: Math.min(1, Math.max(0, entry(ws)?.expected ?? 0)),
    }),
    chance: (ws) => ({
      close: level(ws, CONFLICT_SIGNAL),
      unknown: ws.current ? 1 - Math.min(1, (entry(ws)?.runs ?? 0) / WELL_KNOWN_RUNS) : 0,
      unfamiliar: level(ws, UNFAMILIAR_SIGNAL),
      reflex: level(ws, REFLEX_SIGNAL) >= 1 || level(ws, URGE_SIGNAL) >= URGE_HAS_IT,
    }),
    calls: (now) => parts.calls.spent(now),
    tired: (ws) => level(ws, TIRED_SIGNAL),
    stress: (ws) => level(ws, STRESS_SIGNAL),
    mood: (ws) => ws.feeling?.mood ?? 0,
    // Rest is not an activity: sleep, and a skill that uses no part of the body, are not judged for what they pay.
    activity: (ws) => (ws.current && !parts.resting?.(ws) && skills.find((s) => s.name === ws.current!.skill)?.parts?.length !== 0 ? ws.current.skill : null),
    progress(ws) {
      const at = parts.placeOf(ws.state);
      const stepDoneAt = ws.goal?.stepDoneAt ?? null;
      const ground = at && before?.at ? Math.hypot(at.x - before.at.x, at.y - before.at.y, at.z - before.at.z) : 0;
      const steps = before !== null && stepDoneAt !== null && stepDoneAt !== before.stepDoneAt ? 1 : 0;
      before = { at, stepDoneAt };
      return { reward: level(ws, REWARD_SIGNAL), steps, ground };
    },
    surprises: (ws) => ({ outcome: level(ws, SURPRISE_SIGNAL), movement: level(ws, MISMATCH_SIGNAL), scene: level(ws, UNEXPECTED_SIGNAL), harm: parts.amygdalaSurprise() }),
  };
}
