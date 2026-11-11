import type { Plan, Planner } from "@familiar/contracts";

/** A stand-in planner that always returns the same plan. For offline runs and tests. */
export class EchoPlanner implements Planner {
  readonly name = "echo";
  constructor(private readonly fixed: Plan = { goal: "Mine ore and stay safe.", steps: [], reason: "default plan" }) {}

  async plan(): Promise<Plan> {
    return { ...this.fixed, steps: [...this.fixed.steps] };
  }
}
