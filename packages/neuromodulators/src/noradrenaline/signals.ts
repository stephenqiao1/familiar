// The workspace signals the noradrenaline region shares. Each already has its effect's on/off
// setting applied, so readers just use the value.

/** Alarm, 0 to 1: "something matters right now". */
export const ALARM_SIGNAL = "alarm";
/** Search, 0.05 to 0.95: "should I give up on this and try something else?". */
export const SEARCH_SIGNAL = "search";
/** How much the planner's goal counts, 0 (ignored) to 1 (fully). */
export const PLANNER_WEIGHT_SIGNAL = "planner_weight";
/** 1 while alarm has the planner offline: it should not plan, and its goal is ignored. */
export const PLANNER_OFFLINE_SIGNAL = "planner_offline";
/** 1 on the tick alarm jumped (by more than the jump threshold within a second). */
export const ALARM_JUMP_SIGNAL = "alarm_jump";
/** 1 on the tick an interrupt fired: the plan was cancelled and the running skill should stop. */
export const INTERRUPT_SIGNAL = "interrupt";
/** 1 while the planner should plan at once: after an interrupt once calm, or when the goal isn't paying off. */
export const REPLAN_SIGNAL = "replan";
/** 1 while the planner should be told the current goal isn't paying off. */
export const RETHINK_SIGNAL = "rethink";
/** Search as the switch margin should feel it (0.3 = no change), after its on/off setting and guardrail. */
export const SWITCHING_SIGNAL = "search_switching";

/** Told to the planner while RETHINK_SIGNAL is up. */
export const RETHINK_INSTRUCTION = "The current goal isn't paying off. Consider a different goal or approach.";
/** Search at which the switch margin is unchanged. */
export const NEUTRAL_SEARCH = 0.3;

/** What to multiply the margin a new option must beat the running skill by: 1.3 − search. */
export function switchMarginFactor(search: number): number {
  return 1.3 - search;
}
