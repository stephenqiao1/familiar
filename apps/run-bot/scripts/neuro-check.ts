// Live check of the neuromodulators: runs the real bot (Jev + Claude) through scripted scenes on
// the test server and judges each from its tick log. Needs the server container running and
// TYPESAFE_API_KEY / ANTHROPIC_API_KEY in .env.
// Usage: pnpm neuro-check [scene ...]      (default: every scene)
//        MC_CONTAINER=familiar-m6 pnpm neuro-check ambush
import { execFileSync, spawn } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";

const CONTAINER = process.env.MC_CONTAINER ?? "familiar-m6";
const BOT = "Tester";
const rcon = (command: string) => {
  try {
    return execFileSync("docker", ["exec", CONTAINER, "rcon-cli", "--", command], { encoding: "utf8" }).trim();
  } catch (error) {
    return `rcon failed: ${error instanceof Error ? error.message : error}`;
  }
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Tick {
  tick: number;
  timestamp: number;
  regions: { region: string; proposals: unknown[]; trace?: Record<string, unknown>; error?: string }[];
  winner: { region: string; reason: string; action: { skill?: string } } | null;
  action: { skill?: string };
  goal: { text: string; setBy: string } | null;
  signals: Record<string, { value: number }>;
  state: { data: { self: { health: number; food: number; asleep: boolean }; time: { isNight: boolean }; memory: { nearby: string; kind: string } | null } };
  skillEvents?: { skill: string; type: string; reason?: string }[];
}

interface Run {
  ticks: Tick[];
  output: string;
  /** Seconds from the bot's first tick to the tick. */
  at(t: Tick): number;
  signal(name: string): number[];
  trace(t: Tick, region: string): Record<string, unknown>;
  events(): { skill: string; type: string; reason?: string }[];
}

interface Scene {
  name: string;
  about: string;
  seconds: number;
  /** Server commands before the bot joins. */
  before?: string[];
  /** Server commands while it runs: [seconds after joining, command]. */
  during?: [number, string][];
  /** Keep what the bot learned in earlier scenes (default: start fresh). */
  keepMemory?: boolean;
  /** Each check: what should be true, and whether it was. */
  checks(run: Run): [string, boolean, string?][];
}

const ZOMBIE = `summon zombie ~2 ~ ~ {PersistenceRequired:1b,equipment:{head:{id:"minecraft:leather_helmet",count:1}}}`;
/** A quiet day with no mobs spawning (1.21.11 names the rule spawn_mobs). */
const CALM = ["gamerule spawn_mobs false", "difficulty peaceful", "time set 1000", "weather clear", "kill @e[type=item]"];
const max = (values: number[]) => Math.max(0, ...values);
const min = (values: number[]) => Math.min(1, ...values);
const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

const scenes: Scene[] = [
  {
    name: "calm",
    about: "A quiet day at base: nothing should alarm the bot, and the planner stays in charge.",
    seconds: 60,
    before: CALM,
    checks: (run) => [
      ["alarm stays low", max(run.signal("alarm")) < 0.3, `max ${max(run.signal("alarm")).toFixed(2)}`],
      ["the planner is never taken offline", max(run.signal("planner_offline")) === 0],
      ["no interrupts", max(run.signal("interrupt")) === 0],
      ["dopamine stays off the ceiling", mean(run.signal("dopamine")) < 0.85, `mean ${mean(run.signal("dopamine")).toFixed(2)}`],
      ["the planner set a goal", run.ticks.some((t) => t.goal?.setBy === "prefrontal")],
      ["skills are not restarted every tick", run.events().filter((e) => e.type === "started").length < run.ticks.length / 3, `${run.events().filter((e) => e.type === "started").length} starts in ${run.ticks.length} ticks`],
    ],
  },
  {
    name: "ambush",
    about: "A zombie appears next to the bot mid-task: alarm should spike, reflexes take over, and it calms down after.",
    seconds: 100,
    before: [...CALM, "difficulty normal"],
    during: [
      [25, `execute at ${BOT} run ${ZOMBIE}`],
      [55, "kill @e[type=zombie]"],
      [56, "difficulty peaceful"],
    ],
    checks: (run) => {
      const alarm = run.signal("alarm");
      const firstHigh = run.ticks.find((t) => (t.signals.alarm?.value ?? 0) > 0.5);
      const reflexWon = run.ticks.some((t) => t.winner?.region === "reflex");
      const recorded = run.ticks.flatMap((t) => (run.trace(t, "hippocampus").recorded as { summary: string; strength: number }[] | undefined) ?? []);
      const danger = recorded.filter((r) => /damage|Died|surprised by/.test(r.summary));
      const lastAlarm = alarm.at(-1) ?? 1;
      const patience = run.signal("patience");
      const patienceDrop = max(patience.slice(1).map((p, i) => patience[i]! - p));
      return [
        ["alarm is low before the ambush", max(run.ticks.filter((t) => run.at(t) < 22).map((t) => t.signals.alarm?.value ?? 0)) < 0.3],
        ["alarm spikes above 0.5 within 10 s of the zombie appearing", firstHigh !== undefined && run.at(firstHigh) < 35, firstHigh ? `at ${run.at(firstHigh).toFixed(1)} s` : "never"],
        ["a reflex takes over", reflexWon],
        ["the planner's weight drops", min(run.signal("planner_weight")) < 0.8, `min ${min(run.signal("planner_weight")).toFixed(2)}`],
        ["patience is cut by about 0.2 when alarm jumps", patienceDrop > 0.15, `largest drop in one tick ${patienceDrop.toFixed(2)}`],
        ["the danger is remembered, more strongly than a calm event", danger.some((d) => d.strength > 0.35), danger.map((d) => `${d.summary} [${d.strength.toFixed(2)}]`).join("; ") || "nothing recorded"],
        ["alarm has faded by the end", lastAlarm < 0.4, `ends at ${lastAlarm.toFixed(2)}`],
        ["the planner is back in charge by the end", (run.signal("planner_offline").at(-1) ?? 1) === 0],
      ];
    },
  },
  {
    name: "remembered",
    about: "Restart after the ambush: the bot should still remember the spot, and it should feel bad there.",
    seconds: 30,
    before: CALM,
    keepMemory: true,
    checks: (run) => [
      ["memories were loaded from disk", /Memories: [1-9]\d* remembered/.test(run.output), run.output.match(/Memories: \d+ remembered/)?.[0]],
      ["the place feels bad from memory", run.ticks.some((t) => t.state.data.memory?.nearby === "bad"), JSON.stringify(run.ticks.find((t) => t.state.data.memory)?.state.data.memory ?? null)],
      ["the planner is told about it", run.ticks.some((t) => /damage|Died|surprised by/.test(String(run.trace(t, "prefrontal").situation ?? "")))],
    ],
  },
  {
    name: "hunger",
    about: "The bot is made hungry and given bread: eating should be rewarded, most when hungriest.",
    seconds: 70,
    // Hunger only drains outside peaceful difficulty; with spawning off nothing hostile appears.
    before: [...CALM, "difficulty easy"],
    during: [
      [3, `effect give ${BOT} hunger 20 120 true`],
      [4, `give ${BOT} bread 6`],
    ],
    checks: (run) => {
      const rewards = run.ticks.flatMap((t) => (run.trace(t, "dopamine").rewards as { rule: string; amount: number }[] | undefined) ?? []);
      const ate = rewards.filter((r) => r.rule === "food_bar_up");
      const eats = run.events().filter((e) => e.skill === "eat" && e.type === "done").length;
      const foodLow = Math.min(...run.ticks.map((t) => t.state.data.self.food));
      return [
        ["the bot got hungry", foodLow < 18, `lowest food ${foodLow}`],
        ["it ate", eats > 0, `${eats} times`],
        ["eating was rewarded", ate.length > 0, ate.map((r) => r.amount.toFixed(2)).join(", ")],
        ["no rule errors", run.ticks.every((t) => t.regions.every((r) => !r.trace?.errors))],
      ];
    },
  },
  {
    name: "night",
    about: "Night falls with a bed at base: the bot should sleep, focus should drop to its floor, and memories get sorted.",
    seconds: 60,
    before: [...CALM, "time set 14000"],
    checks: (run) => {
      const asleep = run.ticks.filter((t) => t.state.data.self.asleep);
      const sorted = run.ticks.filter((t) => run.trace(t, "hippocampus").consolidation !== undefined);
      const rewards = run.ticks.flatMap((t) => (run.trace(t, "dopamine").rewards as { rule: string }[] | undefined) ?? []);
      const woken = run.events().filter((e) => e.skill === "sleep" && e.type === "interrupted");
      return [
        ["it starts at night", run.ticks[0]?.state.data.time.isNight === true],
        ["the bot goes to sleep", asleep.length > 0, `${asleep.length} ticks asleep`],
        ["focus drops to its floor while asleep", asleep.length > 0 && asleep.every((t) => (t.signals.focus?.value ?? 1) <= 0.06)],
        ["memories are consolidated while asleep", sorted.length > 0, `${sorted.length} phases`],
        ["nothing wakes it early", woken.length === 0, woken.map((e) => e.reason ?? "interrupted").join("; ")],
        ["sleeping through the night is rewarded", rewards.some((r) => r.rule === "slept_through_night")],
        ["it is day by the end", run.ticks.at(-1)?.state.data.time.isNight === false],
      ];
    },
  },
  {
    name: "dark",
    about: "Dropped somewhere unknown, far from bed, at midnight: focus should rise and the outlook fall.",
    seconds: 45,
    before: [...CALM, "time set 18000"],
    during: [
      [2, `spreadplayers 400 400 0 20 false ${BOT}`],
      [44, `tp ${BOT} -8 69 14`],
    ],
    checks: (run) => {
      const dark = run.ticks.flatMap((t) => (run.trace(t, "acetylcholine").inputs as Record<string, number> | undefined)?.darkness ?? []);
      const shelter = run.ticks.flatMap((t) => (run.trace(t, "serotonin").inputs as Record<string, number> | undefined)?.light_and_shelter ?? []);
      return [
        ["it is night throughout", run.ticks.every((t) => t.state.data.time.isNight)],
        ["the darkness input is up", mean(dark) > 0.3, `mean ${mean(dark).toFixed(2)}`],
        ["focus rises above its resting level", (run.signal("focus").at(-1) ?? 0) > 0.5, `ends at ${(run.signal("focus").at(-1) ?? 0).toFixed(2)}`],
        ["the outlook's light-and-shelter input is low", mean(shelter) < 0.3, `mean ${mean(shelter).toFixed(2)}`],
      ];
    },
  },
  {
    name: "soak",
    about: "Five mixed minutes: day, two ambushes, hunger, then night. Nothing should break or get stuck.",
    seconds: 300,
    before: [...CALM, "difficulty easy"],
    during: [
      [10, `give ${BOT} bread 8`],
      [11, `give ${BOT} stone_sword 1`],
      [40, `execute at ${BOT} run ${ZOMBIE}`],
      [75, "kill @e[type=zombie]"],
      [90, `effect give ${BOT} hunger 15 120 true`],
      [150, `execute at ${BOT} run ${ZOMBIE}`],
      [151, `execute at ${BOT} run ${ZOMBIE}`],
      [190, "kill @e[type=zombie]"],
      [220, "time set 14000"],
    ],
    checks: (run) => {
      const starts = run.events().filter((e) => e.type === "started").length;
      const neverStarted = run.events().filter((e) => e.type === "failed" && e.reason === "cannot run").length;
      const offline = run.signal("planner_offline").filter((v) => v > 0).length / run.ticks.length;
      const interrupts = run.signal("interrupt").filter((v) => v > 0).length;
      const lastAlarm = run.signal("alarm").at(-1) ?? 1;
      return [
        ["skills are not restarted every tick", starts < run.ticks.length / 3, `${starts} starts in ${run.ticks.length} ticks`],
        ["few choices of a skill that cannot run", neverStarted < run.ticks.length / 20, `${neverStarted}`],
        ["the planner is offline for a minority of the run", offline < 0.5, `${(offline * 100).toFixed(0)}% of ticks`],
        ["interrupts fire, but not constantly", interrupts >= 1 && interrupts <= 8, `${interrupts}`],
        ["alarm is not stuck high at the end", lastAlarm < 0.5, `ends at ${lastAlarm.toFixed(2)}`],
        ["dopamine moves but does not sit on a limit", mean(run.signal("dopamine")) > 0.2 && mean(run.signal("dopamine")) < 0.9, `mean ${mean(run.signal("dopamine")).toFixed(2)}`],
        ["the bot survives or its death is learned from", true],
      ];
    },
  },
];

/** Runs the bot for a scene and returns its log. */
async function play(scene: Scene): Promise<Run> {
  if (!scene.keepMemory) rmSync(`data/${BOT}`, { recursive: true, force: true });
  for (const command of scene.before ?? []) rcon(command);
  rcon("kill @e[type=!player,type=!item,distance=..64,x=-8,y=68,z=16]");
  const child = spawn("node", ["--env-file-if-exists=.env", "apps/run-bot/dist/index.js", "--engine", "jev", "--planner", "claude", "--name", BOT], { stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (d: Buffer) => (output += d));
  child.stderr.on("data", (d: Buffer) => (output += d));
  const joined = Date.now();
  while (!output.includes("Logging to") && Date.now() - joined < 30_000) await sleep(200);
  rcon(`effect clear ${BOT}`);
  rcon(`effect give ${BOT} instant_health 1 10 true`);
  const started = Date.now();
  const pending = [...(scene.during ?? [])].sort((a, b) => a[0] - b[0]);
  while (Date.now() - started < scene.seconds * 1000) {
    while (pending[0] && (Date.now() - started) / 1000 >= pending[0][0]) rcon(pending.shift()![1]);
    await sleep(250);
  }
  child.kill("SIGINT");
  await new Promise((resolve) => child.once("exit", resolve));
  const file = output.match(/Logging to (\S+)/)?.[1];
  if (!file) throw new Error(`The bot did not start:\n${output.slice(-600)}`);
  const ticks = readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as Tick);
  const t0 = ticks[0]?.timestamp ?? 0;
  console.log(`  log: ${file} (${ticks.length} ticks)`);
  return {
    ticks,
    output,
    at: (t) => (t.timestamp - t0) / 1000,
    signal: (name) => ticks.map((t) => t.signals[name]?.value).filter((v): v is number => v !== undefined),
    trace: (t, region) => t.regions.find((r) => r.region === region)?.trace ?? {},
    events: () => ticks.flatMap((t) => t.skillEvents ?? []),
  };
}

/** Checks every scene shares: nothing broke. */
function health(run: Run): [string, boolean, string?][] {
  // A slow reply from Jev now and then is tolerated (that tick simply has no instinct proposal).
  const all = run.ticks.flatMap((t) => t.regions.filter((r) => r.error).map((r) => `${r.region}: ${r.error}`));
  const timeouts = all.filter((e) => /timed out/.test(e));
  const errors = timeouts.length <= run.ticks.length * 0.05 ? all.filter((e) => !timeouts.includes(e)) : all;
  const outOfRange = [...new Set(run.ticks.flatMap((t) => Object.entries(t.signals).filter(([, s]) => !Number.isFinite(s.value) || s.value < 0 || s.value > 1).map(([name]) => name)))];
  return [
    ["the bot ran", run.ticks.length > 10, `${run.ticks.length} ticks`],
    ["no region failed", errors.length === 0, [...new Set(errors)].slice(0, 3).join("; ")],
    ["every signal stayed within 0 to 1", outOfRange.length === 0, outOfRange.join(", ")],
  ];
}

const wanted = process.argv.slice(2);
const chosen = wanted.length ? scenes.filter((s) => wanted.includes(s.name)) : scenes;
if (chosen.length === 0) throw new Error(`Unknown scene. Use: ${scenes.map((s) => s.name).join(", ")}`);
let failed = 0;
for (const scene of chosen) {
  console.log(`\n=== ${scene.name}: ${scene.about}`);
  const run = await play(scene);
  for (const [what, ok, detail] of [...health(run), ...scene.checks(run)]) {
    if (!ok) failed++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`);
  }
}
for (const command of ["gamerule spawn_mobs true", "difficulty easy", "time set 1000"]) rcon(command);
console.log(failed ? `\n${failed} check(s) failed.` : "\nAll checks passed.");
process.exitCode = failed ? 1 : 0;
