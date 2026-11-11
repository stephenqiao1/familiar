import type { DecisionEngine, Planner } from "@familiar/contracts";
import { ClaudePlanner } from "@familiar/engine-claude";
import { EchoEngine, EchoPlanner } from "@familiar/engine-echo";
import { JevEngine } from "@familiar/engine-jev";
import type { EngineName, PlannerName } from "./args.js";

/** The engine the instinct region asks. */
export function createEngine(name: EngineName): DecisionEngine {
  return name === "jev" ? new JevEngine() : new EchoEngine();
}

/** The planner the neocortex region uses. */
export function createPlanner(name: PlannerName): Planner {
  return name === "claude" ? new ClaudePlanner() : new EchoPlanner();
}
