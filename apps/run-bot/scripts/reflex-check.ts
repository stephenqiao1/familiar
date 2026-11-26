// Live check of the stretch and withdrawal reflexes on the test server. The real bot runs with
// only its reflexes deciding (no Jev, no planner calls), and the scenes hurt it, bury it, put
// lava in its way and shove it. Each scene is judged from the bot's own tick log.
// Needs the server container (MC_CONTAINER, default familiar-m6).
//   pnpm reflex-check [scene ...]
import { spawn } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { connect } from "@familiar/minecraft";
import { buildPlaza, rcon, sleep } from "./primitive-check/world.ts";

/** A bot born knowing only that lava and fire hurt (bots.json), so it has to learn the rest. */
const BOT = "Naive";
const REGIONS = "reflex,brainstem,acetylcholine,dopamine,noradrenaline,hippocampus,amygdala,serotonin,prefrontal";
const START = `tp ${BOT} 60.5 151 40.5 180 0`;

interface Tick {
  timestamp: number;
  state: { data: { self: { position: { x: number; y: number; z: number }; health: number; deaths: number; inLava: boolean; inBlock: boolean; pushed: { danger: unknown } | null } } };
  winner: { region: string; action: { skill?: string }; reason: string } | null;
  regions: { region: string; trace?: { rules?: { rule: string; kind: string; urgency: number; gain: number }[] } }[];
  signals: Record<string, { value: number }>;
  skillEvents?: { skill: string; type: string; reason?: string; changes?: Record<string, unknown> }[];
}

/** Runs the real bot with only its reflexes deciding; `act` scripts the scene while it runs. */
async function play(act: (bot: { say(command: string): void }) => Promise<void>, options: { keep?: boolean; plan?: object } = {}): Promise<Tick[]> {
  if (!options.keep) rmSync(`data/${BOT}`, { recursive: true, force: true });
  const plan = options.plan ? ["--plan", JSON.stringify(options.plan)] : [];
  const child = spawn("node", ["apps/run-bot/dist/index.js", "--engine", "echo", "--planner", "echo", ...plan, "--regions", REGIONS, "--manual", "--name", BOT], { stdio: ["pipe", "pipe", "pipe"] });
  let output = "";
  let exited = false;
  child.stdout.on("data", (d: Buffer) => (output += d));
  child.stderr.on("data", (d: Buffer) => (output += d));
  child.once("exit", () => (exited = true));
  const joined = Date.now();
  while (!output.includes("Logging to") && !exited && Date.now() - joined < 30_000) await sleep(200);
  if (exited) throw new Error(`The bot stopped before it started playing:\n${output.slice(-500)}`);
  for (const command of [`gamemode survival ${BOT}`, `clear ${BOT}`, `effect clear ${BOT}`, `effect give ${BOT} instant_health 1 10 true`, `effect give ${BOT} saturation 1 10 true`, START]) rcon(command);
  await sleep(1500);
  try {
    await act({ say: (command) => void child.stdin.write(`${command}\n`) });
  } finally {
    child.stdin.end();
    child.kill("SIGINT");
    // If it does not stop by itself, make it: a scene must never hang.
    const hard = setTimeout(() => child.kill("SIGKILL"), 8000);
    if (!exited) await new Promise((resolve) => child.once("exit", resolve));
    clearTimeout(hard);
  }
  const file = output.match(/Logging to (\S+)/)?.[1];
  if (!file) throw new Error("no log file");
  console.log(`    log: ${file}`);
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as Tick);
}

async function freshPlaza(): Promise<void> {
  buildPlaza();
  for (const command of ["kill @e[type=!player,x=60,y=151,z=40,distance=..40]", "fill 40 151 36 80 158 44 air", "fill 40 140 35 80 148 45 air", "fill 40 149 36 80 150 44 stone"]) rcon(command);
  await sleep(500);
}

const eventsOf = (ticks: Tick[], skill: string, type?: string) => ticks.flatMap((t) => (t.skillEvents ?? []).filter((e) => e.skill === skill && (!type || e.type === type)));
const withdrawals = (ticks: Tick[]) => eventsOf(ticks, "withdraw").filter((e) => e.type !== "started" && e.changes?.cause !== undefined);
const delays = (ticks: Tick[]) => withdrawals(ticks).map((e) => Number(e.changes!.hurtToStartMs));
const learned = (ticks: Tick[]) => [...new Set(withdrawals(ticks).flatMap((e) => (e.changes?.learned ? [String(e.changes.learned)] : [])))];
const selfOf = (t: Tick) => t.state.data.self;
const fired = (ticks: Tick[], rule: string) => ticks.filter((t) => t.regions.some((r) => r.region === "reflex" && r.trace?.rules?.some((f) => f.rule === rule))).length;
const hurtsSince = (ticks: Tick[], at: number) => ticks.filter((t, i) => i > 0 && t.timestamp >= at && selfOf(t).health < selfOf(ticks[i - 1]!).health).length;

interface Row {
  scene: string;
  outcome: string;
  delays: number[];
  learned: string[];
  ok: boolean;
}

/**
 * Touch something twice (each time it should pull away), then walk past it: by then it should
 * know the thing hurts and keep clear. `touch` makes the bot touch it; `course` builds what it
 * must walk past and gives where to walk to.
 */
async function learnAndAvoid(scene: string, block: string, setup: string[], touch: (say: (c: string) => void) => Promise<void>, course: { build: string[]; from: string; to: string; arriveX: number }): Promise<Row> {
  await freshPlaza();
  let walkFrom = 0;
  const ticks = await play(async ({ say }) => {
    for (const command of setup) rcon(command);
    await sleep(500);
    for (let i = 0; i < 2; i++) {
      await touch(say);
      await sleep(4500);
    }
    for (const command of course.build) rcon(command);
    rcon(`effect give ${BOT} instant_health 1 10 true`);
    rcon(`tp ${BOT} ${course.from}`);
    await sleep(1200);
    walkFrom = Date.now();
    say(`do go_to ${course.to}`);
    await sleep(9000);
  });
  const pulled = withdrawals(ticks);
  const far = pulled.filter((e) => e.changes?.to !== undefined).length;
  const hurtWalking = hurtsSince(ticks, walkFrom);
  const arrived = Math.abs(selfOf(ticks.at(-1)!).position.x - course.arriveX) <= 2;
  const ok = pulled.length >= 2 && learned(ticks).includes(block) && arrived && hurtWalking === 0;
  return { scene, outcome: `pulled away ${pulled.length} times (${far} to a safe spot); then walked past: ${arrived ? "arrived" : "did not arrive"}, hurt ${hurtWalking} times on the way`, delays: delays(ticks), learned: learned(ticks), ok };
}

const scenes: Record<string, () => Promise<Row>> = {
  /** 1. A cactus: touch it twice, then walk past it. */
  cactus: () =>
    learnAndAvoid(
      "cactus",
      "cactus",
      ["setblock 61 150 40 sand", "setblock 61 151 40 cactus"],
      async () => void rcon(`tp ${BOT} 60.72 151 40.5`),
      { build: [], from: "57.5 151 40.5 -90 0", to: "pos:66,151,40", arriveX: 66 },
    ),
  /** 2a. A magma floor: stand on it twice, then cross a strip of it that has one gap. */
  magma: () =>
    learnAndAvoid(
      "magma floor",
      "magma_block",
      [],
      async () => {
        rcon(START);
        await sleep(300);
        rcon("setblock 60 150 40 magma_block");
        await sleep(3000);
        rcon("setblock 60 150 40 stone");
      },
      { build: ["fill 63 150 36 63 150 43 magma_block"], from: "58.5 151 40.5 -90 0", to: "pos:68,151,40", arriveX: 68 },
    ),
  /** 2b. A berry bush: move inside it twice, then walk past a hedge of it that has one gap. */
  berry: () =>
    learnAndAvoid(
      "berry bush",
      "sweet_berry_bush",
      ["setblock 60 150 39 grass_block", "setblock 60 151 39 sweet_berry_bush[age=3]"],
      async (say) => {
        rcon(START);
        await sleep(600);
        say("do step dir:forward");
      },
      { build: ["fill 63 150 36 63 150 43 grass_block", "fill 63 151 36 63 151 43 sweet_berry_bush[age=3]"], from: "58.5 151 40.5 -90 0", to: "pos:68,151,40", arriveX: 68 },
    ),
  /** 3. Buried: sand falls on its head. */
  async buried() {
    await freshPlaza();
    const ticks = await play(async () => {
      for (const command of ["setblock 60 154 40 sand", "setblock 60 155 40 sand"]) rcon(command);
      await sleep(9000);
    });
    const wasBuried = ticks.some((t) => selfOf(t).inBlock);
    const out = eventsOf(ticks, "dig_out", "done");
    const end = selfOf(ticks.at(-1)!);
    return { scene: "buried in sand", outcome: `${wasBuried ? "head was inside a block" : "never buried"}; dig_out finished ${out.length} time(s)${out[0]?.changes?.how ? ` (${String(out[0].changes.how)})` : ""}; ends ${end.inBlock ? "STILL BURIED" : "free"}, health ${end.health}/20`, delays: [], learned: [], ok: wasBuried && out.length > 0 && !end.inBlock && end.deaths === 0 };
  },
  /** 4. A lava edge: stepped toward lava one step at a time. */
  async lava_edge() {
    await freshPlaza();
    const ticks = await play(async ({ say }) => {
      rcon("fill 58 150 36 62 150 37 lava");
      await sleep(800);
      for (let i = 0; i < 5; i++) {
        say("do step dir:forward");
        await sleep(1300);
      }
    });
    const inLava = ticks.filter((t) => selfOf(t).inLava).length;
    const nearest = Math.min(...ticks.map((t) => selfOf(t).position.z));
    const refused = eventsOf(ticks, "step", "failed").length;
    const recoils = eventsOf(ticks, "recoil", "started").length;
    return { scene: "lava edge, one step at a time", outcome: `got to z=${nearest} (lava starts at z=37); in lava ${inLava} ticks; about_to_touch fired ${fired(ticks, "about_to_touch")} ticks (${recoils} recoils); the step itself was refused ${refused} time(s)`, delays: [], learned: [], ok: inLava === 0 && nearest >= 38 && (recoils > 0 || refused > 0) };
  },
  /** 5a. Shoved toward a cliff edge. */
  shoved: () => shove("shoved toward a cliff", undefined),
  /** 5b. The same, with a goal that holds hold_ground back. */
  shoved_held: () => shove("shoved, with hold_ground held back", { goal: "Drop down off the ledge to the floor below.", holdBack: ["hold_ground", "edge_guard"] }),
};

/**
 * Another player hits the bot from behind, three times, with a drop 8 blocks ahead. A hit throws
 * it about 6 blocks through the air (where no reflex can act), so it lands a block or two short
 * of the edge, still sliding: that is where holding ground matters.
 * (Pistons were tried first: they do not move this client at all.)
 */
async function shove(scene: string, plan: object | undefined): Promise<Row> {
  await freshPlaza();
  // A ledge: the floor ends at z=36; six blocks below is another floor.
  for (const command of ["fill 54 144 22 66 144 35 stone", "fill 54 145 22 66 150 35 air", "fill 54 151 22 66 156 35 air"]) rcon(command);
  const leader = await connect({ host: "localhost", port: 25565, username: "Leader" });
  let ticks: Tick[] = [];
  const place = () => {
    rcon(`tp ${BOT} 60.5 151 43.5 180 0`);
    rcon("tp Leader 60.5 151 44.4 180 0");
  };
  try {
    ticks = await play(
      async () => {
        rcon("gamemode survival Leader");
        place();
        await leader.waitForChunksToLoad();
        await sleep(plan ? 16_500 : 2000); // the fixed plan arrives with the planner's first run
        for (let i = 0; i < 3; i++) {
          const target = leader.players[BOT]?.entity;
          if (target) leader.attack(target);
          await sleep(3500);
          rcon(`effect give ${BOT} instant_health 1 10 true`);
          place();
          await sleep(1500);
        }
      },
      plan ? { plan } : {},
    );
  } finally {
    leader.quit();
  }
  const pushedTicks = ticks.filter((t) => selfOf(t).pushed).length;
  const towardDrop = ticks.filter((t) => selfOf(t).pushed?.danger).length;
  const steadies = eventsOf(ticks, "steady", "done");
  const back = steadies.filter((e) => e.changes?.steppedBack === true).length;
  const wentOver = ticks.filter((t, i) => i > 0 && selfOf(t).position.y < 150 && selfOf(ticks[i - 1]!).position.y >= 150).length;
  const nearest = Math.min(...ticks.map((t) => selfOf(t).position.z));
  const urgencies = ticks.flatMap((t) => t.regions.flatMap((r) => (r.region === "reflex" ? (r.trace?.rules ?? []).filter((f) => f.rule === "hold_ground").map((f) => `${f.urgency.toFixed(2)} (gain ${f.gain.toFixed(2)})`) : [])));
  const outcome = `hit 3 times; thrown as far as z=${nearest} (the floor ends at z=36); pushed toward the drop in ${towardDrop} of ${pushedTicks} pushed ticks; hold_ground fired ${fired(ticks, "hold_ground")} ticks at urgency ${[...new Set(urgencies)].slice(0, 3).join(", ") || "n/a"}; held ${steadies.length} time(s), stepping back ${back}; went over the edge ${wentOver} time(s)`;
  // With the reflex free it must hold. With it held back there is no right answer: the result is reported.
  return { scene, outcome, delays: [], learned: [], ok: plan ? towardDrop > 0 : towardDrop > 0 && steadies.length > 0 && wentOver === 0 };
}

const wanted = process.argv.slice(2);
const rows: Row[] = [];
try {
  for (const [name, run] of Object.entries(scenes)) {
    if (wanted.length && !wanted.includes(name)) continue;
    console.log(`=== ${name}`);
    const row = await run().catch((error: unknown): Row => ({ scene: name, outcome: `ERROR: ${error instanceof Error ? error.message : error}`, delays: [], learned: [], ok: false }));
    rows.push(row);
    console.log(`    ${row.ok ? "ok" : "NOT ok"}: ${row.outcome}`);
  }
} finally {
  for (const command of ["kill @e[type=!player,x=60,y=151,z=40,distance=..40]", "fill 40 140 28 80 160 45 air", "fill 40 149 36 80 150 44 stone", "fill 39 151 35 81 152 35 glass", "fill 39 151 45 81 152 45 glass", "gamerule spawn_mobs true", "forceload remove 39 35 81 45", `tp ${BOT} -8 69 14`]) rcon(command);
}

const middle = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const table = [["scene", "outcome", "hurt-to-start (ms)", "learned", "ok"], ...rows.map((r) => [r.scene, r.outcome.split(";")[0]!, r.delays.length ? r.delays.join(", ") : "", r.learned.join(", "), r.ok ? "yes" : "NO"])];
const widths = table[0]!.map((_, c) => Math.max(...table.map((r) => r[c]!.length)));
console.log("");
for (const [i, r] of table.entries()) {
  console.log(r.map((cell, c) => cell.padEnd(widths[c]!)).join(" | "));
  if (i === 0) console.log(widths.map((w) => "-".repeat(w)).join("-|-"));
}
const all = rows.flatMap((r) => r.delays);
console.log(all.length ? `\nHurt to withdrawal starting, across all scenes: median ${middle(all)} ms, slowest ${Math.max(...all)} ms, ${all.filter((d) => d > 250).length} of ${all.length} over 250 ms.` : "\nNo withdrawals were timed.");
const failed = rows.filter((r) => !r.ok);
console.log(failed.length ? `FAIL: ${failed.map((r) => r.scene).join(", ")}` : `PASS: all ${rows.length} scenes.`);
process.exit(failed.length ? 1 : 0);
