import type { AreaPorts, Attended, Feeling, Goal, Trouble, GoalOffer, HoldBack, Needs, PlaceNow, RunningSkill, Signal, SkillEvent, State, Workspace } from "@familiar/contracts";

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
  feeling(): Feeling | null;
  trouble(): Trouble | null;
  cortex(): Record<string, AreaPorts>;
}

const EMPTY_STATE: State = { schemaVersion: 0, tick: -1, timestamp: 0, data: {} };
/** What a goal's priority is when nothing says. */
export const USUAL_PRIORITY = 0.5;

export interface WorkspaceOptions {
  /**
   * The goal channel: asked each time a goal is offered while another stands. A reason (in words)
   * keeps the standing goal; null lets the offered one replace it. Default: every offer replaces.
   */
  goalGate?(offered: Goal, standing: Goal, ws: Workspace): string | null;
}

/** A goal in full from what a region offered: the fields left out take their defaults. */
export function goalFrom(offer: GoalOffer, region: string, now: number): Goal {
  const { text, reason, wants = [], watchFor = [], ifThen = [], detail = [], expect = [], stepsDone = 0, stepDoneAt = null, priority = USUAL_PRIORITY, doneWhen = null } = offer;
  const specs = offer.steps.map((step) => (typeof step === "string" ? { text: step } : { ...step }));
  const holdBack = (offer.holdBack ?? []).map((held): HoldBack => (typeof held === "string" ? { name: held, strength: 1 } : { step: stepsDone, since: now, ...held, strength: clamp01(held.strength) }));
  const copies = { steps: specs.map((s) => s.text), specs, wants: wants.map((w) => ({ ...w })), watchFor: [...watchFor], ifThen: ifThen.map((r) => ({ ...r })), holdBack, detail: [...detail], expect: expect.map((e) => ({ ...e })) };
  return { text, reason, ...copies, priority: clamp01(priority), protected: offer.protected ?? false, doneWhen, stepsDone, stepDoneAt, setBy: region, setAt: now };
}

export function createWorkspace(options: WorkspaceOptions = {}): WorkspaceStore {
  let state = EMPTY_STATE;
  let current: RunningSkill | null = null;
  let goal: Goal | null = null;
  const signals: Record<string, Signal> = {};
  const events: SkillEvent[] = [];
  let attended: Attended | null = null;
  let needs: Needs | null = null;
  let place: PlaceNow | null = null;
  let feeling: Feeling | null = null;
  let trouble: Trouble | null = null;
  const views = new Map<string, State>();
  const cortex: Record<string, AreaPorts> = {};

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
      const ws: Workspace = {
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
        get feeling() {
          return feeling;
        },
        get trouble() {
          return trouble;
        },
        get cortex() {
          return { ...cortex };
        },
        get recentEvents() {
          return [...events];
        },
        setGoal(offer) {
          const offered = goalFrom(offer, region, Date.now());
          const kept = goal && options.goalGate ? options.goalGate(offered, goal, ws) : null;
          if (kept !== null) return kept;
          goal = offered;
        },
        finishStep() {
          if (goal && goal.stepsDone < goal.steps.length) goal = { ...goal, stepsDone: goal.stepsDone + 1, stepDoneAt: Date.now() };
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
        setCortex(area, { up = null, feedback = null, ask = [] }) {
          cortex[area] = { up, feedback, ask: [...ask], at: Date.now() };
        },
        setTrouble(next) {
          trouble = next && { ...next, events: next.events.map((e) => ({ ...e, kinds: [...e.kinds], about: [...e.about] })) };
        },
        setFeeling(next) {
          feeling = next && { ...next, feelings: next.feelings.map((f) => ({ ...f })), uneasy: { level: next.uneasy.level, about: [...next.uneasy.about] } };
        },
        setPlace(next) {
          place = next && { ...next };
        },
      };
      return ws;
    },
    goal: () => goal,
    signals: () => ({ ...signals }),
    attended: () => attended,
    needs: () => needs,
    place: () => place,
    feeling: () => feeling,
    trouble: () => trouble,
    cortex: () => ({ ...cortex }),
  };
}

export function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}
