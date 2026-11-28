// One bot's cingulate: how trouble is gathered and weighed. Each strength is 0 to 1; the call
// budget is a number of calls. With `gather` at 0 there is no cingulate.

export interface CingulateSettings {
  /** How much of the gathered trouble counts (0: none is gathered, and nothing below is worked out). */
  gather: number;
  /** How much of the worked-out control counts (0: more effort is never worth it). */
  control: number;
  /** How strongly an activity paying worse than the background is felt as a reason to leave. */
  leave: number;
  /** How strongly a run of surprises is read as the world having changed. */
  changeable: number;
  /** How far a low mood lowers what is at stake. Small on purpose. */
  mood: number;
  /** Above 0: at quiet rest with no trouble the bot looks inward (memories are sorted then, and the planner reviews its notes once). 0: no inward mode. */
  inward: number;
  /** How far each reader goes by the cingulate, 0 to 1. At 0 a reader keeps the rule it had before. */
  readers: CingulateReaders;
  /** Thinking the bot may spend in a minute before more is not worth it: one for each call of the instinct engine, fifteen for each plan. */
  callBudget: number;
}

/** One strength for each reader of the cingulate. */
export interface CingulateReaders {
  /** The planner is woken when the verdict is to try harder and control is high, and told why. Before: its own list of four reasons. */
  planner: number;
  /** A call of a decider is urgent when control is high. Before: when a near tie was being waited on. */
  gate: number;
  /** Control enlarges instinct's view a little. Before: nothing did. */
  view: number;
  /** Control is one focus input. Before: the near tie, the unexpected and the mismatch each were. */
  focus: number;
  /** Control raises alarm a little. Before: a large mismatch did. */
  alarm: number;
  /** `leave` loosens the stay bonus and shortens the give-up clock, and a verdict to leave ends the streak. Before: the clock alone. */
  patience: number;
  /** A habit gives way when there is trouble. Before: only for its own list of reasons (which it keeps). */
  habit: number;
  /** The three learning rates follow `changeable`. Before: each was fixed. */
  learning: number;
}

export const ALL_READERS = (strength: number): CingulateReaders => ({ planner: strength, gate: strength, view: strength, focus: strength, alarm: strength, patience: strength, habit: strength, learning: strength });
export const READERS = Object.keys(ALL_READERS(0)) as (keyof CingulateReaders)[];

export const DEFAULT_CINGULATE: CingulateSettings = { gather: 1, control: 1, leave: 1, changeable: 1, mood: 1, inward: 1, readers: ALL_READERS(1), callBudget: 200 };
/** In shadow: everything is worked out and traced, and no reader goes by it. */
export const SHADOW_CINGULATE: CingulateSettings = { ...DEFAULT_CINGULATE, inward: 0, readers: ALL_READERS(0) };
/** Every part off: nothing is gathered. */
export const NO_CINGULATE: CingulateSettings = { gather: 0, control: 0, leave: 0, changeable: 0, mood: 0, inward: 0, readers: ALL_READERS(0), callBudget: 200 };
/** What one plan costs against the budget, in calls of the instinct engine. */
export const PLAN_COSTS = 15;

/** What is wrong with the settings, or null. */
export function cingulateProblem(settings: CingulateSettings): string | null {
  for (const key of ["gather", "control", "leave", "changeable", "mood", "inward"] as const) {
    const value = settings[key];
    if (typeof value !== "number" || !(value >= 0 && value <= 1)) return `cingulate.${key} must be a number from 0 to 1, got ${JSON.stringify(value)}`;
  }
  for (const key of READERS) {
    const value = settings.readers?.[key];
    if (typeof value !== "number" || !(value >= 0 && value <= 1)) return `cingulate.readers.${key} must be a number from 0 to 1, got ${JSON.stringify(value)}`;
  }
  return typeof settings.callBudget === "number" && settings.callBudget > 0 ? null : `cingulate.callBudget must be a number above 0, got ${JSON.stringify(settings.callBudget)}`;
}
