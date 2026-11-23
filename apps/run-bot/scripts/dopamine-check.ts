// Live check of dopamine on the test server: what it is paid for, who gets the credit, and what
// it then wants, in situations the unit tests only imagine. Each scene runs the real bot and
// reports what its own tick log and saved scorebook say; a scene is marked a PROBLEM when the
// numbers show dopamine learning or paying the wrong thing, not when the run breaks.
// No Jev and no planner calls: only the reflexes, dopamine's own cues and typed commands act
// (except the with_jev scene, which runs the whole brain to see whether a want can win there).
// Needs the server container (MC_CONTAINER, default familiar-m6).
//   pnpm dopamine-check [scene ...]
import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { buildPlaza, rcon, sleep } from "./primitive-check/world.ts";

/** Everything but instinct: reflexes, upkeep, dopamine and the echo planner (for a fixed plan). */
// LESION=hypothalamus (or any names, comma-separated) leaves those out too.
const LESION = (process.env.LESION ?? "").split(",").filter(Boolean);
const NO_INSTINCT = "reflex,medulla,hypothalamus,brainstem,acetylcholine,dopamine,noradrenaline,hippocampus,serotonin,prefrontal"
  .split(",")
  .filter((name) => !LESION.includes(name))
  .join(",");
const BOT = "Tester";
const HOME = "60.5 151 40.5 -90 0";
const BASE_SPOT = "-8 69 14";
const FAR_CHEST = "74 151 40";
const NEAR_CHEST = "64 151 40";
const chestTarget = (at: string) => `pos:${at.split(" ").join(",")}`;
/** Wants more bread than is enough to feel stocked (8), so the skill can still run when the need is met. */
const WANTS_MUCH_BREAD = { goal: "Carry sixteen bread.", steps: [], reason: "", wants: [{ item: "bread", count: 16 }] };
const WANTS_BREAD = { goal: "Carry four bread.", steps: [], reason: "", wants: [{ item: "bread", count: 4 }] };

interface Reward {
  rule: string;
  amount: number;
  reason: string;
}
interface Episode {
  skill: string;
  toward?: string;
  ended: string;
  outcome: number;
  surprise: number;
  expected: number;
  /** How far a run cut short was still trusted to have been going to pay (absent: in full). */
  trust?: number;
  wasted?: number;
  effort?: number;
  gained?: number;
}
interface Tick {
  tick: number;
  timestamp: number;
  state: { data: { time: { isNight: boolean; lightLevel: number }; self: { health: number; food: number; deaths: number; position: { x: number; y: number; z: number }; inventory: Record<string, number>; foodItems?: number }; nearby?: { blocks?: { id: string; type: string }[]; mobs?: { hostile: boolean; reachable: boolean; dist: number }[] }; current: { skill: string } | null } };
  winner: { region: string; urgency: number; action: { skill?: string; target?: string }; reason: string } | null;
  regions: { region: string; trace?: { situation?: string; rewards?: Reward[]; total?: number; episodes?: Episode[]; cues?: { thing: { id: string; kind: string; extraWork?: number }; skill: string; want: number; needs: Record<string, number> }[] } }[];
  signals: Record<string, { value: number }>;
  skillEvents?: { skill: string; type: string; reason?: string; target?: string }[];
}
/** One saved adjustment of the scorebook: what one feature of a run adds (e.g. "idle", "idle | day", "take_items → chest # pos:74,151,40"). */
interface Score {
  feature: string;
  expected: number;
  benefit: number;
  cost: number;
  runs: number;
  successes: number;
}
interface Run {
  ticks: Tick[];
  output: string;
  scorebook: Score[];
}

/** Runs the real bot; `act` scripts the scene while it runs. Returns its ticks and the scorebook it saved. */
async function play(plan: object | undefined, act: (bot: { say(command: string): void }) => Promise<void>, brain: "reflexes" | "whole" = "reflexes"): Promise<Run> {
  rmSync(`data/${BOT}`, { recursive: true, force: true });
  const planArgs = plan ? ["--plan", JSON.stringify(plan)] : [];
  const child = spawn("node", ["--env-file-if-exists=.env", "apps/run-bot/dist/index.js", ...(brain === "whole" ? ["--engine", "jev"] : ["--engine", "echo", "--regions", NO_INSTINCT]), "--planner", "echo", ...planArgs, "--manual", "--name", BOT], { stdio: ["pipe", "pipe", "pipe"] });
  let output = "";
  let exited = false;
  child.stdout.on("data", (d: Buffer) => (output += d));
  child.stderr.on("data", (d: Buffer) => (output += d));
  child.once("exit", () => (exited = true));
  const joined = Date.now();
  while (!output.includes("Logging to") && !exited && Date.now() - joined < 30_000) await sleep(200);
  if (exited) throw new Error(`The bot stopped before it started playing:\n${output.slice(-500)}`);
  for (const command of [`gamemode survival ${BOT}`, `clear ${BOT}`, `effect clear ${BOT}`, `effect give ${BOT} instant_health 1 10 true`, `effect give ${BOT} saturation 1 10 true`, `tp ${BOT} ${HOME}`]) rcon(command);
  await sleep(2500); // long enough for the first sight of the plaza (novelty) to pass
  try {
    await act({ say: (command) => void child.stdin.write(`${command}\n`) });
  } finally {
    child.stdin.end();
    child.kill("SIGINT");
    const hard = setTimeout(() => child.kill("SIGKILL"), 8000);
    if (!exited) await new Promise((resolve) => child.once("exit", resolve));
    clearTimeout(hard);
    rcon(`effect clear ${BOT}`);
  }
  const file = output.match(/Logging to (\S+)/)?.[1];
  if (!file) throw new Error("no log file");
  console.log(`    log: ${file}`);
  const ticks = readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as Tick);
  const saved = `data/${BOT}/scorebook.json`;
  const book = existsSync(saved) ? (JSON.parse(readFileSync(saved, "utf8")) as Score[] | { entries: Score[] }) : [];
  return { ticks, output, scorebook: Array.isArray(book) ? book : book.entries };
}

async function freshPlaza(): Promise<void> {
  buildPlaza();
  for (const command of ["kill @e[type=!player,x=60,y=151,z=40,distance=..40]", "fill 40 151 36 80 160 44 air", "fill 40 140 35 80 148 45 air", "fill 40 149 36 80 150 44 stone", "time set 1000"]) rcon(command);
  await sleep(500);
}

const dopamineOf = (t: Tick) => t.regions.find((r) => r.region === "dopamine")?.trace ?? {};
const rewardsIn = (ticks: Tick[]) => ticks.flatMap((t) => (dopamineOf(t).rewards ?? []).map((r) => ({ ...r, tick: t.tick, timestamp: t.timestamp, running: t.state.data.current?.skill ?? "(none)" })));
const episodesIn = (ticks: Tick[]) => ticks.flatMap((t) => dopamineOf(t).episodes ?? []);
const cuesIn = (ticks: Tick[]) => ticks.flatMap((t) => dopamineOf(t).cues ?? []);
const cueWins = (ticks: Tick[]) => ticks.filter((t) => t.winner?.region === "dopamine");
const da = (t: Tick | undefined) => t?.signals.dopamine?.value ?? NaN;
const after = (ticks: Tick[], at: number) => ticks.filter((t) => t.timestamp >= at);
const between = (ticks: Tick[], from: number, to: number) => ticks.filter((t) => t.timestamp >= from && t.timestamp < to);
const n = (x: number, digits = 2) => (Number.isFinite(x) ? x.toFixed(digits) : "?");
const signed = (x: number) => `${x >= 0 ? "+" : ""}${n(x)}`;
/** Rewards added up by rule, e.g. "died -1.00, health -0.84". */
function byRule(rewards: Reward[]): string {
  const sums = new Map<string, number>();
  for (const r of rewards) sums.set(r.rule, (sums.get(r.rule) ?? 0) + r.amount);
  return [...sums].map(([rule, sum]) => `${rule} ${signed(sum)}`).join(", ") || "none";
}
const net = (rewards: Reward[]) => rewards.reduce((sum, r) => sum + r.amount, 0);
/** What the arbiter would add to a skill's score from what was learned, at resting DA: 0.2 × (benefit − cost). */
const arbiterShift = (s: Pick<Score, "benefit" | "cost">) => 0.2 * (s.benefit - s.cost);
/** A skill's value with every adjustment it has put together (the skill and each label it was learned under): expectations add, benefit and cost multiply. */
function strongest(book: Score[], skill: string): Score | undefined {
  const parts = book.filter((e) => e.feature === skill || e.feature.startsWith(`${skill} | `));
  if (!parts.length) return undefined;
  return parts.reduce((sum, e) => ({ ...sum, expected: sum.expected + e.expected, benefit: sum.benefit * e.benefit, cost: sum.cost * e.cost }), { feature: skill, expected: 0, benefit: 1, cost: 1, runs: 0, successes: 0 });
}
const describe = (e: Score | undefined) => (e ? `expected ${signed(e.expected)}, benefit ${n(e.benefit)}, cost ${n(e.cost)}, arbiter ${signed(arbiterShift(e))}` : "never learned");
/** What aiming a skill at one particular thing has been learned to add, e.g. for "pos:74,151,40". */
const thingPart = (book: Score[], id: string) => book.filter((e) => e.feature.endsWith(`# ${id}`)).map((e) => `${e.feature}: ${signed(e.expected)}`).join("; ") || "nothing";
const foodNow = () => Number(/(-?\d+)$/.exec(rcon(`data get entity ${BOT} foodLevel`))?.[1] ?? NaN);
async function starveTo(level: number): Promise<void> {
  rcon(`effect give ${BOT} hunger 60 255 true`);
  for (let i = 0; i < 150 && !(foodNow() <= level); i++) await sleep(200);
  rcon(`effect clear ${BOT}`);
  await sleep(300);
}
function chest(at: string, bread: number): void {
  rcon(`setblock ${at} air`);
  rcon(`setblock ${at} chest`);
  if (bread > 0) rcon(`item replace block ${at} container.0 with bread ${bread}`);
}
/** Empties the bot's pockets of bread and puts it back at home, so it is short of bread again. */
async function shortAgain(at = HOME): Promise<void> {
  // Moved first, then emptied: emptied first, the want can start a trip that the move then strands.
  rcon(`tp ${BOT} ${at}`);
  rcon(`clear ${BOT} bread`);
  await sleep(600);
}
/** The trips to a chest, from the take_items episodes: what each earned and what was expected after. */
const trips = (ticks: Tick[]) => episodesIn(ticks).filter((e) => e.skill === "take_items");
const tripLine = (e: Episode) => `${e.ended} ${signed(e.outcome)}${e.wasted ? ` (wasted ${n(e.wasted, 3)})` : ""}→exp ${signed(e.expected)}`;

interface Row {
  scene: string;
  saw: string;
  problem: string;
}

/** A bot that wants bread, with a full chest 14 blocks off; it is sent there once by hand. */
async function learnChest(say: (c: string) => void, tripsByHand = 1): Promise<void> {
  await sleep(17_000); // the fixed plan (and what it wants carried) arrives with the planner's first run
  for (let i = 0; i < tripsByHand; i++) {
    say(`do take_items ${chestTarget(FAR_CHEST)}`);
    await sleep(8000);
    await shortAgain();
  }
}

const scenes: Record<string, () => Promise<Row>> = {
  /** 1. Dying hungry and hurt, next to a threat: what does the whole death add up to? */
  async death() {
    await freshPlaza();
    let killedAt = 0;
    const { ticks } = await play(undefined, async () => {
      await starveTo(8);
      rcon(`damage ${BOT} 8`);
      rcon("summon husk 63 151 40 {IsBaby:0b,NoAI:1b}");
      await sleep(4000);
      killedAt = Date.now();
      rcon(`kill ${BOT}`);
      await sleep(12_000);
    });
    const before = between(ticks, killedAt - 3000, killedAt).at(-1);
    const rewards = rewardsIn(after(ticks, killedAt - 200));
    const total = net(rewards);
    const end = ticks.at(-1);
    const good = net(rewards.filter((r) => r.amount > 0));
    return {
      scene: "death",
      saw: `dying (food ${before?.state.data.self.food}, health ${before?.state.data.self.health}, husk beside it) added up to ${signed(total)}: ${byRule(rewards)}; DA ${n(da(before))} → ${n(da(end))}; deaths ${end?.state.data.self.deaths}`,
      problem: total > -0.75 ? `dying came out at ${signed(total)} (${signed(good)} of gains against -1 for dying)` : "",
    };
  },

  /** 2. Falls that hurt, then falls with water in reach: is the righting reflex blamed for the fall? */
  async fall() {
    await freshPlaza();
    let pooled = 0;
    const { ticks, scorebook } = await play(undefined, async ({ say }) => {
      // Ten hard landings with nothing running: what falling is worth is learned whatever skill is on.
      for (let i = 0; i < 10; i++) {
        rcon(`tp ${BOT} 60.5 164 40.5`);
        await sleep(3500);
        rcon(`effect give ${BOT} instant_health 1 10 true`);
        await sleep(1000);
      }
      // Now a one-block pool beside where it lands, and a skill running when it is dropped.
      rcon("setblock 61 150 40 water");
      pooled = Date.now();
      for (let i = 0; i < 3; i++) {
        say("do idle");
        await sleep(1500);
        rcon(`tp ${BOT} 60.5 160 40.5`);
        await sleep(4500);
        rcon(`effect give ${BOT} instant_health 1 10 true`);
        rcon(`tp ${BOT} ${HOME}`);
        await sleep(1500);
      }
    });
    const hurt = rewardsIn(ticks).filter((r) => r.rule === "health" && r.amount < 0);
    const falling = scorebook.find((e) => e.feature === "(situation) | falling");
    const steer = strongest(scorebook, "air_steer");
    const runs = (ticks.flatMap((t) => dopamineOf(t).episodes ?? []) as (Episode & { shift?: number })[]).filter((e) => e.skill === "air_steer" || e.skill === "idle");
    const line = (e: Episode & { shift?: number }) => `${e.skill} ${e.ended} ${signed(e.outcome)}${e.shift ? ` (situation ${signed(e.shift)})` : ""}`;
    return {
      scene: "fall",
      saw: `${hurt.length} hurts (${signed(net(hurt))}), ${rewardsIn(after(ticks, pooled)).filter((r) => r.rule === "health" && r.amount < 0).length} of them once the pool was there; falling is worth ${falling ? signed(falling.expected) : "nothing yet"}; air_steer: ${describe(steer)}; runs: ${runs.map(line).join(", ") || "none"}`,
      problem: steer && steer.expected < -0.03 ? `the righting reflex is blamed for the fall it was trying to soften (arbiter ${signed(arbiterShift(steer))})` : "",
    };
  },

  /** 3. Standing idle while new animals wander up and a wound mends: what does idle learn? */
  async idle_soak() {
    await freshPlaza();
    const { ticks, scorebook } = await play(undefined, async ({ say }) => {
      say("do idle");
      await sleep(1500);
      for (const [i, mob] of ["cow", "pig", "sheep", "chicken", "rabbit", "horse"].entries()) {
        rcon(`summon ${mob} ${64 + i} 151 ${38 + (i % 3) * 2} {NoAI:1b}`);
        await sleep(2500);
      }
      rcon(`damage ${BOT} 6`);
      await sleep(9000);
      say("stop");
      await sleep(2500);
    });
    const rewards = rewardsIn(ticks.slice(8));
    const whileIdle = rewards.filter((r) => r.running === "idle");
    const idle = strongest(scorebook, "idle");
    const peak = Math.max(...ticks.map(da).filter(Number.isFinite));
    return {
      scene: "idle soak",
      saw: `while idling it was paid ${signed(net(whileIdle))} (${byRule(whileIdle)}); idle: ${describe(idle)}; DA peaked at ${n(peak)}; idle episodes: ${episodesIn(ticks).filter((e) => e.skill === "idle").map((e) => `${e.ended} ${signed(e.outcome)}`).join(", ") || "none"}`,
      problem: idle && idle.expected > 0.05 ? `doing nothing was credited with what merely happened nearby: idle now gets ${signed(arbiterShift(idle))} in the arbiter` : "",
    };
  },

  /** 4. A full chest far off, then an empty one nearer, then the full one emptied: what does the bot want? */
  async two_chests() {
    await freshPlaza();
    chest(FAR_CHEST, 64);
    let phase2 = 0;
    let nearKnown = 0;
    let phase3 = 0;
    const { ticks, scorebook } = await play(WANTS_BREAD, async ({ say }) => {
      await learnChest(say);
      // Phase 1: short of bread, the full chest in view. Does the pull alone take it there? Twice.
      await sleep(9000);
      await shortAgain();
      // Phase 2: an empty chest appears, nearer than the full one.
      await sleep(9000);
      phase2 = Date.now();
      chest(NEAR_CHEST, 0);
      await shortAgain(); // short of bread with both in view: which does it want?
      await sleep(12_000);
      nearKnown = Date.now();
      await shortAgain(); // and again, now that it has looked in the near one
      await sleep(14_000);
      // Phase 3: the near chest goes; the far one is emptied behind the bot's back.
      phase3 = Date.now();
      rcon(`setblock ${NEAR_CHEST} air`);
      rcon(`data merge block ${FAR_CHEST} {Items:[]}`);
      await shortAgain();
      await sleep(25_000);
    });
    const p1 = between(ticks, 0, phase2);
    const p3 = after(ticks, phase3);
    const wonTargets = (part: Tick[]) => [...new Set(cueWins(part).map((t) => t.winner?.action.target))].join(" and ") || "nowhere";
    const charged = (part: Tick[]) => rewardsIn(part).filter((r) => r.rule === "wasted_effort");
    const bread = (part: Tick[]) => Math.max(0, ...part.map((t) => t.state.data.self.inventory.bread ?? 0));
    const near = chestTarget(NEAR_CHEST);
    const visited = (part: Tick[]) => [...new Set(part.flatMap((t) => (t.skillEvents ?? []).filter((e) => e.skill === "take_items" && e.type === "started").map((e) => e.target)))];
    const first = between(ticks, phase2, nearKnown);
    const second = between(ticks, nearKnown, phase3);
    const wentNear = visited(first).includes(near);
    const wentFarAfter = visited(second).includes(chestTarget(FAR_CHEST)) || bread(second.slice(4)) > 0;
    const saw = [
      `full chest only: the pull won ${cueWins(p1).length} ticks (to ${wonTargets(p1)}), trips ${trips(p1).map(tripLine).join("; ")}`,
      `empty chest nearer: first it set off for ${visited(first).join(", then ") || "nowhere"} (trips ${trips(first).map(tripLine).join("; ") || "none"}; wasted ${charged(first).map((r) => n(r.amount, 3)).join(", ") || "never charged"}); short again, it set off for ${visited(second).join(", then ") || "nowhere"} (trips ${trips(second).map(tripLine).join("; ") || "none"}; cues ${cuesIn(second).length}; bread got ${bread(second.slice(4))})`,
      `learned about each chest by the end: ${thingPart(scorebook, chestTarget(FAR_CHEST))} | ${thingPart(scorebook, chestTarget(NEAR_CHEST))}`,
      `full chest emptied: trips ${trips(p3).map(tripLine).join("; ") || "none"}; wasted ${charged(p3).map((r) => n(r.amount, 3)).join(", ") || "never charged"}; cues in the last 10 ticks: ${cuesIn(p3.slice(-10)).length}`,
    ].join(" | ");
    const problems = [
      cueWins(p1).length === 0 ? "the pull never moved the bot, even with nothing else proposing" : "",
      // Trying a chest it has never opened, on the strength of what chests have paid, is fine. Going back to it is not.
      visited(second).includes(near) ? "it went back to a chest it had found empty" : "",
      wentNear && !wentFarAfter ? "once the near chest was known to be empty it stopped wanting any chest, though the full one was in view (only the nearest of a kind is considered)" : "",
    ].filter(Boolean);
    return { scene: "two chests", saw, problem: problems.join("; ") };
  },

  /** 5. A learned trip that keeps being cut off on the way: does the expectation wear away? */
  async interrupted() {
    await freshPlaza();
    chest(FAR_CHEST, 64);
    const start = "42.5 151 40.5 -90 0"; // the chest is out of view from here, so no cue restarts the trip
    let from = 0;
    const { ticks } = await play(WANTS_BREAD, async ({ say }) => {
      await learnChest(say, 2);
      await shortAgain(start);
      from = Date.now();
      for (let i = 0; i < 6; i++) {
        say(`do take_items ${chestTarget(FAR_CHEST)}`);
        await sleep(1500);
        say("stop");
        await sleep(1200);
        rcon(`tp ${BOT} ${start}`);
        await sleep(600);
      }
    });
    const learned = trips(between(ticks, 0, from));
    const cut = trips(after(ticks, from));
    // The cut-off trips start out of sight of the chest, so they are judged without it; compare them with each other.
    // Each row is what was expected after that trip. One cut-off should teach nothing; several in a row should wear it down slowly.
    const expected = cut.map((e) => e.expected);
    const fellBy = (i: number) => 1 - (expected[i] ?? NaN) / (expected[0] ?? NaN);
    const problems = [
      cut.length > 1 && fellBy(1) > 0.1 ? `one more cut-off trip counted as a disappointment: expectation fell ${n(100 * fellBy(1), 0)}%` : "",
      cut.length > 4 && fellBy(cut.length - 1) > 0.7 ? `a few cut-off trips all but wiped out what was learned: expectation fell ${n(100 * fellBy(cut.length - 1), 0)}% over ${cut.length - 1}` : "",
      cut.length > 4 && !(fellBy(cut.length - 1) > 0) ? "a trip that is cut off every time is never given up on" : "",
    ].filter(Boolean);
    return {
      scene: "interrupted",
      saw: `after ${learned.length} good trips, ${cut.length} trips cut off on the way (${cut.map((e) => e.ended).join(", ")}): expected ${expected.map(signed).join(" → ")}; trusted ${cut.map((e) => n(e.trust ?? 1)).join(", ")}`,
      problem: problems.join("; "),
    };
  },

  /** 6. What was learned by day, at night. */
  async night() {
    await freshPlaza();
    chest(FAR_CHEST, 64);
    let dusk = 0;
    const { ticks } = await play(WANTS_BREAD, async ({ say }) => {
      await learnChest(say, 2);
      await sleep(9000); // by day: the pull should take it there
      dusk = Date.now();
      rcon("time set 14000");
      await shortAgain();
      await sleep(14_000);
    });
    rcon("time set 1000");
    const day = between(ticks, 0, dusk);
    const dark = after(ticks, dusk + 1500);
    const situations = [...new Set(dark.map((t) => dopamineOf(t).situation))].join(", ");
    return {
      scene: "night",
      saw: `by day the pull won ${cueWins(day).length} ticks and cues fired ${cuesIn(day).length} times; after dusk (situation ${situations}), short of bread with the same chest in view: cues ${cuesIn(dark).length}, pull won ${cueWins(dark).length}, bread got ${Math.max(0, ...dark.map((t) => t.state.data.self.inventory.bread ?? 0))}`,
      problem: cuesIn(day).length > 0 && cuesIn(dark).length === 0 ? "nothing learned by day is known at night: each situation label starts from nothing" : "",
    };
  },

  /** 7. A caged threat that vanishes while the bot stands idle, and a creeper that blows up in its face. */
  async threat_gone() {
    await freshPlaza();
    let killedAt = 0;
    let fuseAt = 0;
    const { ticks } = await play(undefined, async ({ say }) => {
      // A husk in a glass box 2 blocks off: it cannot reach the bot, and the bot does nothing about it.
      rcon("fill 62 151 39 64 153 41 glass hollow");
      rcon("summon husk 63.5 151 40.5 {IsBaby:0b,NoAI:1b}");
      say("do idle");
      await sleep(5000);
      killedAt = Date.now();
      rcon("kill @e[type=husk]");
      await sleep(4000);
      // Shut in a glass cell with a creeper about to go off (a small blast, so the bot lives).
      rcon("fill 62 151 39 64 153 41 air");
      rcon("fill 58 151 38 63 154 42 glass hollow");
      rcon(`tp ${BOT} ${HOME}`);
      rcon(`effect give ${BOT} instant_health 1 10 true`);
      await sleep(1000);
      fuseAt = Date.now();
      rcon("summon creeper 62.5 152 40.5 {ignited:1b,Fuse:30,ExplosionRadius:1b}");
      await sleep(7000);
    });
    const caged = rewardsIn(between(ticks, killedAt - 6000, killedAt + 3000)).filter((r) => r.rule === "danger");
    const blast = rewardsIn(after(ticks, fuseAt));
    const blastDanger = blast.filter((r) => r.rule === "danger");
    const did = [...new Set(between(ticks, killedAt - 4500, killedAt).map((t) => t.winner?.action.skill ?? "nothing"))].join(", ");
    const list = (rewards: typeof caged) => rewards.map((r) => `${signed(r.amount)} (${r.reason}) to ${r.running}`).join(", ") || "nothing";
    return {
      scene: "threat gone",
      saw: `a caged husk 2 blocks off appearing, then removed by the server (the bot did: ${did}): ${list(caged)}; net ${signed(net(caged))} | a creeper appearing and blowing up in its cell: ${byRule(blast)}; danger alone net ${signed(net(blastDanger))}`,
      problem: [net(caged) > 0.05 ? `a threat that came and went by itself paid ${signed(net(caged))}` : "", net(blastDanger) > 0.05 ? `a creeper coming and going off paid ${signed(net(blastDanger))} for the danger alone` : ""].filter(Boolean).join("; "),
    };
  },

  /** 8. Dropping a sword and picking it up again, over and over. */
  async sword_loop() {
    await freshPlaza();
    let from = 0;
    const { ticks } = await play(undefined, async ({ say }) => {
      rcon(`give ${BOT} stone_sword 1`);
      await sleep(2500);
      from = Date.now();
      for (let i = 0; i < 4; i++) {
        say("do drop_item item:stone_sword");
        await sleep(3200); // a dropped item cannot be picked up for 2 seconds
        say("do pick_up");
        await sleep(3000);
      }
    });
    const rewards = rewardsIn(after(ticks, from));
    const tools = rewards.filter((r) => r.rule === "tools");
    return {
      scene: "sword loop",
      saw: `4 rounds of drop and pick up: ${byRule(rewards)} (net ${signed(net(rewards))}); the tools need paid ${tools.map((r) => signed(r.amount)).join(", ") || "never"}; DA ended at ${n(da(ticks.at(-1)))}`,
      problem: net(tools) > 0.05 ? `dropping a tool and picking it up again came out ahead by ${signed(net(tools))}` : "",
    };
  },

  /** 9. At night, walking in and out of a lit corner. */
  async light_loop() {
    await freshPlaza();
    rcon("fill 72 150 38 76 150 42 glowstone");
    rcon("time set 18000");
    let from = 0;
    const { ticks } = await play(undefined, async ({ say }) => {
      await sleep(1500);
      from = Date.now();
      for (let i = 0; i < 4; i++) {
        say("do go_to pos:74,151,40");
        await sleep(5500);
        say("do go_to pos:48,151,40");
        await sleep(6500);
      }
    });
    rcon("time set 1000");
    const rewards = rewardsIn(after(ticks, from));
    const light = rewards.filter((r) => r.rule === "night_light");
    const levels = after(ticks, from).map((t) => t.state.data.time.lightLevel);
    return {
      scene: "light loop",
      saw: `4 round trips between dark (light ${Math.min(...levels)}) and lit (${Math.max(...levels)}), ending in the dark: night_light paid ${light.map((r) => signed(r.amount)).join(", ") || "never"} (net ${signed(net(light))}); all rewards: ${byRule(rewards)}; DA ended at ${n(da(ticks.at(-1)))}; go_to episodes ${episodesIn(after(ticks, from)).filter((e) => e.skill === "go_to").map((e) => signed(e.outcome)).join(", ")}`,
      problem: net(light) > 0.1 ? `walking out of the light and back came out ahead by ${signed(net(light))}` : "",
    };
  },
};

/** The strongest pull dopamine proposed in these ticks, and what it was made of. */
function strongestPull(ticks: Tick[]): string {
  const best = ticks.flatMap((t) => (dopamineOf(t).cues ?? []).map((c) => ({ ...c, da: da(t) }))).reduce<{ want: number; needs: Record<string, number>; da: number } | null>((top, c) => (c.want > (top?.want ?? 0) ? c : top), null);
  return best ? `want ${n(best.want)} (${Object.entries(best.needs).map(([need, pays]) => `${need} ${signed(pays)}`).join(", ")}) at DA ${n(best.da)}` : "none";
}
/** Who won the ticks, e.g. "dopamine take_items ×12, instinct idle ×30". */
function winners(ticks: Tick[]): string {
  const counts = new Map<string, number>();
  for (const t of ticks) if (t.winner) counts.set(`${t.winner.region} ${t.winner.action.skill ?? "?"}`, (counts.get(`${t.winner.region} ${t.winner.action.skill ?? "?"}`) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([who, times]) => `${who} ×${times}`).join(", ") || "nobody";
}
const breadIn = (ticks: Tick[]) => Math.max(0, ...ticks.map((t) => t.state.data.self.inventory.bread ?? 0));

/** 10. Stocked up, then short: is the chest wanted only when the need presses? */
scenes.sated = async () => {
  await freshPlaza();
  chest(FAR_CHEST, 64);
  let stocked = 0;
  let short = 0;
  const { ticks } = await play(WANTS_MUCH_BREAD, async ({ say }) => {
    await learnChest(say, 2);
    // Enough bread to feel stocked (8), though the goal would have it carry more: the skill can run, the need is met.
    rcon(`give ${BOT} bread 8`);
    await sleep(1000);
    stocked = Date.now();
    await sleep(10_000);
    short = Date.now();
    await shortAgain();
    await sleep(10_000);
  });
  const [full, empty] = [between(ticks, stocked, short), after(ticks, short + 800)];
  return {
    scene: "sated",
    saw: `carrying 8 bread with the full chest in view: the pull won ${cueWins(full).length} of ${full.length} ticks (strongest: ${strongestPull(full)}), bread ended at ${full.at(-1)?.state.data.self.inventory.bread ?? 0} | short again: the pull won ${cueWins(empty).length} of ${empty.length} ticks (strongest: ${strongestPull(empty)}), bread got ${breadIn(empty.slice(4))}`,
    problem: [cueWins(full).length > 0 ? "it went for the chest with its need already met" : "", cueWins(empty).length === 0 ? "short of bread again, the pull never moved it" : ""].filter(Boolean).join("; "),
  };
};

/** 12. A known chest too far off to sense: is it still wanted when short, and only then? */
scenes.out_of_range = async () => {
  await freshPlaza();
  chest(FAR_CHEST, 64);
  const AWAY = "44.5 151 40.5 -90 0"; // 30 blocks from the chest; blocks are sensed within 16
  let stocked = 0;
  let short = 0;
  const { ticks } = await play(WANTS_MUCH_BREAD, async ({ say }) => {
    await learnChest(say, 2);
    rcon(`give ${BOT} bread 8`);
    rcon(`tp ${BOT} ${AWAY}`);
    await sleep(1000);
    stocked = Date.now();
    await sleep(8000);
    short = Date.now();
    await shortAgain(AWAY);
    await sleep(14_000);
  });
  const [full, empty] = [between(ticks, stocked, short), after(ticks, short + 800)];
  const sensed = (part: Tick[]) => part.filter((t) => (t.state.data.nearby?.blocks ?? []).some((b) => b.type === "chest")).length;
  const fromMemory = cueWins(empty).filter((t) => (dopamineOf(t).cues ?? []).some((c) => c.thing.extraWork !== undefined));
  return {
    scene: "out of range",
    saw: `30 blocks from the known chest, carrying 8 bread: chest sensed on ${sensed(full)} of ${full.length} ticks, the pull won ${cueWins(full).length} | short there: chest sensed on ${sensed(empty.slice(0, 3))} of the first 3 ticks, the pull won ${cueWins(empty).length} of ${empty.length} ticks, ${fromMemory.length} of them from memory (strongest: ${strongestPull(empty)}), bread got ${breadIn(empty.slice(4))}`,
    problem: [cueWins(full).length > 0 ? "it set off for a remembered chest with its need already met" : "", fromMemory.length === 0 ? "short of bread, it never wanted the chest it knows but cannot sense" : "", breadIn(empty.slice(4)) === 0 ? "it wanted the remembered chest but got no bread" : ""].filter(Boolean).join("; "),
  };
};

/** 13. Out of bread with a threat beside it: staying alive comes first; a threat that cannot get to it is no threat. */
scenes.threat_first = async () => {
  await freshPlaza();
  chest(FAR_CHEST, 64);
  let caged = 0;
  let free = 0;
  const { ticks } = await play(WANTS_MUCH_BREAD, async ({ say }) => {
    await learnChest(say, 2);
    await sleep(8000); // short again, it fetches its bread by itself first
    // A husk that does not move, in a glass box 3 blocks off: it cannot get to the bot.
    rcon("fill 62 151 39 64 153 41 glass hollow");
    rcon("summon husk 63.5 151 40.5 {IsBaby:0b,NoAI:1b}");
    await shortAgain();
    caged = Date.now();
    await sleep(40_000); // an alarm drops the goal that wants bread: the planner has to set it again first
    // The same husk with nothing between it and the bot.
    rcon("kill @e[type=husk]");
    rcon("fill 62 151 39 64 153 41 air");
    rcon("summon husk 63.5 151 40.5 {IsBaby:0b,NoAI:1b}");
    await shortAgain();
    free = Date.now();
    await sleep(10_000);
    rcon("kill @e[type=husk]");
  });
  const mobs = (t: Tick) => t.state.data.nearby?.mobs ?? [];
  const shut = between(ticks, caged + 1500, free);
  const husksBy = shut.filter((t) => mobs(t).some((m) => m.hostile)).length;
  // Danger presses while a hostile mob that can get to the bot is inside 8 blocks.
  const threatened = after(ticks, free).filter((t) => mobs(t).some((m) => m.hostile && m.reachable && m.dist < 8));
  return {
    scene: "threat first",
    saw: `out of bread, a husk in a glass box 3 blocks off (there on ${husksBy} of ${shut.length} ticks): the pull won ${cueWins(shut).length}, first ${n(((cueWins(shut)[0]?.timestamp ?? NaN) - caged) / 1000, 0)} s after (strongest: ${strongestPull(shut)}); danger rewards ${byRule(rewardsIn(shut).filter((r) => r.rule === "danger"))}; winners ${winners(shut)}; bread got ${breadIn(shut.slice(4))} | the husk with nothing between, inside 8 blocks: the pull won ${cueWins(threatened).length} of ${threatened.length} ticks (strongest: ${strongestPull(threatened)}); winners ${winners(threatened)}`,
    problem: [breadIn(shut.slice(4)) === 0 ? "a husk that could not get to it kept it from its bread" : "", cueWins(threatened).length > 0 ? "it set off for the chest with a threat beside it" : ""].filter(Boolean).join("; "),
  };
};

/** 14. The whole brain, out of bread, with a threat that can get to it (standing still, or attacking): does anything send it for the chest before the threat is dealt with? */
const threatWithJev = (attacks: boolean) => async (): Promise<Row> => {
  await freshPlaza();
  // Walled all round, three high: the plaza stands 150 blocks up, and a fall off its edge would decide the scene.
  for (const wall of ["39 151 35 81 153 35", "39 151 45 81 153 45", "39 151 35 39 153 45", "81 151 35 81 153 45"]) rcon(`fill ${wall} glass`);
  chest(FAR_CHEST, 64);
  let free = 0;
  let gone = 0;
  const { ticks } = await play(
    WANTS_MUCH_BREAD,
    async ({ say }) => {
      await learnChest(say, 2);
      await sleep(8000); // short again, it fetches its bread first
      // A husk that does not move, 3 blocks off between the bot and the chest, with nothing in the way.
      rcon(`summon husk 63.5 151 40.5 {IsBaby:0b${attacks ? "" : ",NoAI:1b"}}`); // always an adult: a baby is fast enough to count as looming
      await shortAgain();
      free = Date.now();
      await sleep(15_000);
      rcon("kill @e[type=husk]");
      await shortAgain();
      gone = Date.now();
      await sleep(45_000); // an alarm drops the goal that wants bread: the planner has to set it again first
    },
    "whole",
  );
  const mobs = (t: Tick) => t.state.data.nearby?.mobs ?? [];
  // While danger presses by the bot's own rule: a threat that can get to it, inside 8 blocks, or inside 16 if it has noticed the bot.
  const sized = (t: Tick) => (t.state.data as { defence?: { threats: { dist: number; canReach: boolean; noticed: boolean }[] } }).defence?.threats ?? [];
  const threatened = between(ticks, free, gone).filter((t) => sized(t).some((x) => x.canReach && x.dist < (x.noticed ? 16 : 8)));
  // An unaware one further off does not press: the bot may go round it. How near it then came, while wanting the chest.
  const nearest = Math.min(Infinity, ...between(ticks, free, gone).filter((t) => (dopamineOf(t).cues ?? []).length > 0).flatMap((t) => mobs(t).filter((m) => m.hostile).map((m) => m.dist)));
  const wanted = threatened.filter((t) => (dopamineOf(t).cues ?? []).length > 0);
  const toChest = threatened.filter((t) => t.winner?.action.skill === "take_items");
  const scaled = threatened.filter((t) => /scaled/.test(t.winner?.reason ?? ""));
  const clear = after(ticks, gone + 1500);
  const firstTrip = clear.find((t) => t.winner?.action.skill === "take_items");
  return {
    scene: attacks ? "threat with Jev, attacking" : "threat with Jev",
    saw: `whole brain, out of bread, a husk ${attacks ? "that attacks" : "that stands still"} with nothing between, pressing on ${threatened.length} ticks: the chest was wanted on ${wanted.length} of them (and at other times with the husk no nearer than ${Number.isFinite(nearest) ? nearest : "?"} blocks), take_items won ${toChest.length} (by ${[...new Set(toChest.map((t) => t.winner!.region))].join(", ") || "nobody"}), an option was loosened on ${scaled.length}; winners ${winners(threatened)}; deaths ${Math.max(0, ...ticks.map((t) => t.state.data.self.deaths)) - ticks[0]!.state.data.self.deaths} | husk gone: take_items first won ${n(((firstTrip?.timestamp ?? NaN) - gone) / 1000, 0)} s after (by ${firstTrip?.winner?.region ?? "nobody"}); the pull won ${cueWins(clear).length} of ${clear.length} ticks; bread got ${breadIn(clear.slice(4))}`,
    problem: [wanted.length > 0 ? "it wanted the chest with a threat beside it" : "", toChest.length > 0 ? "it set off for the chest with a threat beside it" : "", breadIn(clear.slice(4)) === 0 ? "the threat gone and still out of bread, it never got its bread" : ""].filter(Boolean).join("; "),
  };
};
scenes.threat_with_jev = threatWithJev(false);
scenes.threat_with_jev_live = threatWithJev(true);

/** 15. Out of bread with the known chest out of reach (walled off across the plaza): a want that cannot be carried out must not be hammered at, nor unlearned in seconds. */
scenes.no_path = async () => {
  await freshPlaza();
  chest(FAR_CHEST, 64);
  let shut = 0;
  let freed = 0;
  const { ticks } = await play(WANTS_MUCH_BREAD, async ({ say }) => {
    await learnChest(say, 2);
    await sleep(8000); // short again, it fetches its bread by itself first
    rcon(`tp ${BOT} ${HOME}`);
    await sleep(500);
    rcon("fill 66 151 36 66 154 44 glass"); // a wall right across, between the bot and the chest
    rcon(`clear ${BOT} bread`);
    shut = Date.now();
    await sleep(15_000);
    rcon("fill 66 151 36 66 154 44 air");
    freed = Date.now();
    await sleep(40_000); // the last wait before trying again may be up to 16 s by then
  });
  const [inside, out] = [between(ticks, shut, freed), after(ticks, freed)];
  const ends = (part: Tick[]) => part.flatMap((t) => t.skillEvents ?? []).filter((e) => e.skill === "take_items" && e.type !== "started");
  const failed = ends(inside).filter((e) => e.type === "failed");
  // A want is weaker while the trip that answers it is under way (the hypothalamus eases the need); that is not unlearning, so those ticks are left out.
  const eased = (t: Tick) => JSON.stringify(t.regions.find((r) => r.region === "hypothalamus")?.trace ?? "").includes("eased: ");
  const wants = inside.filter((t) => !eased(t)).flatMap((t) => (dopamineOf(t).cues ?? []).map((c) => c.want));
  const firstOut = out.find((t) => (dopamineOf(t).cues ?? []).length > 0);
  return {
    scene: "no path",
    saw: `the chest walled off for 15 s, out of bread: take_items failed ${failed.length} time(s) (${[...new Set(failed.map((e) => e.reason ?? "?"))].join("; ") || "never"}); the want went ${wants.length ? `${n(wants[0]!)} → ${n(wants.at(-1)!)}` : "unseen"} | let out: wanted again ${n(((firstOut?.timestamp ?? NaN) - freed) / 1000, 0)} s after at ${n(dopamineOf(firstOut ?? out[0]!).cues?.[0]?.want ?? NaN)}; bread got ${breadIn(out.slice(4))}`,
    problem: [failed.length > 6 ? `it tried ${failed.length} times in 15 s what it could not do` : "", wants.length > 1 && wants.at(-1)! < 0.5 * wants[0]! ? "a few seconds with no way there unlearned over half of what the chest was known to give" : "", breadIn(out.slice(4)) === 0 ? "let out, it never got its bread" : ""].filter(Boolean).join("; "),
  };
};

/** 11. The whole brain, Jev included: can a want win against Jev's own pick? */
scenes.with_jev = async () => {
  await freshPlaza();
  chest(FAR_CHEST, 64);
  let short = 0;
  let stocked = 0;
  const { ticks } = await play(
    WANTS_MUCH_BREAD,
    async ({ say }) => {
      await learnChest(say, 2);
      short = Date.now();
      await sleep(20_000); // short of bread, the full chest in view, Jev picking as it likes
      rcon(`clear ${BOT} bread`);
      rcon(`give ${BOT} bread 8`);
      rcon(`tp ${BOT} ${HOME}`);
      await sleep(1000);
      stocked = Date.now();
      await sleep(15_000); // stocked: it should not go again
    },
    "whole",
  );
  const [hungry, full] = [between(ticks, short + 800, stocked - 1500), after(ticks, stocked)];
  // A want is acted on when the winner does what the cue asked, whoever proposed it (once under way, Jev picks the running skill itself).
  const pulled = (part: Tick[]) => part.filter((t) => (dopamineOf(t).cues ?? []).length > 0);
  const actedOn = (part: Tick[]) => pulled(part).filter((t) => (dopamineOf(t).cues ?? []).some((c) => c.skill === t.winner?.action.skill && c.thing.id === t.winner?.action.target));
  const top = Math.max(0, ...cueWins(hungry).map((t) => t.winner!.urgency));
  // The ticks on which it could have wanted the chest: short of food, the chest in its view, not already on its way.
  const could = hungry.filter((t) => (t.state.data.self.foodItems ?? 0) < 8 && (t.state.data.nearby?.blocks ?? []).some((b) => b.type === "chest") && t.state.data.current?.skill !== "take_items");
  return {
    scene: "with jev",
    // With `could` at 0 the run says nothing either way: the chest was out of view, or Jev was already fetching bread.
    saw: `short of bread, Jev running: short with the chest in view and not yet on its way for ${could.length} of ${hungry.length} ticks; the chest was wanted on ${pulled(hungry).length} and the bot did what was wanted on ${actedOn(hungry).length} of them; the pull itself won ${cueWins(hungry).length} (top urgency ${n(top)}; strongest: ${strongestPull(hungry)}); winners ${winners(hungry)}; bread got ${breadIn(hungry.slice(4))} | stocked with 8: wanted on ${pulled(full).length} of ${full.length} ticks; winners ${winners(full)}`,
    problem: [could.length > 2 && pulled(hungry).length > 0 && actedOn(hungry).length === 0 ? "with Jev running the bot never did what it wanted, though it was out of bread with a known full chest in view" : "", could.length > 2 && pulled(hungry).length === 0 ? "out of bread with the chest in view, it never wanted it" : "", cueWins(full).length > 0 ? "it went for the chest with its need already met" : ""].filter(Boolean).join("; "),
  };
};

const wanted = process.argv.slice(2);
const rows: Row[] = [];
try {
  for (const [name, run] of Object.entries(scenes)) {
    if (wanted.length && !wanted.includes(name)) continue;
    console.log(`=== ${name}`);
    const row = await run().catch((error: unknown): Row => ({ scene: name, saw: `ERROR: ${error instanceof Error ? error.message : error}`, problem: "the scene did not run" }));
    rows.push(row);
    for (const part of row.saw.split(" | ")) console.log(`    ${part}`);
    console.log(`    ${row.problem ? `PROBLEM: ${row.problem}` : "no problem seen"}`);
  }
} finally {
  for (const command of ["kill @e[type=!player,x=60,y=151,z=40,distance=..40]", "fill 40 151 35 80 160 45 air", "fill 40 149 36 80 150 44 stone", "fill 39 151 35 81 152 35 glass", "fill 39 151 45 81 152 45 glass", "gamerule spawn_mobs true", "time set 1000", "forceload remove 39 35 81 45", `tp ${BOT} ${BASE_SPOT}`]) rcon(command);
}

const found = rows.filter((r) => r.problem);
console.log(`\n${rows.length} scenes; ${found.length} showed a problem${found.length ? `: ${found.map((r) => r.scene).join(", ")}` : ""}.`);
