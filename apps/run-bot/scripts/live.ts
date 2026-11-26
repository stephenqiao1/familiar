// What the live checks of the neuromodulators share: running the real bot through a scripted
// scene on the test server (reflexes only, or the whole brain), and reading its tick log back.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { buildPlaza, rcon, sleep } from "./primitive-check/world.ts";

/** Everything but instinct: the reflexes, upkeep and every neuromodulator, with the echo planner. */
// LESION=hypothalamus (or any names, comma-separated) leaves those out too, to see what the brain does without them.
const LESION = (process.env.LESION ?? "").split(",").filter(Boolean);
const NO_INSTINCT = "reflex,medulla,hypothalamus,brainstem,acetylcholine,dopamine,noradrenaline,hippocampus,amygdala,serotonin,prefrontal"
  .split(",")
  .filter((name) => !LESION.includes(name))
  .join(",");
export const BOT = "Tester";
export const HOME = "60.5 151 40.5 -90 0";

export interface Tick {
  timestamp: number;
  state: { data: { time?: { isNight: boolean; lightLevel: number }; self: { health: number; food: number; foodItems?: number; deaths: number; position: { x: number; y: number; z: number }; inventory: Record<string, number> }; nearby?: { mobs?: { hostile: boolean; reachable: boolean; dist: number }[]; blocks?: { id: string; type: string }[] }; current: { skill: string } | null } };
  winner: { region: string; layer: number; urgency: number; action: { skill?: string; target?: string }; reason: string } | null;
  regions: { region: string; trace?: Record<string, unknown> }[];
  signals: Record<string, { value: number }>;
  goal?: { text: string } | null;
  skillEvents?: { skill: string; type: string; reason?: string; target?: string }[];
}
export interface Row {
  scene: string;
  saw: string;
  problem: string;
}

/**
 * Runs the real bot; `act` scripts the scene while it runs. Returns its ticks. With `plan` the
 * echo planner sets that goal; `whole` adds Jev (default: reflexes only, with typed commands).
 * `settings` are the bot's settings for this run, as its entry in bots.json would be (default:
 * whatever FAMILIAR_BOTS_FILE or bots.json says); `keep` leaves what it learned last run in place.
 */
export async function play(act: (bot: { say(command: string): void }) => Promise<void>, options: { plan?: object; whole?: boolean; settings?: object; keep?: boolean; also?: string[]; flags?: string[]; without?: string[]; before?: string[]; awakeDays?: number; start?: string } = {}): Promise<Tick[]> {
  if (!options.keep) rmSync(`data/${BOT}`, { recursive: true, force: true });
  // `before`: world commands before the bot joins. `awakeDays`: how long it has been awake (kept as the world's age when it last woke). `start`: where it stands.
  for (const command of options.before ?? []) rcon(command);
  if (options.awakeDays !== undefined) {
    const age = Number(/(\d+)\s*$/.exec(rcon("time query gametime"))?.[1] ?? NaN);
    mkdirSync(`data/${BOT}`, { recursive: true });
    writeFileSync(`data/${BOT}/body.json`, JSON.stringify({ sleptAtAge: Math.max(0, age - Math.round(options.awakeDays * 24_000)) }));
  }
  const env = { ...process.env };
  if (options.settings) {
    mkdirSync("logs", { recursive: true });
    env.FAMILIAR_BOTS_FILE = "logs/live-bots.json";
    writeFileSync(env.FAMILIAR_BOTS_FILE, JSON.stringify({ [BOT]: options.settings }));
  }
  // `also`: regions the usual list leaves out (the colliculus); `flags`: more command-line flags.
  // `without`: the whole brain less these regions (to see what one adds).
  const everything = "reflex,medulla,hypothalamus,brainstem,reticular,colliculus,acetylcholine,dopamine,noradrenaline,hippocampus,amygdala,thalamus,instinct,serotonin,prefrontal".split(",").filter((name) => !(options.without ?? []).includes(name));
  const brain = options.whole ? ["--engine", "jev", ...(options.without ? ["--regions", everything.join(",")] : [])] : ["--engine", "echo", "--regions", [NO_INSTINCT, ...(options.also ?? [])].join(",")];
  const child = spawn("node", ["--env-file-if-exists=.env", "apps/run-bot/dist/index.js", ...brain, "--planner", "echo", ...(options.plan ? ["--plan", JSON.stringify(options.plan)] : []), ...(options.flags ?? []), "--manual", "--name", BOT], { stdio: ["pipe", "pipe", "pipe"], env });
  let output = "";
  let exited = false;
  child.stdout.on("data", (d: Buffer) => (output += d));
  child.stderr.on("data", (d: Buffer) => (output += d));
  child.once("exit", () => (exited = true));
  const joined = Date.now();
  while (!output.includes("Logging to") && !exited && Date.now() - joined < 30_000) await sleep(200);
  if (exited) throw new Error(`The bot stopped before it started playing:\n${output.slice(-500)}`);
  for (const command of [`gamemode survival ${BOT}`, `clear ${BOT}`, `effect clear ${BOT}`, `effect give ${BOT} instant_health 1 10 true`, `effect give ${BOT} saturation 1 10 true`, `tp ${BOT} ${options.start ?? HOME}`]) rcon(command);
  await sleep(2500);
  try {
    await act({ say: (command) => void child.stdin.write(`${command}\n`) });
  } finally {
    child.stdin.end();
    child.kill("SIGINT");
    const hard = setTimeout(() => child.kill("SIGKILL"), 8000);
    if (!exited) await new Promise((resolve) => child.once("exit", resolve));
    clearTimeout(hard);
    rcon(`effect clear ${BOT}`);
    rcon("kill @e[type=!player,x=60,y=151,z=40,distance=..40]");
  }
  const file = output.match(/Logging to (\S+)/)?.[1];
  if (!file) throw new Error("no log file");
  console.log(`    log: ${file}`);
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as Tick).filter((t) => t.regions);
}

/** The plaza, empty, by day, walled three high so that a fight or a chase cannot end in a fall. */
export async function freshPlaza(): Promise<void> {
  buildPlaza();
  for (const command of ["kill @e[type=!player,x=60,y=151,z=40,distance=..40]", "fill 40 151 36 80 160 44 air", "fill 40 149 36 80 150 44 stone", "time set 1000"]) rcon(command);
  for (const wall of ["39 151 35 81 153 35", "39 151 45 81 153 45", "39 151 35 39 153 45", "81 151 35 81 153 45"]) rcon(`fill ${wall} glass`);
  await sleep(500);
}

export const after = (ticks: Tick[], at: number) => ticks.filter((t) => t.timestamp >= at);
export const between = (ticks: Tick[], from: number, to: number) => ticks.filter((t) => t.timestamp >= from && t.timestamp < to);
export const n = (x: number, digits = 2) => (Number.isFinite(x) ? x.toFixed(digits) : "?");
/** One region's trace on a tick. */
export const traceOf = <T>(t: Tick, region: string) => (t.regions.find((r) => r.region === region)?.trace ?? {}) as T;

/** Runs the scenes named on the command line (default: all), prints each, and the count that showed a problem. */
export async function runScenes(scenes: Record<string, () => Promise<Row>>): Promise<void> {
  const wanted = process.argv.slice(2);
  const names = wanted.length ? wanted : Object.keys(scenes);
  const unknown = names.filter((name) => !scenes[name]);
  if (unknown.length) {
    console.error(`Unknown scene(s): ${unknown.join(", ")}. Use: ${Object.keys(scenes).join(", ")}`);
    process.exit(1);
  }
  const rows: Row[] = [];
  for (const name of names) {
    console.log(`=== ${name}`);
    try {
      const row = await scenes[name]!();
      rows.push(row);
      for (const line of row.saw.split(" | ")) console.log(`    ${line}`);
      console.log(`    ${row.problem ? `PROBLEM: ${row.problem}` : "no problem seen"}`);
    } catch (error) {
      rows.push({ scene: name, saw: "", problem: `the scene broke: ${error instanceof Error ? error.message : error}` });
      console.log(`    BROKE: ${error instanceof Error ? error.message : error}`);
    }
  }
  rcon(`tp ${BOT} -8 69 14`);
  const problems = rows.filter((r) => r.problem);
  console.log(`\n${rows.length} scenes; ${problems.length} showed a problem${problems.length ? `: ${problems.map((r) => r.scene).join(", ")}` : ""}.`);
}
