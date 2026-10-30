// M1 check: runs every skill through the CLI, to completion and with --interrupt-after 2,
// and checks (via a spectator bot) that the Miner stops moving and digging within 1 s of an interrupt.
// Needs: the local test server (docker container familiar-mc) and a fresh `pnpm build`.
//   node apps/run-bot/scripts/skill-check.ts
import { spawn } from "node:child_process";
import { moduleRuleViolations } from "./skill-check/module-rule.ts";
import { startObserver, type Observer } from "./skill-check/observer.ts";
import { rcon } from "./skill-check/rcon.ts";
import { runCli, type CliRun } from "./skill-check/run-cli.ts";
import { ATTACK_SPOTS, FLEE_START, FLEE_ZOMBIE, OBSERVER_SPOT, setUpTestWorld, summonZombie, TUNNEL_START } from "./skill-check/test-world.ts";

const INTERRUPT_AFTER_S = 2;
const LINGER_S = 2;
const STOP_LIMIT_MS = 1000;
const PAUSE_MS = 1500;

type Mode = "complete" | "interrupt" | "position";
interface Step {
  skill: string;
  mode: Mode;
  target?: string;
  /** Overrides the default --interrupt-after for this run (position steps use it to wait). */
  interruptAfterS?: number;
  before?: () => void;
  onStarted?: () => void;
  /** Skip this interrupt run if the skill's full run took under 2 s. */
  skipIfFast?: boolean;
}
interface Result {
  run: CliRun;
  durationMs: number | null;
  /** Ms from interrupt to the last move or dig the observer saw; null if not interrupted or not observed. */
  stopMs: number | null;
  sightings: number;
}

const freshZombie = (at: string) => () => {
  rcon("kill @e[type=zombie]");
  summonZombie(at);
};
/** Keeps the observer hovering just above the Miner, so it stays in tracking range. */
const followMiner = () => rcon("execute as Observer at Miner run tp @s ~ ~6 ~");
const night = () => {
  rcon("difficulty peaceful");
  rcon("time set 14000");
};

const PLAN: Step[] = [
  { skill: "craft_pickaxe", mode: "complete" },
  { skill: "craft_pickaxe", mode: "interrupt", skipIfFast: true },
  { skill: "go_to", mode: "interrupt", target: "pos:-28,63,40" },
  { skill: "go_to", mode: "complete", target: "pos:-40,63,10" },
  { skill: "return_to_base", mode: "interrupt" },
  { skill: "return_to_base", mode: "complete" },
  { skill: "idle", mode: "interrupt" },
  // Get hungry: stand still for 8 s with a strong hunger effect.
  { skill: "idle", mode: "position", interruptAfterS: 14, onStarted: () => rcon("effect give Miner hunger 12 100 true") },
  { skill: "eat", mode: "interrupt" },
  { skill: "eat", mode: "complete" },
  { skill: "attack", mode: "complete", before: () => summonZombie(ATTACK_SPOTS[0]!) },
  { skill: "attack", mode: "interrupt", before: () => summonZombie(ATTACK_SPOTS[1]!) },
  { skill: "return_to_base", mode: "position", before: () => rcon("kill @e[type=zombie]") },
  { skill: "go_to", mode: "position", target: FLEE_START },
  { skill: "flee", mode: "complete", before: freshZombie(FLEE_ZOMBIE) },
  { skill: "go_to", mode: "position", target: FLEE_START, before: () => rcon("kill @e[type=zombie]") },
  { skill: "flee", mode: "interrupt", before: freshZombie(FLEE_ZOMBIE) },
  { skill: "return_to_base", mode: "position", before: () => rcon("kill @e[type=zombie]") },
  { skill: "mine_block", mode: "complete", target: "nearest:iron_ore" },
  { skill: "mine_block", mode: "interrupt", target: "nearest:iron_ore", skipIfFast: true },
  { skill: "go_to", mode: "position", target: TUNNEL_START },
  { skill: "dig_tunnel", mode: "interrupt", target: "west" },
  { skill: "dig_tunnel", mode: "complete", target: "west" },
  { skill: "place_torch", mode: "complete" },
  { skill: "place_torch", mode: "interrupt", skipIfFast: true },
  { skill: "deposit_items", mode: "interrupt" },
  { skill: "deposit_items", mode: "complete" },
  { skill: "sleep", mode: "interrupt", before: night },
  { skill: "sleep", mode: "complete", before: night },
];

async function main(): Promise<void> {
  keepAwake();
  const observer = await startObserver("Miner", OBSERVER_SPOT);
  console.log("Setting up the test world...");
  await setUpTestWorld().catch((error: unknown) => {
    observer.quit();
    throw error;
  });
  const results = new Map<string, Partial<Record<Mode, Result | "skipped">>>();

  try {
    for (const step of PLAN) {
      const done = results.get(step.skill) ?? {};
      results.set(step.skill, done);
      const full = done.complete;
      if (step.skipIfFast && full && full !== "skipped" && full.durationMs !== null && full.durationMs < INTERRUPT_AFTER_S * 1000) {
        done.interrupt = "skipped";
        console.log(`- ${step.skill} interrupt: skipped (full run took ${full.durationMs} ms)`);
        continue;
      }

      step.before?.();
      const args = ["skill", step.skill, "--linger", String(LINGER_S)];
      if (step.target) args.push("--target", step.target);
      const interruptAfter = step.interruptAfterS ?? (step.mode === "interrupt" ? INTERRUPT_AFTER_S : undefined);
      if (interruptAfter !== undefined) args.push("--interrupt-after", String(interruptAfter));

      const run = await runCli(args, () => {
        followMiner();
        step.onStarted?.();
      });
      const result = measure(run, observer);
      if (step.mode !== "position") done[step.mode] = result;
      console.log(`- ${step.skill} ${step.mode}: ${describe(result)} [observer saw ${result.sightings} updates]`);
      for (const line of run.output.filter((l) => l.startsWith("  "))) console.log(`   ${line}`);
      if (run.status === "no result") console.log(run.output.map((l) => `    ${l}`).join("\n"));
      await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
    }
  } finally {
    rcon("difficulty easy");
    rcon("kill @e[type=zombie]");
    observer.quit();
  }

  const allPass = printTable(results);
  const violations = moduleRuleViolations();
  console.log(violations.length ? `\nModule rule BROKEN:\n${violations.join("\n")}` : "\nModule rule OK: no Minecraft imports in core, contracts or any engine-* package.");
  process.exitCode = allPass && violations.length === 0 ? 0 : 1;
}

/** On macOS, stop the machine idle-sleeping while this process runs: sleep pauses the server VM and skews every timing. */
function keepAwake(): void {
  if (process.platform !== "darwin") return;
  spawn("caffeinate", ["-i", "-w", String(process.pid)], { stdio: "ignore", detached: true }).unref();
}

function measure(run: CliRun, observer: Observer): Result {
  const durationMs = run.startedAt !== undefined && run.endedAt !== undefined ? run.endedAt - run.startedAt : null;
  const sightings = observer.sightingsBetween(run.startedAt ?? run.exitedAt, run.exitedAt);
  // No sightings at all means the observer couldn't see the Miner: the stop time is unknown.
  if (run.interruptAt === undefined || sightings === 0) return { run, durationMs, stopMs: null, sightings };
  const last = observer.lastActivitySince(run.interruptAt);
  return { run, durationMs, stopMs: last === null ? 0 : last - run.interruptAt, sightings };
}

function describe(r: Result): string {
  const reason = r.run.reason ? ` (${r.run.reason})` : "";
  const time = r.durationMs === null ? "" : ` in ${(r.durationMs / 1000).toFixed(1)}s`;
  const stop = r.stopMs === null ? "" : `, stopped ${r.stopMs} ms after interrupt`;
  return `${r.run.status}${reason}${time}${stop}`;
}

function printTable(results: Map<string, Partial<Record<Mode, Result | "skipped">>>): boolean {
  const rows = [["skill", "full run", "time", "interrupt run", "time", "stop after interrupt", "pass"]];
  let allPass = true;
  for (const [skill, r] of results) {
    const full = r.complete === "skipped" ? undefined : r.complete;
    const int = r.interrupt;
    const intRun = int === "skipped" ? undefined : int;
    const interrupted = intRun?.run.interruptAt !== undefined;

    const finished = full?.run.status === "done" || intRun?.run.status === "done";
    const stoppedOk =
      int === "skipped" ||
      (interrupted && intRun!.run.status === "interrupted" && intRun!.stopMs !== null && intRun!.stopMs <= STOP_LIMIT_MS) ||
      (!interrupted && intRun?.run.status === "done");
    const pass = (skill === "idle" || finished) && stoppedOk;
    allPass &&= pass;

    rows.push([
      skill,
      full ? statusText(full) : skill === "idle" ? "n/a" : "-",
      full?.durationMs != null ? `${(full.durationMs / 1000).toFixed(1)}s` : "",
      int === "skipped" ? "skipped (<2s)" : intRun ? (interrupted ? statusText(intRun) : `${statusText(intRun)} before 2s`) : "-",
      intRun?.durationMs != null ? `${(intRun.durationMs / 1000).toFixed(1)}s` : "",
      intRun?.stopMs != null ? `${intRun.stopMs} ms` : interrupted ? "not observed" : "",
      pass ? "PASS" : "FAIL",
    ]);
  }
  const widths = rows[0]!.map((_, c) => Math.max(...rows.map((row) => row[c]!.length)));
  console.log("");
  for (const [i, row] of rows.entries()) {
    console.log(row.map((cell, c) => cell.padEnd(widths[c]!)).join(" | "));
    if (i === 0) console.log(widths.map((w) => "-".repeat(w)).join("-|-"));
  }
  console.log(`\n${allPass ? "PASS" : "FAIL"}: every skill finished at least once, and every interrupt stopped the bot within ${STOP_LIMIT_MS} ms.`);
  return allPass;
}

function statusText(r: Result): string {
  return r.run.reason ? `${r.run.status}: ${r.run.reason}` : r.run.status;
}

await main();
