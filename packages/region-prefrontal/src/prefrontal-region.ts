import type { Goal, HoldBack, NameRequest, Plan, Planner, Region, Step, Workspace } from "@familiar/contracts";
import type { Area } from "@familiar/neocortex";
import type { Notes } from "./notes.js";

export interface PrefrontalOptions {
  /** What makes the plan (an LLM, or a stand-in). */
  planner: Planner;
  /** The situation in plain words, for the planner. */
  describe(ws: Workspace): string;
  /** Extra guidance for this plan: an instruction added to the situation, and a cap on steps. Default: none. */
  guidance?(ws: Workspace): { instruction?: string; maxSteps?: number };
  /** True to skip planning for now (e.g. while an alarm has the planner offline). Default: never. */
  paused?(ws: Workspace): boolean;
  /** True to plan at the next tick without waiting (e.g. to re-plan after an alarm). Default: never. */
  wake?(ws: Workspace): boolean;
  /**
   * A reason from the cortex to plan at once (a step is stuck): what to tell the planner, and a
   * key that says which reason it is, so each is answered once. Such plans are at least
   * `URGENT_GAP_MS` after the plan before. With `wait` the plan is not brought forward: the note
   * goes with the next plan in its turn (the trace says `told`, not `woken`). Default: never.
   */
  urgent?(ws: Workspace): { key: string | number; note: string; wait?: boolean } | null;
  /** Whether code can tell when this step is finished (it has a "done when" that can be read): the planner's own count does not move past such a step. Default: none can. */
  checkable?(step: Step): boolean;
  /**
   * The planner's notes (its working memory): shown to it with each plan, and changed by what the
   * plan says of them. While a protected goal keeps the plan out, the notes are held as they are. Default: none are kept.
   */
  notes?: Notes;
  /**
   * Routines waiting for a name (a chain of abilities that has worked often enough to be kept as
   * a skill). After a plan, the planner is asked once to name the next one in a word and describe
   * it in a line; `named` is told what it said (null if it could not say).
   */
  naming?: { next(): NameRequest | null; named(request: NameRequest, given: { name: string; description: string } | null): string };
  /**
   * A review, when one is due: at rest, in place of one plan, the planner is shown its notes, the
   * day's notable memories and the feeling, and may only change its notes. `key` says which spell
   * of rest it is, so each has one review; reviews are at least `REVIEW_EVERY_MS` apart. With no
   * goal standing the plan comes first (a review never sets a goal). Needs `notes` and a planner
   * that can review. A review that is due goes ahead even while `paused` holds plans back, so
   * whoever gives this says when not to (asleep). Default: never.
   */
  review?(ws: Workspace): { key: string | number; memories: string[]; feeling: string | null } | null;
  /** How often to re-plan, in ms. Default: 15 000. */
  everyMs?: number;
  /** Give up on a plan after this long. Default: 60 000. */
  timeoutMs?: number;
  /** Default: "prefrontal". */
  name?: string;
  /** Default: 2 (the slowest layer). */
  layer?: number;
}

/** A goal carries at most this many loaded responses. */
const MAX_IF_THEN = 3;
/** A plan may ask to be told in full about this many kinds or ids of things. */
const MAX_DETAIL = 5;
/** A goal carries at most this many expectations. */
const MAX_EXPECT = 3;
/** A plan the cortex asked for at once comes no sooner than this after the plan before. */
export const URGENT_GAP_MS = 5000;
/** One review comes no sooner than this after the one before. */
export const REVIEW_EVERY_MS = 600_000;

/** A record of lists without the empty ones, for the trace. */
const trimmed = <T extends object>(lists: T) => Object.fromEntries(Object.entries(lists).filter(([, list]) => (list as unknown[]).length > 0));
const asStep = (step: string | Step): Step => (typeof step === "string" ? { text: step } : step);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * How many steps are finished after a plan that reports `reported`: the planner's count moves the
 * goal on only past steps the code cannot judge, and stops at the first one it can.
 */
export function stepsDoneAfter(shown: Goal, reported: number, checkable: (step: Step) => boolean): number {
  let done = shown.stepsDone;
  while (done < reported && done < shown.specs.length && !checkable(shown.specs[done]!)) done++;
  return done;
}

/** A plan's hold-backs: one the goal already held, with the same end, keeps the time and the step it started at (so planning again does not start it afresh). */
export function heldOver(wanted: NonNullable<Plan["holdBack"]>, shown: Goal | null): (string | HoldBack)[] {
  return wanted.map((held) => {
    if (typeof held === "string") return held;
    const before = shown?.holdBack.find((h) => h.name === held.name && h.until === held.until && h.until !== undefined);
    return before ? { ...held, ...(before.step === undefined ? {} : { step: before.step }), ...(before.since === undefined ? {} : { since: before.since }) } : held;
  });
}

/**
 * The slow, deliberate region: in the background, describes the situation to a planner and
 * writes the plan into the workspace as the goal. It only sets goals; it never proposes actions.
 * Faster regions read the goal and decide how to pursue it.
 *
 * The planner also says how many steps of the goal it was shown are finished. The count carries
 * over while the steps stay the same and starts again at 0 when they change; whenever it goes
 * up, the goal notes the time a step was last finished.
 *
 * A plan can also tune the fastest layer: `ifThen` loads responses to fire on sight, and
 * `holdBack` names soft reflexes to damp. Both last only as long as the goal that set them.
 *
 * A step may come in full (a skill, a target, a "done when"): the motor area carries those out
 * and finishes them itself, so the planner's count only moves past steps the code cannot judge.
 * The goal is offered to the workspace: if the goal channel keeps the standing one, the trace says why.
 */
export function createPrefrontalRegion(options: PrefrontalOptions): Region {
  const { planner, describe, everyMs = 15_000, timeoutMs = 60_000, name = "prefrontal", layer = 2 } = options;
  let lastRun = -Infinity;
  let answered: string | number | null = null;
  let reviewed: { key: string | number | null; at: number } = { key: null, at: -Infinity };
  /** The review to do in place of this plan, if one is due. */
  const reviewNow = (ws: Workspace) => {
    if (!options.notes || !planner.review || ws.goal === null) return null;
    const review = options.review?.(ws) ?? null;
    return review && review.key !== reviewed.key && Date.now() - reviewed.at >= REVIEW_EVERY_MS ? review : null;
  };
  /** The cortex's reason to plan at once, if there is one not yet answered and the last plan is long enough ago. */
  const urgentNow = (ws: Workspace) => {
    const urgent = options.urgent?.(ws) ?? null;
    // (One that can wait does not bring the plan forward: its note goes with the next plan in turn.)
    return urgent && urgent.key !== answered && (urgent.wait || Date.now() - lastRun >= URGENT_GAP_MS) ? urgent : null;
  };
  return {
    name,
    layer,
    everyMs,
    timeoutMs,
    dueNow: (ws) => !options.paused?.(ws) && ((options.wake?.(ws) ?? false) || ((urgent) => urgent !== null && !urgent.wait)(urgentNow(ws))),
    async run(ws, signal) {
      // A review that is due does not wait on `paused`: it is what a mind at rest does, and at rest plans are few.
      const review = reviewNow(ws);
      if (!review && options.paused?.(ws)) return { proposals: [], trace: { paused: true } };
      if (review) {
        // Marked before it is asked, so one that fails is not asked again this spell.
        reviewed = { key: review.key, at: Date.now() };
        lastRun = Date.now();
        const shown = { notes: options.notes!.list().map(({ key, text }) => ({ key, text })), memories: review.memories, feeling: review.feeling };
        const said = await planner.review!(shown, signal);
        // Its word on the notes counts as a plan's would; the goal and everything else stay as they are.
        const change = options.notes!.plan(said.notes ?? [], said.dropNotes ?? []);
        return { proposals: [], trace: { planner: planner.name, review: { shown, said, notes: { ...trimmed(change), now: options.notes!.list().map((n) => n.key) } } } };
      }
      const woken = urgentNow(ws);
      if (woken) answered = woken.key;
      lastRun = Date.now();
      const { instruction, maxSteps } = options.guidance?.(ws) ?? {};
      const cap = maxSteps === undefined ? [] : [`Plan at most ${maxSteps} steps.`];
      const situation = [describe(ws), ...(instruction ? [instruction] : []), ...cap].join("\n");
      const shown = ws.goal;
      const noted = options.notes?.list().map(({ key, text }) => ({ key, text }));
      const plan = await planner.plan({ situation, currentGoal: shown, ...(noted ? { notes: noted } : {}), ...(woken ? { woken: woken.note } : {}) }, signal);
      const steps = plan.steps.slice(0, maxSteps).map(asStep);
      const reported = Math.min(shown?.steps.length ?? 0, Math.max(0, Math.round(plan.stepsDone ?? 0)));
      // The goal may have moved on while the planner thought (the motor area finishes steps itself): go by how it stands now.
      const now = ws.goal?.setAt === shown?.setAt ? ws.goal : shown;
      const stepsDone = now ? stepsDoneAfter(now, reported, options.checkable ?? (() => false)) : 0;
      const advanced = now !== null && stepsDone > now.stepsDone;
      const sameSteps = now !== null && same(now.specs, steps);
      const refused = ws.setGoal({
        text: plan.goal,
        steps,
        reason: plan.reason,
        ...(plan.priority === undefined ? {} : { priority: plan.priority }),
        wants: plan.wants ?? [],
        watchFor: plan.watchFor ?? [],
        ifThen: (plan.ifThen ?? []).slice(0, MAX_IF_THEN),
        holdBack: heldOver(plan.holdBack ?? [], now),
        detail: (plan.detail ?? []).slice(0, MAX_DETAIL),
        expect: (plan.expect ?? []).slice(0, MAX_EXPECT),
        stepsDone: sameSteps ? stepsDone : 0,
        stepDoneAt: advanced ? Date.now() : (now?.stepDoneAt ?? null),
      });
      // The goal channel gates the notes too: a plan a protected goal kept out changes nothing it holds.
      const held = Boolean(refused) && ws.goal?.protected === true;
      const notes = options.notes && (held ? { held: true } : { ...trimmed(options.notes.plan(plan.notes ?? [], plan.dropNotes ?? [])), now: options.notes.list().map((n) => n.key) });
      // A routine that has earned a name is named now, once: one short question beside the plan.
      const routine = options.naming?.next() ?? null;
      let named: Record<string, unknown> | undefined;
      if (routine) {
        const given = await (planner.nameRoutine?.(routine, signal) ?? Promise.resolve(null)).catch(() => null);
        named = { routine: routine.steps, doneWhen: routine.doneWhen, ...(given ? { given } : {}), as: options.naming!.named(routine, given) };
      }
      return { proposals: [], trace: { planner: planner.name, situation, plan, ...(woken ? { [woken.wait ? "told" : "woken"]: woken.note } : {}), ...(refused ? { goalKept: refused } : advanced ? { stepFinished: true } : {}), ...(notes ? { notes } : {}), ...(named ? { named } : {}) } };
    },
  };
}

/**
 * The prefrontal cortex as an area: the same planning, in the background. What it holds is said
 * again every tick: the goal as it now stands is its feedback to the areas below, and the goal's
 * `detail` is its ask of the thalamus. It makes no proposals and reports nothing upward (it is the top).
 */
export function createPrefrontalArea(options: PrefrontalOptions): Area {
  const region = createPrefrontalRegion(options);
  return {
    name: region.name,
    layer: region.layer,
    everyMs: region.everyMs,
    ...(region.timeoutMs === undefined ? {} : { timeoutMs: region.timeoutMs }),
    dueNow: (ws) => region.dueNow?.(ws) ?? false,
    input: region.name,
    async run({ ws }, signal) {
      const { trace } = await region.run(ws, signal);
      return { action: [], ...(trace ? { trace } : {}) };
    },
    hold: (ws) => ({ feedback: { goal: ws.goal }, ask: ws.goal?.detail ?? [] }),
  };
}
