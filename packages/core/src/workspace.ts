import type { Attended, Goal, Needs, PlaceNow, RunningSkill, Signal, SkillEvent, State, Workspace } from "@familiar/contracts";

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
  attended(): Attended | null;
  needs(): Needs | null;
  place(): PlaceNow | null;
}

const EMPTY_STATE: State = { schemaVersion: 0, tick: -1, timestamp: 0, data: {} };

export function createWorkspace(): WorkspaceStore {
  let state = EMPTY_STATE;
  let current: RunningSkill | null = null;
  let goal: Goal | null = null;
  const signals: Record<string, Signal> = {};
  const events: SkillEvent[] = [];
  let attended: Attended | null = null;
  let needs: Needs | null = null;
  let place: PlaceNow | null = null;
  const views = new Map<string, State>();

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
        get attended() {
          return attended;
        },
        get needs() {
          return needs;
        },
        get place() {
          return place;
        },
        get recentEvents() {
          return [...events];
        },
        setGoal({ text, steps, reason, wants = [], watchFor = [], ifThen = [], holdBack = [], detail = [], stepsDone = 0, stepDoneAt = null }) {
          const copies = { steps: [...steps], wants: wants.map((w) => ({ ...w })), watchFor: [...watchFor], ifThen: ifThen.map((r) => ({ ...r })), holdBack: [...holdBack], detail: [...detail] };
          goal = { text, reason, ...copies, stepsDone, stepDoneAt, setBy: region, setAt: Date.now() };
        },
        clearGoal() {
          goal = null;
        },
        setSignal(name, value) {
          signals[name] = { value: clamp01(value), source: region, at: Date.now() };
        },
        setAttended(next) {
          attended = next && { ...next };
        },
        view: (reader) => views.get(reader) ?? state,
        setView(reader, view) {
          if (view) views.set(reader, view);
          else views.delete(reader);
        },
        setNeeds(next) {
          needs = next && { ...next, readings: next.readings.map((r) => ({ ...r })) };
        },
        setPlace(next) {
          place = next && { ...next };
        },
      };
    },
    goal: () => goal,
    signals: () => ({ ...signals }),
    attended: () => attended,
    needs: () => needs,
    place: () => place,
  };
}

export function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}
