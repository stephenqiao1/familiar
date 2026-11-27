import type { Feedback, Proposal, State, Workspace } from "@familiar/contracts";

/** What an area is handed each time it runs: its two inward ports. */
export interface AreaInput {
  ws: Workspace;
  /** Input: the state as the thalamus built it for this area (the full state if it built none). */
  view: State;
  /** Feedback: what the nearest area above it on the ladder tells it, or null with none above. */
  feedback: Feedback | null;
}

/** What an area holds between runs and tells the others: its feedback for the area below, and its ask of the thalamus. */
export interface Standing {
  /** What it tells the area below. Default: nothing. */
  feedback?: Feedback | null;
  /** Ask: what it wants the thalamus to send it next. Default: nothing more. */
  ask?: string[];
}

/** What an area gives back each time it runs: its three outward ports, and what it tells the area below. */
export interface AreaOutput extends Standing {
  /** Action: the proposals it makes, weighed by the basal ganglia like any others. */
  action: Proposal[];
  /** Up: what it reports to the area above (what it found, and any surprise). Default: nothing. */
  up?: Record<string, unknown> | null;
  /** Anything worth keeping in the log. */
  trace?: Record<string, unknown>;
}

/**
 * One area of the cortex. Every area is built the same way and differs only in what it is wired
 * to: where it sits on the ladder, which view it reads, and what its `run` does with them.
 * Areas never call each other: what one says to another goes through `ws.cortex`.
 */
export interface Area {
  /** Unique; also its name on the ladder and in `ws.cortex`. */
  name: string;
  /** Speed rank, as for any region. */
  layer: number;
  /** 0: every tick. Above 0: in the background at most this often. */
  everyMs: number;
  timeoutMs?: number;
  /** For a background area: true to run at the next tick without waiting. */
  dueNow?(ws: Workspace): boolean;
  /** Input: the name of the thalamus view it reads. */
  input: string;
  run(input: AreaInput, signal: AbortSignal): AreaOutput | Promise<AreaOutput>;
  /**
   * For a background area: what it holds between runs, said again every tick from the workspace
   * as it now stands (so the areas below never read a stale goal). An every-tick area says it in `run`.
   */
  hold?(ws: Workspace): Standing;
}
