import type { NameRequest, Plan, Planner, PlanRequest, Review, ReviewRequest } from "@familiar/contracts";

/**
 * A stand-in planner that returns a fixed plan. For offline runs and tests. Given several plans,
 * it starts on the first and moves to the next each time it is woken out of turn (a step is
 * stuck) or shown that the goal it gave is finished, staying on the last: a planner that changes
 * its plan when told to, with no model. It names a routine after its steps, and at a review
 * keeps its notes as they are.
 */
export class EchoPlanner implements Planner {
  readonly name = "echo";
  private readonly plans: Plan[];
  private at = 0;
  constructor(fixed: Plan | Plan[] = { goal: "Stay safe.", steps: [], reason: "default plan" }) {
    this.plans = Array.isArray(fixed) ? fixed : [fixed];
  }

  async plan(request?: PlanRequest): Promise<Plan> {
    const shown = request?.currentGoal;
    const finished = shown !== null && shown !== undefined && shown.text === this.plans[this.at]!.goal && shown.steps.length > 0 && shown.stepsDone >= shown.steps.length;
    if (request?.woken || finished) this.at = Math.min(this.at + 1, this.plans.length - 1);
    const fixed = this.plans[this.at]!;
    const { ifThen, holdBack } = fixed;
    return { ...fixed, steps: [...fixed.steps], ...(ifThen ? { ifThen: ifThen.map((r) => ({ ...r })) } : {}), ...(holdBack ? { holdBack: [...holdBack] } : {}) };
  }

  async review(request: ReviewRequest): Promise<Review> {
    return { notes: request.notes.map((n) => ({ ...n })) };
  }

  async nameRoutine(request: NameRequest): Promise<{ name: string; description: string }> {
    const skills = request.steps.map((s) => s.skill);
    return { name: skills.join("_then_"), description: `Do ${skills.join(", then ")} (until ${request.doneWhen}).` };
  }
}
