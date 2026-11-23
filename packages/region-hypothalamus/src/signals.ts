// The signals the hypothalamus shares, each 0 to 1. Richer data (the readings, the top drive,
// the clock) is in the workspace's `needs`. Every one has a reader:
//   stress    → serotonin's outlook, the reticular formation (staying awake), the planner's note
//   desperate → the arbiter (serotonin's brake), the defence circuit (flight distance)
//   unmet     → noradrenaline's search
export const STRESS_SIGNAL = "stress";
export const DESPERATE_SIGNAL = "desperate";
export const UNMET_SIGNAL = "unmet";
