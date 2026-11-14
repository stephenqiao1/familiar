import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { ItemWant, Plan, Planner, PlanRequest } from "@familiar/contracts";
import { z } from "zod";

export interface ClaudePlannerOptions {
  /** Default: a client that reads ANTHROPIC_API_KEY (or another configured credential). */
  client?: Anthropic;
  /** Default: "claude-sonnet-5-5". */
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
  stepsDone: z
    .number()
    .describe("How many of the CURRENT goal's steps (as listed in the message, in order) are finished now, judging by the situation. 0 if there is no current goal."),
  watchFor: z
    .array(z.string())
    .describe(
      "Kinds of things to watch for while pursuing this goal, by game name (a mob type like villager, a block like chest, or player). " +
        "When one comes into view the agent heads to it at once. Empty if there is nothing to look for.",
    ),
  wants: z
    .array(
      z.object({
        item: z.string().describe("The item's game name, e.g. bread."),
        count: z.number().describe("How many the agent should carry, a whole number above 0."),
      }),
    )
    .describe(
      "Every item the agent should carry for this goal, including what it needs to stay alive " +
        "(food, a weapon, tools). Taking from storage fetches these; storing keeps these and puts " +
        "everything else away. Empty means storage is not part of this goal.",
    ),
});

const DEFAULT_ROLE =
  "You are the planning part of an agent's brain. Faster parts of the brain handle reflexes " +
  "and moment-to-moment choices; your job is to set the goal they work toward. Keep the goal " +
  "concrete and reachable with the listed abilities. Keep the current goal unless the " +
  "situation gives a reason to change it. You also decide what the agent carries: list it in " +
  "wants, using what the situation says is in storage.";

/** Plans with Claude: describes the situation, gets back a goal, steps and reason as JSON. */
export class ClaudePlanner implements Planner {
  readonly name = "claude";
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly effort: NonNullable<ClaudePlannerOptions["effort"]>;
  private readonly role: string;

  constructor(options: ClaudePlannerOptions = {}) {
    this.client = options.client ?? new Anthropic();
    this.model = options.model ?? "claude-sonnet-5-5";
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
    return { ...response.parsed_output, wants: cleanWants(response.parsed_output.wants) };
  }
}

/** The user message: the current goal (if any), then the situation. */
export function planPrompt({ situation, currentGoal }: PlanRequest): string {
  const goal = currentGoal
    ? `Current goal: ${currentGoal.text}\nSteps (${currentGoal.stepsDone} of ${currentGoal.steps.length} done): ${currentGoal.steps.join("; ") || "none"}\nCarry: ${formatWants(currentGoal.wants)}`
    : "Current goal: none yet.";
  return `${goal}\n\nSituation:\n${situation}\n\nSet the goal.`;
}

/** Whole counts above 0, one entry per item (the last one wins). */
export function cleanWants(wants: ItemWant[]): ItemWant[] {
  const byItem = new Map<string, number>();
  for (const { item, count } of wants) {
    const n = Math.round(count);
    if (item && n > 0) byItem.set(item, n);
  }
  return [...byItem].map(([item, count]) => ({ item, count }));
}

function formatWants(wants: ItemWant[]): string {
  return wants.length ? wants.map((w) => `${w.count} ${w.item}`).join(", ") : "nothing in particular";
}
