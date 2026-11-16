// Runs the whole bot (Jev and a fixed plan) as its own process for a demo, sends timed server
// commands, and reads its output as it goes.
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { rcon, sleep } from "../primitive-check/world.ts";

export interface BrainRun {
  seconds: number;
  /** The fixed plan for the echo planner. */
  plan: { goal: string; ifThen?: { when: string; skill: string }[]; holdBack?: string[] };
  /** Server commands while it runs: [seconds after it starts playing, command]. */
  during: [number, string][];
  /** Called with each line the bot prints. */
  onLine(line: string): void;
}

/** What the bot's latest tick line said. */
export interface Tick {
  action: string;
  by: string;
  signals: Record<string, number>;
}

/** Reads a tick line ("tick 12  flee <- reflex 0.95 ...  alarm=0.60 ..."), or null if the line is not one. */
export function readTick(line: string): Tick | null {
  const head = /^tick \d+ {2}(\S+)(?: \([^)]*\))?(?: <- (\S+))?/.exec(line);
  if (!head) return null;
  const signals: Record<string, number> = {};
  for (const [, name, value] of line.matchAll(/(\w+)=(\d\.\d\d)/g)) signals[name!] = Number(value);
  return { action: head[1] === "keep" ? "keep going" : head[1]!, by: head[2] ?? "", signals };
}

/** Runs the bot named `name` for the given time and returns everything it printed. */
export async function runBrain(name: string, run: BrainRun): Promise<string> {
  rmSync(`data/${name}`, { recursive: true, force: true });
  const child = spawn("node", ["--env-file-if-exists=.env", "apps/run-bot/dist/index.js", "--engine", "jev", "--planner", "echo", "--plan", JSON.stringify(run.plan), "--name", name], { stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  let rest = "";
  let exited = false;
  const take = (data: Buffer) => {
    output += data;
    const lines = (rest + data).split("\n");
    rest = lines.pop() ?? "";
    for (const line of lines) run.onLine(line);
  };
  child.stdout.on("data", take);
  child.stderr.on("data", take);
  child.once("exit", () => (exited = true));
  const joined = Date.now();
  while (!output.includes("Logging to") && !exited && Date.now() - joined < 30_000) await sleep(200);
  if (exited) throw new Error(`The bot stopped before it started playing:\n${output.slice(-500)}`);
  const started = Date.now();
  const pending = [...run.during].sort((a, b) => a[0] - b[0]);
  while (Date.now() - started < run.seconds * 1000 && !exited) {
    while (pending[0] && (Date.now() - started) / 1000 >= pending[0][0]) rcon(pending.shift()![1]);
    await sleep(200);
  }
  child.kill("SIGINT");
  if (!exited) await new Promise((resolve) => child.once("exit", resolve));
  return output;
}
