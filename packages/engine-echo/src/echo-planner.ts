import type { Plan, Planner } from "@familiar/contracts";

/** A stand-in planner that always returns the same plan. For offline runs and tests. */
export class EchoPlanner implements Planner {
  readonly name = "echo";
  constructor(private readonly fixed: Plan = { goal: "Stay safe.", steps: [], reason: "default plan" }) {}

  async plan(): Promise<Plan> {
    const { ifThen, holdBack } = this.fixed;
    return { ...this.fixed, steps: [...this.fixed.steps], ...(ifThen ? { ifThen: ifThen.map((r) => ({ ...r })) } : {}), ...(holdBack ? { holdBack: [...holdBack] } : {}) };
  }
}
