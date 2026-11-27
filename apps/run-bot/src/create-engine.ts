import type { DecisionEngine, Plan, Planner, State } from "@familiar/contracts";
import { ClaudePlanner, type PlannerExtras } from "@familiar/engine-claude";
import { EchoEngine, EchoPlanner } from "@familiar/engine-echo";
import { JevEngine } from "@familiar/engine-jev";
import type { EngineName, PlannerName } from "./args.js";

/** The engine the instinct region asks. `choose` is the echo engine's fixed way of choosing, if one was given. */
export function createEngine(name: EngineName, choose?: (state: State) => string[]): DecisionEngine {
  return name === "jev" ? new JevEngine() : new EchoEngine(choose ? { choose } : {});
}

/** The planner the prefrontal region uses. `plan` is the echo planner's fixed plan (or plans), if given; `extras` is what more a plan may say. */
export function createPlanner(name: PlannerName, plan?: Plan | Plan[], extras: PlannerExtras = {}): Planner {
  return name === "claude" ? new ClaudePlanner({ extras }) : new EchoPlanner(plan);
}
