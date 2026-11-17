// Live check of the medulla on the test server: the urge to breathe and its hard limit, eating
// to heal, starving, learning a bad food, taking a cure, and a need arising during sleep.
// Each scene runs the real bot and is judged from its own tick log.
// Needs the server container (MC_CONTAINER, default familiar-m6); the two dive scenes also need
// TYPESAFE_API_KEY in .env (they use Jev, so that something competes with the urge).
//   pnpm medulla-check [scene ...]
import { spawn } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { buildPlaza, rcon, sleep } from "./primitive-check/world.ts";

/** Everything but instinct: only the reflexes and the medulla decide, plus typed commands. */
const UPKEEP_ONLY = "reflex,medulla,brainstem,acetylcholine,dopamine,noradrenaline,hippocampus,serotonin,prefrontal";
const PLAZA_SPOT = "60.5 151 40.5 180 0";
const BASE_SPOT = "-8 69 14";

interface Tick {
  timestamp: number;
  state: { data: { self: { health: number; food: number; air: number; inWater: boolean; asleep: boolean; effects: string[]; deaths: number; inventory: Record<string, number> } } };
  winner: { region: string; urgency: number; action: { skill?: string; target?: string }; reason: string } | null;
  regions: { region: string; proposals: { action: { skill?: string }; urgency: number }[]; trace?: { urges?: { rule: string; base: number; gain: number; urgency: number }[]; rules?: { rule: string; kind: string }[]; urgeWhileAsleep?: string[] } }[];
  signals: Record<string, { value: number }>;
  skillEvents?: { skill: string; type: string; reason?: string; changes?: Record<string, unknown> }[];
}

interface Options {
  bot: string;
  /** Run the whole brain with Jev (default: reflexes and medulla only). */
  jev?: boolean;
  plan?: object;
  /** Where it starts. Default: the plaza. */
  at?: string;
}

/** Runs the real bot; `act` scripts the scene while it runs. Returns its ticks and what it printed. */
async function play(options: Options, act: (bot: { say(command: string): void; output(): string }) => Promise<void>): Promise<{ ticks: Tick[]; output: string }> {
  const { bot } = options;
  rmSync(`data/${bot}`, { recursive: true, force: true });
  const plan = options.plan ? ["--plan", JSON.stringify(options.plan)] : [];
  const brain = options.jev ? ["--engine", "jev"] : ["--engine", "echo", "--regions", UPKEEP_ONLY];
  const child = spawn("node", ["--env-file-if-exists=.env", "apps/run-bot/dist/index.js", ...brain, "--planner", "echo", ...plan, "--manual", "--name", bot], { stdio: ["pipe", "pipe", "pipe"] });
  let output = "";
  let exited = false;
  child.stdout.on("data", (d: Buffer) => (output += d));
  child.stderr.on("data", (d: Buffer) => (output += d));
  child.once("exit", () => (exited = true));
  const joined = Date.now();
  while (!output.includes("Logging to") && !exited && Date.now() - joined < 30_000) await sleep(200);
  if (exited) throw new Error(`The bot stopped before it started playing:\n${output.slice(-500)}`);
  for (const command of [`gamemode survival ${bot}`, `clear ${bot}`, `effect clear ${bot}`, `effect give ${bot} instant_health 1 10 true`, `effect give ${bot} saturation 1 10 true`, `tp ${bot} ${options.at ?? PLAZA_SPOT}`]) rcon(command);
  await sleep(1500);
  try {
    await act({ say: (command) => void child.stdin.write(`${command}\n`), output: () => output });
  } finally {
    child.stdin.end();
    child.kill("SIGINT");
    const hard = setTimeout(() => child.kill("SIGKILL"), 8000);
    if (!exited) await new Promise((resolve) => child.once("exit", resolve));
    clearTimeout(hard);
    rcon(`effect clear ${bot}`);
  }
  const file = output.match(/Logging to (\S+)/)?.[1];
  if (!file) throw new Error("no log file");
  console.log(`    log: ${file}`);
  return { ticks: readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as Tick), output };
}

async function freshPlaza(): Promise<void> {
  buildPlaza();
  for (const command of ["kill @e[type=!player,x=60,y=151,z=40,distance=..40]", "fill 40 151 36 80 160 44 air", "fill 40 140 35 80 148 45 air", "fill 40 149 36 80 150 44 stone"]) rcon(command);
  await sleep(500);
}

const selfOf = (t: Tick) => t.state.data.self;
const lowest = (ticks: Tick[], key: "air" | "food" | "health") => Math.min(...ticks.map((t) => selfOf(t)[key]));
const eventsOf = (ticks: Tick[], skill: string, type?: string) => ticks.flatMap((t) => (t.skillEvents ?? []).filter((e) => e.skill === skill && (!type || e.type === type)));
const urges = (ticks: Tick[], rule: string) => ticks.flatMap((t) => t.regions.flatMap((r) => (r.region === "medulla" ? (r.trace?.urges ?? []).filter((u) => u.rule === rule) : [])));
const hardFired = (ticks: Tick[], rule: string) => ticks.filter((t) => t.regions.some((r) => r.region === "reflex" && r.trace?.rules?.some((f) => f.rule === rule))).length;
/** The bot's food level as the server has it. */
const foodNow = (bot: string) => Number(/(-?\d+)$/.exec(rcon(`data get entity ${bot} foodLevel`))?.[1] ?? NaN);
/** Makes the bot hungry: drains its food bar to `level` or below. `gently` drains slowly enough to stop close to the level. */
async function starveTo(bot: string, level: number, gently = false): Promise<void> {
  rcon(`effect give ${bot} hunger 60 ${gently ? 60 : 255} true`);
  for (let i = 0; i < 150 && !(foodNow(bot) <= level); i++) await sleep(200);
  rcon(`effect clear ${bot}`);
  await sleep(300);
}

interface Row {
  scene: string;
  outcome: string;
  lowest: string;
  learned: string;
  ok: boolean;
}

/** Puts the bot at the bottom of a glass tank of water five deep, with air at the top. */
async function dive(scene: string, holdBack: string[]): Promise<Row> {
  await freshPlaza();
  for (const command of ["fill 68 151 38 72 159 42 glass hollow", "fill 69 152 39 71 156 41 water"]) rcon(command);
  // Held back, the goal insists on staying down. Free, it only says why the bot is there: a goal that
  // tells Jev to stay still makes Jev so sure of idling that it outvotes the urge by itself.
  const goal = holdBack.length ? "Stay still at the bottom of the pool. Do not move or do anything else." : "Have a look at the bottom of the pool.";
  const { ticks } = await play({ bot: "Tester", jev: true, plan: { goal, ...(holdBack.length ? { holdBack } : {}) } }, async () => {
    await sleep(holdBack.length ? 16_000 : 2000); // the fixed plan (and its hold-back) arrives with the planner's first run
    rcon("tp Tester 70.5 152 40.5");
    await sleep(40_000);
  });
  const under = ticks.filter((t) => selfOf(t).inWater);
  const firstUp = under.find((t) => t.winner?.action.skill === "surface");
  const by = firstUp ? `${firstUp.winner!.region} (${firstUp.winner!.region === "medulla" ? "the soft urge" : "the hard reflex"}, urgency ${firstUp.winner!.urgency.toFixed(2)})` : "nothing";
  const air = firstUp ? selfOf(firstUp).air : NaN;
  const felt = urges(ticks, "need_air");
  const range = felt.length ? `${Math.min(...felt.map((u) => u.urgency)).toFixed(2)} to ${Math.max(...felt.map((u) => u.urgency)).toFixed(2)}` : "never fired";
  const lived = ticks.every((t) => selfOf(t).deaths === 0);
  const outcome = `first surfaced at air ${air} by ${by}; need_air urgency ${range}; drowning fired ${hardFired(ticks, "drowning")} ticks; ${lived ? "lived" : "DIED"}, lowest health ${lowest(ticks, "health")}`;
  const ok = holdBack.length ? firstUp?.winner?.region === "reflex" && air <= 6 && lived : firstUp?.winner?.region === "medulla" && air > 6 && lived;
  return { scene, outcome, lowest: `air ${lowest(under, "air")}`, learned: "", ok: ok === true };
}

const scenes: Record<string, () => Promise<Row>> = {
  /** 1. Dive: it surfaces from the soft urge, well before the hard limit. */
  dive: () => dive("dive", []),
  /** 2. Dive with the urge held back: it stays down, then drowning takes over at 6. */
  dive_held: () => dive("dive, need_air held back", ["need_air"]),

  /** 3. Heal: hurt to half health, the food bar just below healing level, bread to hand. */
  async heal() {
    await freshPlaza();
    let hurtAt = 0;
    const { ticks } = await play({ bot: "Tester" }, async () => {
      await starveTo("Tester", 16);
      rcon("give Tester bread 4");
      rcon("damage Tester 10");
      hurtAt = Date.now();
      await sleep(22_000);
    });
    const after = ticks.filter((t) => t.timestamp >= hurtAt);
    const meals = eventsOf(after, "eat", "done");
    const hurt = Math.min(...after.map((t) => selfOf(t).health));
    const end = selfOf(ticks.at(-1)!);
    const outcome = `eat_to_heal fired ${urges(after, "eat_to_heal").length} ticks; ate ${meals.map((e) => String(e.changes?.ate)).join("; ") || "nothing"} (until ${String(meals[0]?.changes?.until ?? "?")}); food ${lowest(after, "food")} → ${end.food}; health ${hurt} → ${end.health}`;
    return { scene: "heal", outcome, lowest: `food ${lowest(after, "food")}`, learned: "", ok: meals.length > 0 && meals[0]?.changes?.until === 18 && end.food >= 18 && end.health > hurt };
  },

  /** 4. Starving: unchanged from before. */
  async starving() {
    await freshPlaza();
    const { ticks } = await play({ bot: "Tester" }, async () => {
      rcon("give Tester bread 6");
      await starveTo("Tester", 6);
      await sleep(14_000);
    });
    const meals = eventsOf(ticks, "eat", "done");
    const end = selfOf(ticks.at(-1)!);
    return { scene: "starving", outcome: `eat_when_starving fired ${hardFired(ticks, "eat_when_starving")} ticks; ate ${meals.map((e) => String(e.changes?.ate)).join("; ") || "nothing"}; food ${lowest(ticks, "food")} → ${end.food}`, lowest: `food ${lowest(ticks, "food")}`, learned: "", ok: meals.length > 0 && end.food >= 18 };
  },

  /** 5. Bad food: a bot born knowing nothing about food learns that spider eyes poison it, then picks bread. */
  async bad_food() {
    await freshPlaza();
    const bot = "Naive";
    const { ticks, output } = await play({ bot }, async ({ say }) => {
      // It has eaten something harmless before, so the spider eye is not the only food it knows.
      // (The test makes it hungry with a hunger effect, which is itself an illness: each meal is
      // kept well clear of it, so the food is not blamed for the test's own doing.)
      await starveTo(bot, 13, true);
      await sleep(1000);
      rcon(`give ${bot} bread 1`);
      say("do consume item:bread");
      await sleep(8000);
      rcon(`give ${bot} spider_eye 2`);
      for (let meal = 0; meal < 2; meal++) {
        if (meal > 0) await starveTo(bot, 17, true); // a full bot cannot eat
        say("do consume item:spider_eye");
        await sleep(meal === 0 ? 34_000 : 8000); // incidents must be 30 seconds apart
        rcon(`effect clear ${bot}`);
        rcon(`effect give ${bot} instant_health 1 10 true`);
      }
      // Now offered both, and starving: which does it eat?
      rcon(`give ${bot} spider_eye 4`);
      rcon(`give ${bot} bread 4`);
      await starveTo(bot, 6);
      await sleep(12_000);
    });
    const taught = /learned that (\w+) is bad to eat/.exec(output)?.[1] ?? "";
    for (const line of output.split("\n").filter((l) => l.includes("medulla:") || l.includes("consume"))) console.log(`      ${line.trim().slice(0, 200)}`);
    const poisoned = ticks.filter((t, i) => i > 0 && selfOf(t).effects.includes("poison") && !selfOf(ticks[i - 1]!).effects.includes("poison")).length;
    const last = eventsOf(ticks, "eat", "done").at(-1);
    const choice = String(last?.changes?.ate ?? "nothing");
    const outcome = `poisoned ${poisoned} times by its meals; then, starving with both to hand, ate: ${choice}; still carries ${selfOf(ticks.at(-1)!).inventory.spider_eye ?? 0} spider eyes`;
    return { scene: "bad food", outcome, lowest: `food ${lowest(ticks, "food")}`, learned: taught, ok: taught === "spider_eye" && choice.includes("bread") && !choice.includes("spider_eye") };
  },

  /** 6. Cure: poisoned, with milk in the inventory. */
  async cure() {
    await freshPlaza();
    let poisonedAt = 0;
    const { ticks } = await play({ bot: "Tester" }, async () => {
      rcon("give Tester milk_bucket 1");
      await sleep(500);
      rcon("effect give Tester poison 30 0");
      poisonedAt = Date.now();
      await sleep(9000);
    });
    const drank = ticks.find((t) => (t.skillEvents ?? []).some((e) => e.skill === "consume" && e.type === "done"));
    const cured = ticks.find((t) => t.timestamp > poisonedAt + 500 && !selfOf(t).effects.includes("poison"));
    const sick = Math.max(0, ...ticks.map((t) => t.signals.sick?.value ?? 0));
    const outcome = `sick signal reached ${sick.toFixed(1)}; cure fired ${urges(ticks, "cure").length} ticks; ${drank ? `drank the milk ${((drank.timestamp - poisonedAt) / 1000).toFixed(1)} s after being poisoned` : "did not drink"}; ${cured ? `poison gone ${((cured.timestamp - poisonedAt) / 1000).toFixed(1)} s in (it would last 30)` : "still poisoned"}`;
    return { scene: "cure", outcome, lowest: `health ${lowest(ticks, "health")}`, learned: "", ok: drank !== undefined && cured !== undefined && cured.timestamp - poisonedAt < 15_000 };
  },

  /** 7. Asleep and hungry: the food bar falls during sleep. Does it wake, when, and why? */
  async asleep_hungry() {
    for (const command of ["gamerule spawn_mobs false", "difficulty easy", "weather clear", "gamerule players_sleeping_percentage 101", "time set 13000"]) rcon(command);
    let drainAt = 0;
    const { ticks } = await play({ bot: "Tester", at: BASE_SPOT }, async ({ say }) => {
      rcon("give Tester bread 6");
      say("do sleep");
      await sleep(9000);
      drainAt = Date.now();
      rcon("effect give Tester hunger 60 255 true");
      await sleep(40_000);
    });
    for (const command of ["gamerule players_sleeping_percentage 100", "time set 1000"]) rcon(command);
    const slept = ticks.filter((t) => selfOf(t).asleep);
    const woke = ticks.find((t) => t.timestamp > drainAt && (t.skillEvents ?? []).some((e) => e.skill === "sleep" && e.type !== "started"));
    const eatWon = ticks.find((t) => t.timestamp > drainAt && t.winner?.action.skill === "eat");
    const noted = [...new Set(ticks.flatMap((t) => t.regions.flatMap((r) => r.trace?.urgeWhileAsleep ?? [])))];
    const starvingAt = ticks.find((t) => t.timestamp > drainAt && selfOf(t).food <= 6);
    const wait = eatWon && starvingAt ? ((eatWon.timestamp - starvingAt.timestamp) / 1000).toFixed(1) : "?";
    const outcome = slept.length === 0 ? "it never got to sleep" : `asleep ${slept.length} ticks; ${eatWon ? `woke to eat at food ${selfOf(eatWon).food} and health ${selfOf(eatWon).health}, ${wait} s after it became starving (food 6), by ${eatWon.winner!.region} (${eatWon.winner!.reason.split(";")[0]})` : "did not wake to eat"}; upkeep urges noted while asleep: ${noted.join(", ") || "none"}; sleep ended: ${woke ? (woke.skillEvents ?? []).filter((e) => e.skill === "sleep").map((e) => `${e.type}${e.reason ? ` (${e.reason})` : ""}`).join(", ") : "it did not"}`;
    return { scene: "asleep and hungry", outcome, lowest: `food ${lowest(ticks, "food")}`, learned: "", ok: slept.length > 0 };
  },
};

const wanted = process.argv.slice(2);
const rows: Row[] = [];
try {
  for (const [name, run] of Object.entries(scenes)) {
    if (wanted.length && !wanted.includes(name)) continue;
    console.log(`=== ${name}`);
    const row = await run().catch((error: unknown): Row => ({ scene: name, outcome: `ERROR: ${error instanceof Error ? error.message : error}`, lowest: "", learned: "", ok: false }));
    rows.push(row);
    console.log(`    ${row.ok ? "ok" : "NOT ok"}: ${row.outcome}`);
  }
} finally {
  for (const command of ["kill @e[type=!player,x=60,y=151,z=40,distance=..40]", "fill 40 151 35 80 160 45 air", "fill 40 149 36 80 150 44 stone", "fill 39 151 35 81 152 35 glass", "fill 39 151 45 81 152 45 glass", "gamerule spawn_mobs true", "forceload remove 39 35 81 45", `tp Tester ${BASE_SPOT}`, `tp Naive ${BASE_SPOT}`]) rcon(command);
}

const table = [["scene", "outcome", "lowest reached", "learned", "ok"], ...rows.map((r) => [r.scene, r.outcome.split(";")[0]!, r.lowest, r.learned, r.ok ? "yes" : "NO"])];
const widths = table[0]!.map((_, c) => Math.max(...table.map((r) => r[c]!.length)));
console.log("");
for (const [i, r] of table.entries()) {
  console.log(r.map((cell, c) => cell.padEnd(widths[c]!)).join(" | "));
  if (i === 0) console.log(widths.map((w) => "-".repeat(w)).join("-|-"));
}
const failed = rows.filter((r) => !r.ok);
console.log(failed.length ? `\nFAIL: ${failed.map((r) => r.scene).join(", ")}` : `\nPASS: all ${rows.length} scenes.`);
process.exit(failed.length ? 1 : 0);
