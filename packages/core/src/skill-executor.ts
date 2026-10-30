import type { RunningSkill, Skill, SkillEvent, SkillResult } from "@familiar/contracts";

export interface SkillExecutorOptions<Ctx> {
  skills: Skill<Ctx>[];
  ctx: Ctx;
  onEvent: (event: SkillEvent) => void;
  defaultTimeoutMs?: number;
}

export interface SkillExecutor {
  /** Interrupts the running skill, then starts this one. Resolves once it has started (or been rejected). */
  start(name: string, target?: string): Promise<void>;
  /** Aborts the running skill and resolves once it has settled. */
  interrupt(): Promise<void>;
  current(): RunningSkill | null;
}

interface Run extends RunningSkill {
  controller: AbortController;
  settled: Promise<void>;
}

/** Runs at most one skill at a time. Never throws: every outcome is reported through `onEvent`. */
export function createSkillExecutor<Ctx>(options: SkillExecutorOptions<Ctx>): SkillExecutor {
  const { ctx, onEvent, defaultTimeoutMs = 120_000 } = options;
  const skills = new Map(options.skills.map((s) => [s.name, s]));
  let running: Run | null = null;
  // start/interrupt calls run one after another, so they never interleave.
  let queue: Promise<void> = Promise.resolve();

  function emit(event: Omit<SkillEvent, "timestamp">): void {
    const full: SkillEvent = { ...event, timestamp: Date.now() };
    if (full.target === undefined) delete full.target;
    if (full.reason === undefined) delete full.reason;
    try {
      onEvent(full);
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

  function launch(skill: Skill<Ctx>, target: string | undefined): void {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error("timeout"));
    }, defaultTimeoutMs);

    const run: Run = { skill: skill.name, target, startedAt: Date.now(), controller, settled: Promise.resolve() };
    running = run;
    emit({ skill: skill.name, target, type: "started" });

    run.settled = settle(skill, target, controller.signal).then((result) => {
      clearTimeout(timer);
      if (running === run) running = null;
      emit({ skill: skill.name, target, ...finalResult(result, controller.signal.aborted, timedOut) });
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
        launch(skill, target);
      });
    },
    interrupt() {
      return enqueue(stopRunning);
    },
    current() {
      return running && { skill: running.skill, target: running.target, startedAt: running.startedAt };
    },
  };
}

/** A skill that finished "done" keeps that result; otherwise an abort decides the outcome. */
function finalResult(result: SkillResult, aborted: boolean, timedOut: boolean): Pick<SkillEvent, "type" | "reason"> {
  if (result.status === "done" || !aborted) return { type: result.status, reason: result.reason };
  if (timedOut) return { type: "failed", reason: "timeout" };
  return { type: "interrupted", reason: result.reason };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
