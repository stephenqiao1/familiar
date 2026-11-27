import type { Feedback, Goal, Proposal, SkillEvent, Step, Workspace } from "@familiar/contracts";
import type { Area, AreaOutput, Condition } from "@familiar/neocortex";
import type { Chain, Link } from "./chunks.js";
import { begin, counted, keyOf, REPORT_AGAIN_MS, stuckWhy, type StepRun } from "./step-run.js";

export interface MotorOptions {
  /** How much of the goal's priority its proposals carry, 0 to 1. At 0 it does nothing: the goal passes straight through to the area below. */
  strength: number;
  /** Reads a condition's text (null: not in the vocabulary). With conditions off, give one that reads nothing. */
  parse(text: string | undefined): Condition | null;
  /** Why a skill cannot be a step's skill at all (unknown, not for deciders), or null. */
  skillProblem(skill: string): string | null;
  /** Whether the skill can be started on this target right now. */
  canStart(skill: string, target: string | undefined, ws: Workspace): boolean;
  /** How long the skill usually takes, in ms, as far as anything has learned (null: not known yet). */
  usualMs?(skill: string, now: number): number | null;
  /** Whether a skill only rests (it uses no part of the body: idling): a step that waits is never stuck by time. Default: none does. */
  rests?(skill: string): boolean;
  /** How much the goal counts right now, 0 to 1 (alarm can take the planner out of charge). Default: in full. */
  weightOf?(goal: Goal, ws: Workspace): number;
  /** True to do nothing this tick (asleep). Default: never. */
  paused?(ws: Workspace): boolean;
  /** Chunks: the chain of abilities that got each step finished is noted, to be saved as a skill once it has worked often enough. Default: nothing is noted. */
  chains?: ChainOptions;
  /** Default: "motor". */
  name?: string;
  /** Default: 1. */
  layer?: number;
}

export interface ChainOptions {
  /** Whether a run counts toward a chain. What a reflex or an urge of the body did is left out. */
  counts(event: SkillEvent): boolean;
  /**
   * One run as a link: its target written as a kind of thing (for a run given no target, the
   * thing it chose to aim at, if it says). Null if the target cannot be written so (a bare
   * spot): the chain is then not kept.
   */
  link(skill: string, target: string | undefined, ws: Workspace): Link | null;
  /** Told each chain that finished a step by its "done when". Returns the chain's record, or why it was not kept. */
  finished(doneWhen: string, links: Link[]): Chain | string;
  /** Told of every run that ended, with the workspace as it stands just after (for judging a learned skill by its own test). */
  ended?(event: SkillEvent, ws: Workspace): void;
}

/**
 * The most a step's proposal is ever worth, whatever the goal's priority: the same ceiling as
 * instinct's choices. Full urgency is the hard reflexes' alone, and an urge of the body can still outbid a goal.
 */
export const MOST_URGENCY = 0.8;

/** What the motor area reports upward when the step under way is stuck. */
export interface Stuck {
  step: number;
  text: string;
  why: string;
  at: number;
}

/**
 * The motor area: carries out the step the goal is at. A step with a "done when" the code can
 * check and a skill is proposed, as an ordinary proposal worth the goal's priority (0.8 at the most). One with no
 * skill is passed down to the area below as its focus. The tick its "done when" comes true the
 * step is finished. A step that is stuck is reported upward with the reason. A step whose
 * "done when" cannot be read is left as it was before: words for the area below, judged by the planner.
 */
export function createMotorArea(options: MotorOptions): Area {
  const { strength, parse, name = "motor", layer = 1 } = options;
  let run: StepRun | null = null;
  let stuck: Stuck | null = null;
  /** The chain so far for the step under way: the runs a decider started that finished, in order (null where one could not be written as a kind). */
  let links: { key: string; chain: (Link | null)[] } = { key: "", chain: [] };
  /** Skill events up to this time have been looked at for the chain. */
  let eventsTo = -Infinity;
  /** The run under way, if a decider started it. */
  let underWay: { skill: string; target: string | undefined } | null = null;

  /** The chain belongs to one step: with another step under way (or none: an empty key), it starts again. */
  const chainFor = (key: string) => {
    if (links.key !== key) links = { key, chain: [] };
  };

  /** Reads the skill events since last tick: finished runs join the chain of the step under way, and the run under way is kept in mind. */
  function follow(ws: Workspace): void {
    const chains = options.chains;
    if (!chains) return;
    for (const event of ws.recentEvents) {
      if (event.timestamp <= eventsTo || event.alongside) continue;
      eventsTo = event.timestamp;
      if (event.type !== "started") chains.ended?.(event, ws);
      if (event.type === "started") underWay = chains.counts(event) ? { skill: event.skill, target: event.target } : null;
      else {
        if (event.type === "done" && links.key && chains.counts(event)) links.chain.push(chains.link(event.skill, event.target ?? event.aimedAt, ws));
        underWay = null;
      }
    }
  }

  /** The step is finished: its chain, with the run still under way as its last link, is handed over. */
  function chainFinished(ws: Workspace, doneWhen: string): Chain | string | undefined {
    const chains = options.chains;
    if (!chains) return undefined;
    const last = underWay && ws.current?.skill === underWay.skill ? [chains.link(underWay.skill, underWay.target, ws)] : [];
    const chain = [...links.chain, ...last];
    links = { key: "", chain: [] };
    if (chain.some((l) => l === null)) return "a target that cannot be written as a kind of thing";
    return chains.finished(doneWhen, chain as Link[]);
  }

  /** One tick on the step the goal is at. `mayFinish` is false for a step just moved on to: its turn to finish is next tick. */
  function carryOut(ws: Workspace, goal: Goal, mayFinish: boolean, trace: Record<string, unknown>): AreaOutput {
    const now = ws.state.timestamp;
    const index = goal.stepsDone;
    const step: Step | undefined = goal.specs[index];
    // A report stands for as long as the step it is about is the one under way: a plan that leaves the step as it was has not answered it.
    const report = () => (stuck ? { stuck } : {});
    if (!step) {
      run = null;
      stuck = null;
      chainFor("");
      return { action: [], feedback: { goal }, up: { step: null, ...report() }, trace };
    }
    const done = parse(step.doneWhen);
    trace.step = { index, text: step.text, ...(step.skill ? { skill: step.skill, ...(step.target ? { target: step.target } : {}) } : {}) };
    if (!done) {
      // Not a step the code can judge: words for the area below, as before.
      run = null;
      stuck = null;
      chainFor("");
      if (step.doneWhen) trace.unread = { doneWhen: step.doneWhen };
      return { action: [], feedback: { goal }, up: { step: index, as: "words", ...report() }, trace };
    }
    const key = keyOf(index, step);
    if (run?.key !== key) {
      run = begin(key, now);
      stuck = null;
    }
    chainFor(key);
    if (mayFinish && index < goal.steps.length && ws.goal?.setAt === goal.setAt && done.holds(ws)) {
      ws.finishStep();
      trace.advanced = { step: index, why: `done when: ${done.text}` };
      const chain = chainFinished(ws, done.text);
      if (chain !== undefined) trace.chain = chain;
      // On to the next step in the same tick (it may finish next tick at the soonest).
      return carryOut(ws, ws.goal ?? goal, false, trace);
    }
    const problem = step.skill ? options.skillProblem(step.skill) : null;
    if (problem) trace.skillProblem = `${step.skill}: ${problem}`;
    const skill = step.skill && !problem ? step.skill : null;
    const giveUp = parse(step.giveUpWhen);
    if (step.giveUpWhen && !giveUp) trace.unread = { giveUpWhen: step.giveUpWhen };
    run = counted(run, step, ws.recentEvents);
    const running = skill !== null && ws.current?.skill === skill;
    // A skill that is running is timed from when it started.
    if (running) run = { ...run, since: Math.max(run.since, ws.current!.startedAt) };
    const why = stuckWhy(run, skill, now, { giveUp: giveUp?.holds(ws) ? giveUp.text : null, usualMs: skill ? (options.usualMs?.(skill, now) ?? null) : null, running, rests: skill !== null && (options.rests?.(skill) ?? false) });
    // One report at a time: a step that goes on being stuck is reported again only after a while.
    if (why && (!stuck || now - stuck.at >= REPORT_AGAIN_MS)) {
      stuck = { step: index, text: step.text, why, at: now };
      trace.stuck = { step: index, why };
      run = { ...begin(key, now), seenTo: run.seenTo };
    }
    const focus: Feedback = { goal, step: skill ? null : { index, text: step.text } };
    if (!skill) return { action: [], feedback: focus, up: { step: index, as: "focus", ...report() }, trace };
    const urgency = strength * Math.min(goal.priority, MOST_URGENCY) * (options.weightOf?.(goal, ws) ?? 1);
    const able = options.canStart(skill, step.target, ws);
    if (!able) trace.cannotStart = skill;
    const action: Proposal[] = able && urgency > 0 ? [{ action: { skill, ...(step.target ? { target: step.target } : {}) }, urgency, reason: `step ${index + 1} of the goal: ${step.text}` }] : [];
    return { action, feedback: focus, up: { step: index, as: "skill", ...report() }, trace };
  }

  return {
    name,
    layer,
    everyMs: 0,
    input: name,
    run({ ws, feedback }) {
      const goal = feedback?.goal ?? null;
      // Off, asleep, or nothing to work toward: it says nothing, so the goal passes straight through to the area below.
      if (strength > 0 && !options.paused?.(ws)) follow(ws);
      if (!(strength > 0) || !goal || options.paused?.(ws)) {
        if (!goal) {
          run = null;
          stuck = null;
          chainFor("");
        }
        return { action: [] };
      }
      return carryOut(ws, goal, true, {});
    },
  };
}
