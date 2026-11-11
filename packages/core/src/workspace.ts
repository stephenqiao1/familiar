import type { Goal, RunningSkill, Signal, SkillEvent, State, Workspace } from "@familiar/contracts";

const MAX_EVENTS = 20;

/** Owns the brain's shared memory. Regions only ever see `viewFor(name)`. */
export interface WorkspaceStore {
  /** Sets this tick's state and running skill. */
  update(state: State, current: RunningSkill | null): void;
  /** Records a skill lifecycle event, keeping the last 20. */
  addEvent(event: SkillEvent): void;
  /** The workspace as one region sees it; its writes are stamped with the region's name. */
  viewFor(region: string): Workspace;
  goal(): Goal | null;
  signals(): Record<string, Signal>;
}

const EMPTY_STATE: State = { schemaVersion: 0, tick: -1, timestamp: 0, data: {} };

export function createWorkspace(): WorkspaceStore {
  let state = EMPTY_STATE;
  let current: RunningSkill | null = null;
  let goal: Goal | null = null;
  const signals: Record<string, Signal> = {};
  const events: SkillEvent[] = [];

  return {
    update(nextState, nextCurrent) {
      state = nextState;
      current = nextCurrent;
    },
    addEvent(event) {
      events.push(event);
      if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
    },
    viewFor(region) {
      return {
        get state() {
          return state;
        },
        get current() {
          return current;
        },
        get goal() {
          return goal;
        },
        get signals() {
          return { ...signals };
        },
        get recentEvents() {
          return [...events];
        },
        setGoal({ text, steps, reason }) {
          goal = { text, steps: [...steps], reason, setBy: region, setAt: Date.now() };
        },
        setSignal(name, value) {
          signals[name] = { value: clamp01(value), source: region, at: Date.now() };
        },
      };
    },
    goal: () => goal,
    signals: () => ({ ...signals }),
  };
}

export function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}
