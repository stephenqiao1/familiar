import type { BodyPart, Skill, SkillResult } from "@familiar/contracts";

/** One step of a chain: a primitive by name, and what to aim it at. */
export interface ChainStep {
  primitive: string;
  target?: string;
}

/** How one step went. */
export interface StepResult extends SkillResult {
  primitive: string;
  target?: string;
}

/** How a chain went: every step that ran, and where it stopped if it did not finish. */
export interface ChainResult {
  status: SkillResult["status"];
  reason?: string;
  /** The index of the step that failed or was interrupted. */
  stoppedAt?: number;
  steps: StepResult[];
}

/** A skill described as data: a name, a line of description, and the steps to run in order. */
export interface LearnedSkill {
  name: string;
  description: string;
  steps: ChainStep[];
  /** Its test of success: a condition (in the game side's vocabulary) that should be true once it has run. Left out: none. */
  doneWhen?: string;
  /** How many times running it has ended without its test coming true. */
  fails?: number;
  /** Taken off the menu after failing too often. It stays in the file. */
  retired?: boolean;
}

const ALL_PARTS: BodyPart[] = ["head", "legs", "hands"];

/** How a chain is run beyond its steps: how each target is aimed, and how long the body is given to catch up between steps. */
export interface ChainRun<Ctx> {
  /** Turns a step's written target into the one to use now (the game says how). Default: as written. */
  aim?(ctx: Ctx, target: string | undefined): string | undefined;
  /**
   * After the first step, a later step that cannot run yet is waited for this long, in ms, before
   * it counts as failed: what the step before changed (an item now in hand) can take a moment to
   * show. Default: 0 (no waiting).
   */
  settleMs?: number;
}

/** How often a step that cannot run yet is tried again while the body settles. */
const SETTLE_EVERY_MS = 150;
const pause = (ms: number, signal: AbortSignal) => new Promise<void>((resolve) => {
  const timer = setTimeout(resolve, ms);
  signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
});

/**
 * Runs steps in order. Stops at the first one that cannot run, fails or is interrupted, and
 * stops between steps when `signal` fires. Never throws.
 */
export async function runChain<Ctx>(steps: readonly ChainStep[], primitives: readonly Skill<Ctx>[], ctx: Ctx, signal: AbortSignal, how: ChainRun<Ctx> = {}): Promise<ChainResult> {
  const { aim, settleMs = 0 } = how;
  const done: StepResult[] = [];
  const stop = (result: SkillResult, step: ChainStep, index: number): ChainResult => {
    done.push({ ...step, ...result });
    const why = result.reason ? `: ${result.reason}` : "";
    return { status: result.status, reason: `step ${index + 1} (${step.primitive}) ${result.status}${why}`, stoppedAt: index, steps: done };
  };
  for (const [index, written] of steps.entries()) {
    // A target written as a kind ("the nearest chest") is turned into the thing it means now, as the step comes up.
    const target = aim ? aim(ctx, written.target) : written.target;
    const step: ChainStep = { primitive: written.primitive, ...(target === undefined ? {} : { target }) };
    if (signal.aborted) return stop({ status: "interrupted" }, step, index);
    const skill = primitives.find((s) => s.name === step.primitive);
    if (!skill) return stop({ status: "failed", reason: "unknown primitive" }, step, index);
    let result: SkillResult;
    try {
      // Between steps the body may need a moment: a step that cannot run yet is tried again for a little while.
      for (let waited = 0; index > 0 && waited < settleMs && !signal.aborted && !skill.canRun(ctx, step.target); waited += SETTLE_EVERY_MS) await pause(SETTLE_EVERY_MS, signal);
      if (signal.aborted) return stop({ status: "interrupted" }, step, index);
      result = skill.canRun(ctx, step.target) ? await skill.run(ctx, step.target, signal) : { status: "failed", reason: "cannot run" };
    } catch (error) {
      result = { status: "failed", reason: error instanceof Error ? error.message : String(error) };
    }
    if (result.status !== "done") return stop(result, step, index);
    done.push({ ...step, ...result });
  }
  return { status: "done", steps: done };
}

/**
 * Turns a learned skill (data) into a Skill that runs its chain. It can start when its first
 * step can. `tidy` runs when the chain ends, however it ends (e.g. to close a window left open).
 * `how`: how targets are aimed and how long the body is given between steps (see ChainRun).
 */
export function createChainSkill<Ctx>(learned: LearnedSkill, primitives: readonly Skill<Ctx>[], tidy?: (ctx: Ctx) => void | Promise<void>, how: ChainRun<Ctx> = {}): Skill<Ctx> {
  const { aim } = how;
  const used = learned.steps.map((step) => primitives.find((s) => s.name === step.primitive));
  const parts = ALL_PARTS.filter((part) => used.some((s) => (s?.parts ?? ALL_PARTS).includes(part)));
  const first = learned.steps[0];
  return {
    name: learned.name,
    description: learned.description,
    parts,
    ...(used.some((s) => s?.risky) ? { risky: true } : {}),
    ...(used.some((s) => s?.long) ? { long: true } : {}),
    canRun: (ctx) => first !== undefined && (used[0]?.canRun(ctx, aim ? aim(ctx, first.target) : first.target) ?? false),
    async run(ctx, _target, signal) {
      try {
        const { status, reason, stoppedAt, steps } = await runChain(learned.steps, primitives, ctx, signal, how);
        return { status, ...(reason ? { reason } : {}), changes: { steps, ...(stoppedAt === undefined ? {} : { stoppedAt }) } };
      } finally {
        await tidy?.(ctx);
      }
    },
  };
}

/**
 * Reads learned skills from parsed JSON (a list of { name, description, steps }). Anything
 * malformed, a step naming something that is not in `primitiveNames` (the abilities a chain may
 * be made of), or a name already taken is left out and reported in `problems`. A retired skill
 * is kept (in `retired`) but is not one of `skills`. Learned skills are data, never code.
 */
export function parseLearnedSkills(raw: unknown, primitiveNames: readonly string[], takenNames: readonly string[] = []): { skills: LearnedSkill[]; retired: LearnedSkill[]; problems: string[] } {
  const skills: LearnedSkill[] = [];
  const retired: LearnedSkill[] = [];
  const problems: string[] = [];
  if (raw === null || raw === undefined) return { skills, retired, problems };
  if (!Array.isArray(raw)) return { skills, retired, problems: ["learned skills must be a list"] };
  for (const [i, entry] of raw.entries()) {
    const { name, description, steps, doneWhen, fails, retired: isRetired } = (entry ?? {}) as Partial<LearnedSkill>;
    const label = typeof name === "string" && name ? `"${name}"` : `entry ${i + 1}`;
    if (typeof name !== "string" || !/^[a-z0-9_]+$/.test(name)) problems.push(`${label}: needs a name of lowercase letters, digits and _`);
    else if (takenNames.includes(name) || primitiveNames.includes(name) || [...skills, ...retired].some((s) => s.name === name)) problems.push(`${label}: the name is already taken`);
    else if (!Array.isArray(steps) || steps.length === 0) problems.push(`${label}: needs at least one step`);
    else {
      const bad = steps.find((s) => typeof s?.primitive !== "string" || !primitiveNames.includes(s.primitive) || (s.target !== undefined && typeof s.target !== "string"));
      if (bad) problems.push(`${label}: step ${JSON.stringify(bad)} does not name a primitive`);
      else {
        const more = { ...(typeof doneWhen === "string" && doneWhen ? { doneWhen } : {}), ...(Number.isInteger(fails) && fails! > 0 ? { fails: fails! } : {}) };
        const skill = { name, description: typeof description === "string" ? description : name, steps: steps.map((s) => ({ primitive: s.primitive, ...(s.target === undefined ? {} : { target: s.target }) })), ...more };
        if (isRetired === true) retired.push({ ...skill, retired: true });
        else skills.push(skill);
      }
    }
  }
  return { skills, retired, problems };
}
