import { parseArgs } from "node:util";
import type { ItemWant, Plan } from "@familiar/contracts";

export interface ServerArgs {
  host: string;
  port: number;
  name: string;
}

export type EngineName = "echo" | "jev";
const ENGINES: readonly EngineName[] = ["echo", "jev"];
export type PlannerName = "echo" | "claude";
const PLANNERS: readonly PlannerName[] = ["echo", "claude"];

/** How to build the brain for the decision loop. */
export interface BrainArgs {
  engine: EngineName;
  planner: PlannerName;
  /** Only these regions (for lesion experiments). Unset: all of them. */
  regions?: string[];
  /** Put the primitives (look_at, step_toward, ...) on the decision menu. Default: off. */
  primitives?: boolean;
  /** Let a head-only movement (a look) run alongside a skill that leaves the head free. Default: off. */
  sameTime?: boolean;
  /** The fixed plan the echo planner returns (for tests and live checks). Default: "Stay safe." */
  plan?: Plan;
}

export type Command =
  | { kind: "loop"; server: ServerArgs; brain: BrainArgs }
  | { kind: "skills" }
  | { kind: "skill"; server: ServerArgs; skill: string; target?: string; interruptAfterMs?: number; lingerMs?: number; wants?: ItemWant[] };

/**
 * (no command) [--engine echo|jev]                   run the decision loop (default engine: echo)
 *   [--planner echo|claude]                          what the prefrontal cortex plans with (default: echo)
 *   [--regions reflex,instinct,...]                  run only these regions (default: all)
 *   [--plan '{"goal":"...","ifThen":[...]}']         the echo planner's fixed plan, as JSON
 *   [--same-time]                                    let a look run alongside a skill that leaves the head free
 *   [--primitives]                                   let the engine choose primitives too (default: reflexes only)
 * skills                                             list skills
 * skill <name> [--target t] [--interrupt-after s]    run one skill
 *   [--linger s]                                     stay connected s seconds after it ends
 *   [--wants bread:8,torch:16]                       what to carry (for take_items, deposit_items)
 * Any command also takes --host, --port and --name.
 */
export function parseCommand(argv: string[]): Command {
  const { values, positionals } = parseArgs({
    args: argv.filter((a) => a !== "--"),
    allowPositionals: true,
    options: {
      host: { type: "string", default: "localhost" },
      port: { type: "string", default: "25565" },
      name: { type: "string", default: "Player" },
      target: { type: "string" },
      "interrupt-after": { type: "string" },
      linger: { type: "string" },
      wants: { type: "string" },
      engine: { type: "string", default: "echo" },
      planner: { type: "string", default: "echo" },
      regions: { type: "string" },
      primitives: { type: "boolean", default: false },
      "same-time": { type: "boolean", default: false },
      plan: { type: "string" },
    },
  });
  const [command, skill, ...extra] = positionals;
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid --port "${values.port}"`);
  const server = { host: values.host, port, name: values.name };

  if (command === undefined) {
    if (!ENGINES.includes(values.engine as EngineName)) {
      throw new Error(`Unknown --engine "${values.engine}". Use: ${ENGINES.join(" | ")}`);
    }
    if (!PLANNERS.includes(values.planner as PlannerName)) {
      throw new Error(`Unknown --planner "${values.planner}". Use: ${PLANNERS.join(" | ")}`);
    }
    const brain: BrainArgs = { engine: values.engine as EngineName, planner: values.planner as PlannerName };
    if (values.primitives) brain.primitives = true;
    if (values["same-time"]) brain.sameTime = true;
    if (values.plan !== undefined) brain.plan = parsePlan(values.plan);
    if (values.regions !== undefined) brain.regions = values.regions.split(",").map((r) => r.trim()).filter(Boolean);
    return { kind: "loop", server, brain };
  }
  if (command === "skills" && skill === undefined) return { kind: "skills" };
  if (command === "skill" && skill !== undefined && extra.length === 0) {
    const result: Command = { kind: "skill", server, skill };
    if (values.target !== undefined) result.target = values.target;
    if (values["interrupt-after"] !== undefined) result.interruptAfterMs = seconds(values["interrupt-after"], "--interrupt-after") * 1000;
    if (values.linger !== undefined) result.lingerMs = seconds(values.linger, "--linger") * 1000;
    if (values.wants !== undefined) result.wants = parseWants(values.wants);
    return result;
  }
  throw new Error(`Unknown command "${positionals.join(" ")}". Use: skills | skill <name> [--target t] [--interrupt-after s]`);
}

/** A plan given as JSON: it needs a goal; steps and reason default to none. */
function parsePlan(raw: string): Plan {
  let plan: Partial<Plan>;
  try {
    plan = JSON.parse(raw) as Partial<Plan>;
  } catch {
    throw new Error(`Invalid --plan: not JSON`);
  }
  if (typeof plan?.goal !== "string" || !plan.goal) throw new Error(`Invalid --plan: it needs a "goal"`);
  return { steps: [], reason: "given on the command line", ...plan, goal: plan.goal };
}

function seconds(raw: string, flag: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid ${flag} "${raw}"`);
  return n;
}

/** "bread:8,torch:16" → [{ item: "bread", count: 8 }, { item: "torch", count: 16 }]. */
function parseWants(raw: string): ItemWant[] {
  return raw.split(",").map((part) => {
    const [item, count] = part.split(":").map((s) => s.trim());
    const n = Number(count);
    if (!item || !Number.isInteger(n) || n < 1) throw new Error(`Invalid --wants "${part}". Use item:count, e.g. bread:8`);
    return { item, count: n };
  });
}
