import type { DecisionEngine, Plan, Planner } from "@familiar/contracts";
import { ClaudePlanner } from "@familiar/engine-claude";
import { EchoEngine, EchoPlanner } from "@familiar/engine-echo";
import { JevEngine } from "@familiar/engine-jev";
import type { EngineName, PlannerName } from "./args.js";

/** The engine the instinct region asks. */
export function createEngine(name: EngineName): DecisionEngine {
  return name === "jev" ? new JevEngine() : new EchoEngine();
}

/** The planner the prefrontal region uses. `plan` is the echo planner's fixed plan, if one was given. */
export function createPlanner(name: PlannerName, plan?: Plan): Planner {
  return name === "claude" ? new ClaudePlanner() : new EchoPlanner(plan);
}
