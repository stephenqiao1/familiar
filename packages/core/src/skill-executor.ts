import type { BodyPart, RunningSkill, Skill, SkillEvent, SkillResult } from "@familiar/contracts";

export interface SkillExecutorOptions<Ctx> {
  skills: Skill<Ctx>[];
  ctx: Ctx;
  onEvent: (event: SkillEvent) => void;
  /** How long a skill may run before it is stopped (it then fails with "timeout"). Default: 120 000. */
  defaultTimeoutMs?: number;
  /** Events of a skill run alongside the main one. Default: dropped. */
  onSideEvent?: (event: SkillEvent) => void;
}

export interface SkillExecutor {
  /** Interrupts the running skill, then starts this one. Resolves once it has started (or been rejected). */
  start(name: string, target?: string): Promise<void>;
  /** Aborts the running skill and resolves once it has settled. */
  interrupt(): Promise<void>;
  /** Gives up on the running skill: aborts it, and it ends as failed with this reason. */
  abandon(reason: string): Promise<void>;
  current(): RunningSkill | null;
  /**
   * Runs a second skill at the same time as the main one, if the two use different body parts.
   * It is refused (silently) if they share a part, and stopped if a later main skill needs its parts.
   */
  startAlongside(name: string, target?: string): Promise<void>;
  /** Adds a skill it can run from now on (one the bot has just saved for itself). */
  learn(skill: Skill<unknown>): void;
  /** Takes a skill away: it can no longer be started. */
  forget(name: string): void;
}

interface Run extends RunningSkill {
  controller: AbortController;
  /** Set when the run was stopped as a failure (timed out or given up on). */
  failure?: string;
  settled: Promise<void>;
}

const ALL_PARTS: BodyPart[] = ["head", "legs", "hands"];
/** A skill that declares no parts uses the whole body. */
const partsOf = (skill: { parts?: BodyPart[] } | undefined) => skill?.parts ?? ALL_PARTS;
const share = (a: BodyPart[], b: BodyPart[]) => a.some((part) => b.includes(part));

/**
 * Runs one skill at a time, plus at most one more alongside it that uses different body parts.
 * Never throws: every outcome is reported through `onEvent` (or `onSideEvent`).
 */
export function createSkillExecutor<Ctx>(options: SkillExecutorOptions<Ctx>): SkillExecutor {
  const { ctx, onEvent, defaultTimeoutMs = 120_000 } = options;
  const skills = new Map(options.skills.map((s) => [s.name, s]));
  let running: Run | null = null;
  /** The skill running alongside the main one, if any. */
  let side: Run | null = null;
  // start/interrupt calls run one after another, so they never interleave.
  let queue: Promise<void> = Promise.resolve();

  function emit(event: Omit<SkillEvent, "timestamp">, alongside = false): void {
    const full: SkillEvent = { ...event, ...(alongside ? { alongside: true as const } : {}), timestamp: Date.now() };
    if (full.target === undefined) delete full.target;
    if (full.reason === undefined) delete full.reason;
    if (full.changes === undefined) delete full.changes;
    try {
      if (alongside) options.onSideEvent?.(full);
      else onEvent(full);
    } catch (error) {
      console.error("[skills] onEvent failed:", error);
    }
  }

  function enqueue(step: () => Promise<void>): Promise<void> {
    queue = queue.then(step);
    return queue;
  }

  async function stopRunning(): Promise<void> {
    if (!running) return;
    running.controller.abort(new Error("interrupted"));
    await running.settled;
  }

  function fail(run: Run, reason: string): void {
    run.failure = reason;
    run.controller.abort(new Error(reason));
  }

  async function stopSide(): Promise<void> {
    if (!side) return;
    side.controller.abort(new Error("interrupted"));
    await side.settled;
  }

  function launch(skill: Skill<Ctx>, target: string | undefined, alongside = false): void {
    const controller = new AbortController();
    const run: Run = { skill: skill.name, target, startedAt: Date.now(), controller, settled: Promise.resolve() };
    const timer = setTimeout(() => fail(run, "timeout"), defaultTimeoutMs);
    if (alongside) side = run;
    else running = run;
    emit({ skill: skill.name, target, type: "started" }, alongside);

    run.settled = settle(skill, target, controller.signal).then((result) => {
      clearTimeout(timer);
      if (running === run) running = null;
      if (side === run) side = null;
      emit({ skill: skill.name, target, ...finalResult(result, controller.signal.aborted, run.failure) }, alongside);
    });
  }

  async function settle(skill: Skill<Ctx>, target: string | undefined, signal: AbortSignal): Promise<SkillResult> {
    try {
      return await skill.run(ctx, target, signal);
    } catch (error) {
      return { status: "failed", reason: errorMessage(error) };
    }
  }

  return {
    start(name, target) {
      return enqueue(async () => {
        if (running && running.skill === name && running.target === target) return;

        const skill = skills.get(name);
        if (!skill) return emit({ skill: name, target, type: "failed", reason: "unknown skill" });

        let ok: boolean;
        try {
          ok = skill.canRun(ctx, target);
        } catch (error) {
          return emit({ skill: name, target, type: "failed", reason: errorMessage(error) });
        }
        if (!ok) return emit({ skill: name, target, type: "failed", reason: "cannot run" });

        await stopRunning();
        // The main skill always wins: whatever runs alongside gives way if it needs the same parts.
        if (side && share(partsOf(skills.get(side.skill)), partsOf(skill))) await stopSide();
        launch(skill, target);
      });
    },
    startAlongside(name, target) {
      return enqueue(async () => {
        const skill = skills.get(name);
        if (!skill || (side && side.skill === name && side.target === target)) return;
        if (running && share(partsOf(skill), partsOf(skills.get(running.skill)))) return;
        try {
          if (!skill.canRun(ctx, target)) return;
        } catch {
          return;
        }
        await stopSide();
        launch(skill, target, true);
      });
    },
    interrupt() {
      return enqueue(async () => {
        await stopSide();
        await stopRunning();
      });
    },
    abandon(reason) {
      return enqueue(async () => {
        if (!running) return;
        fail(running, reason);
        await running.settled;
      });
    },
    current() {
      return running && { skill: running.skill, target: running.target, startedAt: running.startedAt };
    },
    learn: (skill) => void skills.set(skill.name, skill as Skill<Ctx>),
    forget: (name) => void skills.delete(name),
  };
}

/** A skill that finished "done" keeps that result; otherwise an abort decides the outcome. */
function finalResult(result: SkillResult, aborted: boolean, failure: string | undefined): Pick<SkillEvent, "type" | "reason" | "changes" | "aimedAt"> {
  const changes = { changes: result.changes, ...(result.aimedAt === undefined ? {} : { aimedAt: result.aimedAt }) };
  if (result.status === "done" || !aborted) return { type: result.status, reason: result.reason, ...changes };
  if (failure !== undefined) return { type: "failed", reason: failure, ...changes };
  return { type: "interrupted", reason: result.reason, ...changes };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
