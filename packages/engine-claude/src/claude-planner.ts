import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { Goal, ItemWant, NameRequest, Plan, Planner, PlanRequest } from "@familiar/contracts";
import { asHoldBack, CORTEX_ROLE, DROP_NOTES, EXPECT, fullHoldBack, NOTES, fullSteps, PRIORITY, type PlannerExtras } from "./plan-extras.js";
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
  /** What more a plan may say: steps in full, graded hold-backs, a priority. Default: none of them (steps are text, a hold-back is a name). */
  extras?: PlannerExtras;
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
  ifThen: z
    .array(
      z.object({
        when: z.string().describe("A kind of thing by game name, as in watchFor (e.g. creeper, villager, chest)."),
        skill: z.string().describe("The name of one of the listed abilities to do the moment it appears."),
        onStartle: z
          .boolean()
          .optional()
          .describe("True to make this a prepared action: any sudden fright (a bang, a hit from nowhere) releases it at once, whatever caused the fright. At most one."),
      }),
    )
    .describe(
      "Up to 3 responses to load in advance. The agent's fastest layer fires one the moment its thing " +
        "appears, without waiting for you. Use it for things that will need a reaction faster than you can plan. Empty if none.",
    ),
  detail: z
    .array(z.string())
    .describe(
      "What you want to be told about in full from now on: up to 5 kinds of things by game name (e.g. chest, villager, zombie) or ids from the situation. " +
        "The situation you are shown is a selection: only what matters most is given in detail, and the rest is counted (\"Not shown\"). " +
        "Name here anything counted or brief that your plan needs. Empty if what you are shown is enough.",
    ),
  holdBack: z
    .array(z.string())
    .describe(
      "Reflexes to hold back while pursuing this goal, from the list the situation gives (for example flee, when the goal is to stand and fight). " +
        "Held-back reflexes fire much more weakly. Life-saving reflexes cannot be held back. Empty unless the goal needs it.",
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
  "wants, using what the situation says is in storage. You can also tune the reflexes: load a " +
  "response in ifThen for something that will need a faster reaction than you can give, and name " +
  "in holdBack a reflex that would get in the way of the goal. The situation you are shown is a " +
  "selection: what matters most is given in detail and the rest is only counted (\"Not shown\"). " +
  "If your plan needs something that is counted or missing, name its kind in detail and you will be told of it in full.";

/** Plans with Claude: describes the situation, gets back a goal, steps and reason as JSON. */
export class ClaudePlanner implements Planner {
  readonly name = "claude";
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly effort: NonNullable<ClaudePlannerOptions["effort"]>;
  private readonly role: string;
  private readonly schema: typeof PlanSchema;

  constructor(options: ClaudePlannerOptions = {}) {
    this.client = options.client ?? new Anthropic();
    this.model = options.model ?? "claude-sonnet-5-5";
    this.effort = options.effort ?? "medium";
    const extras = options.extras ?? {};
    this.role = options.role ?? [DEFAULT_ROLE, ...(extras.steps ? [CORTEX_ROLE.steps] : []), ...(extras.holdBack ? [CORTEX_ROLE.holdBack] : []), ...(extras.priority ? [CORTEX_ROLE.priority] : []), ...(extras.expect ? [CORTEX_ROLE.expect] : []), ...(extras.notes ? [CORTEX_ROLE.notes] : [])].join(" ");
    this.schema = PlanSchema.extend({ ...(extras.steps ? { steps: fullSteps } : {}), ...(extras.holdBack ? { holdBack: fullHoldBack } : {}), ...(extras.priority ? { priority: PRIORITY } : {}), ...(extras.expect ? { expect: EXPECT } : {}), ...(extras.notes ? { notes: NOTES, dropNotes: DROP_NOTES } : {}) }) as unknown as typeof PlanSchema;
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
        output_config: { effort: this.effort, format: betaZodOutputFormat(this.schema) },
        messages: [{ role: "user", content: planPrompt(request) }],
      },
      signal ? { signal } : undefined,
    );
    if (response.stop_reason === "refusal") throw new Error("planner declined to plan");
    if (!response.parsed_output) throw new Error(`planner gave no plan (stop reason: ${response.stop_reason})`);
    const plan = response.parsed_output;
    return { ...plan, steps: (plan.steps as Plan["steps"]).map(cleanStep), wants: cleanWants(plan.wants), ifThen: plan.ifThen.filter((r) => r.when && r.skill).slice(0, 3).map(({ when, skill, onStartle }) => ({ when, skill, ...(onStartle ? { onStartle: true } : {}) })), holdBack: (plan.holdBack as Parameters<typeof asHoldBack>[0][]).filter((h) => (typeof h === "string" ? h : h.name)).map(asHoldBack) };
  }


  async nameRoutine(request: NameRequest, signal?: AbortSignal): Promise<{ name: string; description: string }> {
    const response = await this.client.beta.messages.parse(
      { model: this.model, max_tokens: 1000, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default", output_config: { effort: "low", format: betaZodOutputFormat(NameSchema) }, messages: [{ role: "user", content: namePrompt(request) }] },
      signal ? { signal } : undefined,
    );
    if (!response.parsed_output) throw new Error(`planner gave no name (stop reason: ${response.stop_reason})`);
    return response.parsed_output;
  }
}

const NameSchema = z.object({
  name: z.string().describe("One word, in lowercase letters (underscores allowed), that names what the routine does. Not one of the names already in use."),
  description: z.string().describe("One short line saying what it does, as the other abilities are described."),
});

/** The message asking for a routine's name. */
export function namePrompt({ steps, doneWhen, taken }: NameRequest): string {
  const told = steps.map((s, i) => `${i + 1}. ${s.skill}${s.target ? ` (${s.target})` : ""}`).join("\n");
  return `The agent has done this routine several times, and each time it brought about: ${doneWhen}\n${told}\n\nIt will be kept as one ability of its own. Names already in use: ${taken.join(", ")}.\nName it in one word and describe it in one line.`;
}

/** The user message: the current goal (if any), then the situation, then why it is asked now if that is out of turn. */
export function planPrompt({ situation, currentGoal, woken, notes }: PlanRequest): string {
  const noted = notes === undefined ? "" : `\n\nYour notes (${notes.length} of 5):${notes.length ? notes.map((n) => `\n- ${n.key}: ${n.text}`).join("") : " none yet."}`;
  const goal = currentGoal
    ? `Current goal: ${currentGoal.text}${formatStanding(currentGoal)}\nSteps (${currentGoal.stepsDone} of ${currentGoal.steps.length} done): ${formatSteps(currentGoal) || "none"}\nCarry: ${formatWants(currentGoal.wants)}${formatTuning(currentGoal)}`
    : "Current goal: none yet.";
  return `${goal}${noted}\n\nSituation:\n${situation}${woken ? `\n\n${woken}` : ""}\n\nSet the goal.`;
}

/** A step as the model gave it, without the fields it left empty. */
function cleanStep(step: Plan["steps"][number]): Plan["steps"][number] {
  if (typeof step === "string") return step;
  const { text, skill, target, doneWhen, giveUpWhen } = step;
  return { text, ...(skill ? { skill } : {}), ...(skill && target ? { target } : {}), ...(doneWhen ? { doneWhen } : {}), ...(giveUpWhen ? { giveUpWhen } : {}) };
}

/** The steps as text; one given in full is followed by what it says in brackets. */
function formatSteps(goal: Pick<Goal, "steps" | "specs">): string {
  return goal.steps
    .map((text, i) => {
      const { skill, target, doneWhen, giveUpWhen } = goal.specs?.[i] ?? { text };
      const more = [skill ? `skill ${skill}${target ? ` at ${target}` : ""}` : "", doneWhen ? `done when ${doneWhen}` : "", giveUpWhen ? `give up when ${giveUpWhen}` : ""].filter(Boolean);
      return more.length ? `${text} [${more.join("; ")}]` : text;
    })
    .join("; ");
}

/** What the planner should know of how the goal stands: its priority when it is not the usual one, and that it cannot be replaced yet. */
function formatStanding(goal: Partial<Pick<Goal, "priority" | "protected" | "doneWhen">>): string {
  const priority = goal.priority !== undefined && goal.priority !== 0.5 ? ` (priority ${goal.priority})` : "";
  return goal.protected ? `${priority}\nThis goal is protected: it stands until "${goal.doneWhen}" is true, and your plan will wait until then.` : priority;
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

/** The current goal's loaded responses and held-back reflexes, if it has any. */
function formatTuning(goal: Pick<Goal, "ifThen" | "holdBack"> & Partial<Pick<Goal, "expect">>): string {
  const loaded = goal.ifThen.length ? `\nLoaded responses: ${goal.ifThen.map((r) => `if ${r.when} then ${r.skill}${r.onStartle ? " (also released by any fright)" : ""}`).join("; ")}` : "";
  const expected = goal.expect?.length ? `\nExpecting: ${goal.expect.map((e) => `${e.what}${e.when ? ` (when ${e.when})` : ""}`).join("; ")}` : "";
  const held = goal.holdBack.length ? `\nHolding back: ${goal.holdBack.map(formatHeld).join(", ")}` : "";
  return loaded + held + expected;
}

/** A hold-back in full with no end is its name alone; any other says its strength and end. */
function formatHeld(held: Goal["holdBack"][number] | string): string {
  if (typeof held === "string") return held;
  const end = held.until === "step" ? ", until its step is done" : typeof held.until === "number" ? `, for ${held.until} s` : "";
  return held.strength === 1 && !end ? held.name : `${held.name} (strength ${held.strength}${end})`;
}

function formatWants(wants: ItemWant[]): string {
  return wants.length ? wants.map((w) => `${w.count} ${w.item}`).join(", ") : "nothing in particular";
}
