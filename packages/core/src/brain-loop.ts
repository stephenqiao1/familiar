import type {
  Action,
  Arbiter,
  Candidate,
  Proposal,
  Region,
  RegionLog,
  RunningSkill,
  State,
  TickLog,
} from "@familiar/contracts";
import { clamp01, createWorkspace, type WorkspaceStore } from "./workspace.js";

export interface BrainLoopOptions {
  /** The brain: every region that may propose actions or write to the workspace. */
  regions: Region[];
  /** Picks one proposal per tick. */
  arbiter: Arbiter;
  getState: () => State;
  /** The skill running right now. Default: always null. */
  current?: () => RunningSkill | null;
  /** May return a promise; the tick waits for it before logging. */
  onAction: (action: Action) => void | Promise<void>;
  logger: { log(entry: TickLog): void };
  /** Shared memory. Default: a new one (reachable as `loop.workspace`). */
  workspace?: WorkspaceStore;
  intervalMs?: number;
  /** Where tick errors go. Default: console.error. */
  onError?: (error: unknown, tick: number) => void;
  /**
   * If given, the state is checked every `watchMs` between ticks, and a tick runs at once when
   * this returns true for (state at the last tick, current state).
   */
  isSignificantChange?: (prev: State, next: State) => boolean;
  /** How often to check for a significant change. Default: 100 ms. */
  watchMs?: number;
  /** Minimum time between two ticks. Default: 150 ms. */
  minGapMs?: number;
}

export interface BrainLoop {
  workspace: WorkspaceStore;
  start(): void;
  /** Stops scheduling ticks, aborts background regions, and resolves once everything has settled. */
  stop(): Promise<void>;
}

interface Background {
  running: Promise<void> | null;
  lastStart: number;
  /** Proposals from the latest finished run; they stay in play until the next run finishes. */
  proposals: Proposal[];
}

/**
 * Runs one tick every `intervalMs`, or sooner on a significant change. A tick:
 *   1. reads the state into the workspace,
 *   2. starts any background region that is due (never waiting for it),
 *   3. runs every per-tick region at once,
 *   4. lets the arbiter pick among their proposals and the background regions' latest ones,
 *   5. acts on the winner (or keeps going if there is none) and logs everything.
 * If the arbiter can tell the winner early (e.g. a full-urgency reflex), the action starts at
 * once, without waiting for slower regions. Ticks never overlap and are at least `minGapMs` apart.
 */
export function createBrainLoop(options: BrainLoopOptions): BrainLoop {
  const {
    regions,
    arbiter,
    getState,
    current = () => null,
    onAction,
    logger,
    workspace = createWorkspace(),
    intervalMs = 500,
    onError = (error, tick) => console.error(`[brain] tick ${tick} failed:`, error),
    isSignificantChange,
    watchMs = 100,
    minGapMs = 150,
  } = options;

  const names = new Set<string>();
  for (const r of regions) {
    if (names.has(r.name)) throw new Error(`Two regions are named "${r.name}"`);
    names.add(r.name);
  }

  const perTick = regions.filter((r) => r.everyMs <= 0);
  const background = new Map<Region, Background>(
    regions.filter((r) => r.everyMs > 0).map((r) => [r, { running: null, lastStart: -Infinity, proposals: [] }]),
  );
  const finishedBackground: RegionLog[] = [];
  const controllers = new Set<AbortController>();

  let regular: ReturnType<typeof setTimeout> | undefined;
  let watch: ReturnType<typeof setInterval> | undefined;
  let running: Promise<void> | undefined;
  let stopped = false;
  let lastStart = -Infinity;
  let lastState: State | undefined;
  let tick = 0;

  function readState(): { state: State; encodeMs: number } {
    const started = performance.now();
    const state = getState();
    return { state, encodeMs: performance.now() - started };
  }

  /** Runs one region, never throwing: failures and timeouts become `error` in the log. */
  async function runRegion(region: Region): Promise<RegionLog> {
    const started = performance.now();
    const controller = new AbortController();
    controllers.add(controller);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const base = { region: region.name, layer: region.layer };
    try {
      const run = Promise.resolve().then(() => region.run(workspace.viewFor(region.name), controller.signal));
      const timeout =
        region.timeoutMs === undefined
          ? []
          : [
              new Promise<never>((_, reject) => {
                timer = setTimeout(() => {
                  controller.abort(new Error("timeout"));
                  reject(new Error(`timed out after ${region.timeoutMs} ms`));
                }, region.timeoutMs);
              }),
            ];
      const output = await Promise.race([run, ...timeout]);
      const proposals = output.proposals.map((p) => ({ ...p, urgency: clamp01(p.urgency) }));
      return { ...base, ms: performance.now() - started, proposals, ...(output.trace ? { trace: output.trace } : {}) };
    } catch (error) {
      return { ...base, ms: performance.now() - started, proposals: [], error: errorMessage(error) };
    } finally {
      clearTimeout(timer);
      controllers.delete(controller);
    }
  }

  function startDueBackground(): void {
    const now = performance.now();
    for (const [region, bg] of background) {
      if (bg.running || now - bg.lastStart < region.everyMs) continue;
      bg.lastStart = now;
      bg.running = runRegion(region).then((log) => {
        bg.proposals = log.proposals;
        bg.running = null;
        if (!stopped) finishedBackground.push({ ...log, background: true });
      });
    }
  }

  async function runTick(n: number, { state, encodeMs }: { state: State; encodeMs: number }): Promise<void> {
    const timestamp = Date.now();
    const started = performance.now();
    lastState = state;
    workspace.update(state, current());
    startDueBackground();

    const candidates: Candidate[] = [];
    for (const [region, bg] of background) candidates.push(...bg.proposals.map((p) => candidate(region, p)));
    const logs = finishedBackground.splice(0);
    const pending = new Set(perTick);

    let early: Candidate | null = null;
    let acting: Promise<void> | undefined;
    let decideMs = 0;
    const settleEarly = () => {
      if (early || !arbiter.settledEarly) return;
      early = arbiter.settledEarly(candidates, [...pending].map((r) => r.layer));
      if (!early) return;
      decideMs = performance.now() - started;
      const action = early.action;
      acting = (async () => onAction(action))();
    };

    settleEarly();
    await Promise.all(
      perTick.map(async (region) => {
        const log = await runRegion(region);
        pending.delete(region);
        logs.push(log);
        candidates.push(...log.proposals.map((p) => candidate(region, p)));
        settleEarly();
      }),
    );

    const winner = early ?? arbiter.pick(candidates);
    const action: Action = winner?.action ?? { keepGoing: true };
    if (acting) {
      await acting;
    } else {
      decideMs = performance.now() - started;
      await onAction(action);
    }

    logs.sort((a, b) => a.layer - b.layer);
    logger.log({
      tick: n,
      timestamp,
      state,
      encodeMs,
      decideMs,
      regions: logs,
      winner,
      action,
      goal: workspace.goal(),
      signals: workspace.signals(),
    });
  }

  function startTick(read?: { state: State; encodeMs: number }): void {
    scheduleRegular();
    if (running || Date.now() - lastStart < minGapMs) return;
    lastStart = Date.now();
    const n = tick++;
    running = Promise.resolve()
      .then(() => runTick(n, read ?? readState()))
      .catch((error: unknown) => onError(error, n))
      .finally(() => {
        running = undefined;
      });
  }

  function scheduleRegular(): void {
    clearTimeout(regular);
    if (!stopped) regular = setTimeout(() => startTick(), intervalMs);
  }

  function checkForChange(): void {
    if (running || !lastState || !isSignificantChange || Date.now() - lastStart < minGapMs) return;
    try {
      const read = readState();
      if (isSignificantChange(lastState, read.state)) startTick(read);
    } catch (error) {
      onError(error, tick);
    }
  }

  return {
    workspace,
    start() {
      if (regular) return;
      stopped = false;
      scheduleRegular();
      if (isSignificantChange) watch = setInterval(checkForChange, watchMs);
    },
    async stop() {
      stopped = true;
      clearTimeout(regular);
      clearInterval(watch);
      regular = undefined;
      watch = undefined;
      await running;
      for (const c of controllers) c.abort(new Error("stopped"));
      await Promise.all([...background.values()].map((bg) => bg.running));
    },
  };
}

function candidate(region: Region, proposal: Proposal): Candidate {
  return { ...proposal, region: region.name, layer: region.layer };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
