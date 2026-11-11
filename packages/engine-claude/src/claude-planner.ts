import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { Plan, Planner, PlanRequest } from "@familiar/contracts";
import { z } from "zod";

export interface ClaudePlannerOptions {
  /** Default: a client that reads ANTHROPIC_API_KEY (or another configured credential). */
  client?: Anthropic;
  /** Default: "claude-opus-5-5". */
  model?: string;
  /** How hard the model thinks. Default: "medium". */
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  /** Who the agent is and how it should plan; put before every situation. */
  role?: string;
}

const PlanSchema = z.object({
  goal: z.string().describe("One sentence: what the agent should be working toward right now."),
  steps: z.array(z.string()).describe("A few short steps toward the goal, in order."),
  reason: z.string().describe("One sentence: why this goal, given the situation."),
});

const DEFAULT_ROLE =
  "You are the planning part of an agent's brain. Faster parts of the brain handle reflexes " +
  "and moment-to-moment choices; your job is to set the goal they work toward. Keep the goal " +
  "concrete and reachable with the listed abilities. Keep the current goal unless the " +
  "situation gives a reason to change it.";

/** Plans with Claude: describes the situation, gets back a goal, steps and reason as JSON. */
export class ClaudePlanner implements Planner {
  readonly name = "claude";
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly effort: NonNullable<ClaudePlannerOptions["effort"]>;
  private readonly role: string;

  constructor(options: ClaudePlannerOptions = {}) {
    this.client = options.client ?? new Anthropic();
    this.model = options.model ?? "claude-opus-5-5";
    this.effort = options.effort ?? "medium";
    this.role = options.role ?? DEFAULT_ROLE;
  }

  async plan(request: PlanRequest, signal?: AbortSignal): Promise<Plan> {
    const response = await this.client.beta.messages.parse(
      {
        model: this.model,
        max_tokens: 16000,
        system: this.role,
        // If the model declines, the API retries on a fallback model it picks.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: this.effort, format: betaZodOutputFormat(PlanSchema) },
        messages: [{ role: "user", content: planPrompt(request) }],
      },
      signal ? { signal } : undefined,
    );
    if (response.stop_reason === "refusal") throw new Error("planner declined to plan");
    if (!response.parsed_output) throw new Error(`planner gave no plan (stop reason: ${response.stop_reason})`);
    return response.parsed_output;
  }
}

/** The user message: the current goal (if any), then the situation. */
export function planPrompt({ situation, currentGoal }: PlanRequest): string {
  const goal = currentGoal
    ? `Current goal: ${currentGoal.text}\nSteps: ${currentGoal.steps.join("; ") || "none"}`
    : "Current goal: none yet.";
  return `${goal}\n\nSituation:\n${situation}\n\nSet the goal.`;
}
