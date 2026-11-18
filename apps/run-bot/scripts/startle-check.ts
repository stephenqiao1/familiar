// Live check of the startle circuit on the test server: how big each startle is, what changed
// its size, and how fast the body answers. No Jev and no planner calls (the scenes say what to
// do), except the ambush scene, which needs the whole brain.
// Needs the server container (MC_CONTAINER, default familiar-m6).
//   pnpm startle-check [scene ...]
import { spawn } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { buildPlaza, rcon, sleep } from "./primitive-check/world.ts";

const BOT = "Jumper";
const REGIONS = "reflex,medulla,brainstem,colliculus,acetylcholine,dopamine,noradrenaline,hippocampus,serotonin,prefrontal";
/** Facing north; behind it is south. */
const START = "60.5 151 40.5 180 0";
/** Bangs go off in the open air south of the plaza, 10 blocks behind the bot, where they break nothing. */
const BANG_BEHIND = "summon tnt 60.5 153 50.5 {fuse:0}";

interface Startled {
  by: string;
  kind: string;
  intensity: number;
  potentiation: number;
  warning: number;
  habituated: number;
  selfCaused: boolean;
  magnitude: number;
  size?: "flinch" | "full";
  why?: string;
  released?: string;
  eventAt: number;
  eventToDecideMs: number;
}
interface Tick {
  tick: number;
  timestamp: number;
  state: { data: { self: { position: { x: number; z: number }; health: number; deaths: number; food: number } } };
  winner: { region: string; action: { skill?: string } } | null;
  regions: { region: string; trace?: { startle?: Startled; startleQuiet?: Startled; raisedBy?: Record<string, number>; loadedResponse?: { skill: string; releasedByStartle?: boolean } } }[];
  signals: Record<string, { value: number }>;
  skillEvents?: { skill: string; type: string; timestamp: number; reason?: string; changes?: Record<string, unknown> }[];
}

interface Options {
  start?: string;
  plan?: object;
  whole?: boolean;
  flags?: string[];
}

/** Runs the real bot; `act` scripts the scene while it runs. */
async function play(act: (say: (command: string) => void) => Promise<void>, options: Options = {}): Promise<Tick[]> {
  rmSync(`data/${BOT}`, { recursive: true, force: true });
  const plan = options.plan ? ["--plan", JSON.stringify(options.plan)] : [];
  const brain = options.whole ? ["--engine", "jev", "--planner", "claude"] : ["--engine", "echo", "--planner", "echo", "--regions", REGIONS];
  const child = spawn("node", ["--env-file-if-exists=.env", "apps/run-bot/dist/index.js", ...brain, ...plan, ...(options.flags ?? []), "--manual", "--name", BOT], { stdio: ["pipe", "pipe", "pipe"] });
  let output = "";
  let exited = false;
  child.stdout.on("data", (d: Buffer) => (output += d));
  child.stderr.on("data", (d: Buffer) => (output += d));
  child.once("exit", () => (exited = true));
  const joined = Date.now();
  while (!output.includes("Logging to") && !exited && Date.now() - joined < 30_000) await sleep(200);
  if (exited) throw new Error(`The bot stopped before it started playing:\n${output.slice(-500)}`);
  for (const command of [`gamemode survival ${BOT}`, `clear ${BOT}`, `effect clear ${BOT}`, `effect give ${BOT} instant_health 1 10 true`, `effect give ${BOT} saturation 1 10 true`, `tp ${BOT} ${options.start ?? START}`]) rcon(command);
  await sleep(2500);
  try {
    await act((command) => void child.stdin.write(`${command}\n`));
  } finally {
    child.stdin.end();
    child.kill("SIGINT");
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
  for (const command of ["kill @e[type=!player,x=60,y=151,z=40,distance=..60]", "fill 40 151 36 80 160 44 air", "fill 40 149 36 80 150 44 stone", "fill 39 151 35 81 152 35 glass", "fill 39 151 45 81 152 45 glass", "time set noon", "weather clear"]) rcon(command);
  await sleep(500);
}

const traceOf = (t: Tick, region: string) => t.regions.find((r) => r.region === region)?.trace ?? {};
/** Every sudden event the brainstem judged, startle or not, in order. */
const judged = (ticks: Tick[], since = 0) => ticks.filter((t) => t.timestamp >= since).flatMap((t) => { const b = traceOf(t, "brainstem"); const s = b.startle ?? b.startleQuiet; return s ? [{ t, s, startled: b.startle !== undefined }] : []; });
const explosions = (ticks: Tick[], since = 0) => judged(ticks, since).filter((j) => j.s.kind === "explosion");
/** From the raw event to the brace, flinch or released skill starting. */
function startMs(ticks: Tick[], j: { t: Tick; s: Startled }): number | null {
  const wanted = j.s.released ?? (j.s.size === "full" ? "brace" : "flinch");
  const started = ticks.filter((t) => t.timestamp >= j.t.timestamp - 50 && t.timestamp <= j.t.timestamp + 1500).flatMap((t) => (t.skillEvents ?? []).filter((e) => e.skill === wanted && e.type === "started"))[0];
  return started ? Math.max(0, started.timestamp - j.s.eventAt) : null;
}
const sizeOf = (s: Startled | undefined) => (s ? (s.size ?? `none (${s.why})`) : "no event");
const factors = (s: Startled | undefined) => (s ? [s.potentiation > 1.01 ? `potentiation ×${s.potentiation}` : "", s.warning > 0 ? `warning ${s.warning}` : "", s.habituated > 0 ? `habituated ${s.habituated}` : "", s.selfCaused ? "self-caused" : ""].filter(Boolean).join(", ") || "nothing" : "");

interface Row {
  scene: string;
  outcome: string;
  magnitude: string;
  size: string;
  changedBy: string;
  startMs: number | null;
  ok: boolean;
}
const row = (scene: string, ok: boolean, outcome: string, s: Startled | undefined, ms: number | null = null, magnitude = s ? s.magnitude.toFixed(2) : ""): Row => ({ scene, outcome, magnitude, size: sizeOf(s), changedBy: factors(s), startMs: ms, ok });

/** The calm bang's magnitude, for scenes that compare against it. */
let calmBang: number | null = null;

const scenes: Record<string, () => Promise<Row>> = {
  /** 1. Bang behind, calm: a full startle toward it. */
  async bang() {
    await freshPlaza();
    const ticks = await play(async () => {
      await sleep(3000);
      rcon(BANG_BEHIND);
      await sleep(4000);
    });
    const [first] = explosions(ticks);
    const ms = first ? startMs(ticks, first) : null;
    calmBang = first?.s.magnitude ?? null;
    return row("bang behind, calm", first?.s.size === "full", `${first ? `magnitude ${first.s.magnitude} from intensity ${first.s.intensity}` : "NO EVENT"}; brace started ${ms ?? "?"} ms after the explosion (decided at ${first?.s.eventToDecideMs ?? "?"} ms)`, first?.s, ms);
  },

  /** 2. A bang in view that the bot was watching: a fuse it could see. Smaller, from the warning. */
  async watched() {
    await freshPlaza();
    const ticks = await play(async () => {
      await sleep(3000);
      // A lit explosive appears 8 blocks in front, on an obsidian ledge so it stays where it is seen; it goes off 1.5 s later.
      rcon("fill 58 150 30 62 150 35 obsidian");
      rcon("summon tnt 60.5 151 32.5 {fuse:30}");
      await sleep(5000);
    });
    const [first] = explosions(ticks);
    const ok = first !== undefined && first.s.warning > 0 && (calmBang === null || first.s.magnitude < calmBang);
    return row("bang it watched coming (a fuse in view)", ok, `${first ? `magnitude ${first.s.magnitude} (intensity ${first.s.intensity}, warning ${first.s.warning})` : "NO EVENT"}${calmBang !== null ? `, against ${calmBang} for the calm bang` : ""}`, first?.s, first ? startMs(ticks, first) : null);
  },

  /** 3. Five bangs a few seconds apart: each smaller than the last; then one after two minutes: back up. */
  async repeats() {
    await freshPlaza();
    const ticks = await play(async () => {
      await sleep(3000);
      for (let i = 0; i < 5; i++) {
        rcon(BANG_BEHIND);
        await sleep(4000);
      }
      await sleep(120_000);
      rcon(BANG_BEHIND);
      await sleep(3000);
    });
    const bangs = explosions(ticks).map((j) => j.s.magnitude);
    const five = bangs.slice(0, 5);
    // Each later one is smaller than the first, and by the fifth there is no startle left. (A bang the bot was still looking toward is smaller again, from the warning, so the run is not always even.)
    const falling = five.length === 5 && five.slice(1).every((m) => m < five[0]!) && five[1]! < five[0]! && five[4]! < 0.25;
    const back = bangs[5] !== undefined && bangs[5] > five[4]! && bangs[5] > 0.6;
    return row("five bangs, then one two minutes later", falling && back, `magnitudes ${five.join(", ")}; two minutes later ${bangs[5] ?? "no event"}`, explosions(ticks)[4]?.s, null, `${five.join(" → ")}; then ${bangs[5] ?? "?"}`);
  },

  /** 4. The same bang in the dark just after being hurt: larger than scene 1. */
  async edgy() {
    await freshPlaza();
    const ticks = await play(async () => {
      rcon("time set midnight");
      // A roof, so no light reaches it.
      rcon("fill 56 154 36 64 154 44 stone");
      await sleep(3000);
      rcon(`damage ${BOT} 6 minecraft:generic`);
      await sleep(1500);
      rcon(BANG_BEHIND);
      await sleep(4000);
    });
    rcon("time set noon");
    const [first] = explosions(ticks);
    const bigger = first !== undefined && first.s.potentiation > 1.1 && (calmBang === null || first.s.magnitude >= calmBang);
    return row("the same bang in the dark, just after being hurt", bigger, `${first ? `magnitude ${first.s.magnitude} (intensity ${first.s.intensity} × potentiation ${first.s.potentiation})` : "NO EVENT"}${calmBang !== null ? `, against ${calmBang} calm` : ""}`, first?.s, first ? startMs(ticks, first) : null);
  },

  /** 5. Its own explosive: no startle. */
  async own() {
    await freshPlaza();
    let litAt = 0;
    const ticks = await play(async (say) => {
      // An obsidian floor, so the blast leaves the bot something to stand on.
      rcon("fill 56 150 34 64 150 44 obsidian");
      rcon(`give ${BOT} tnt 1`);
      await sleep(1500);
      say("do place_block pos:60,151,37");
      await sleep(2000);
      rcon(`clear ${BOT}`);
      rcon(`give ${BOT} flint_and_steel 1`);
      await sleep(1500);
      litAt = Date.now();
      say("do use_on pos:60,151,37");
      // Then it walks clear, as anyone would: the fuse is 4 seconds. (Standing next to it, the blast itself hurts, and being hurt startles whoever lit it.)
      await sleep(700);
      say("do go_to pos:74,151,42");
      await sleep(8000);
    }, { flags: ["--same-time"] });
    const placed = ticks.flatMap((t) => t.skillEvents ?? []).some((e) => e.skill === "place_block" && e.type === "done");
    const lit = ticks.flatMap((t) => t.skillEvents ?? []).find((e) => e.skill === "use_on" && e.type !== "started");
    const [bang] = explosions(ticks, litAt);
    const others = judged(ticks, litAt).filter((j) => j.startled).map((j) => `${j.s.by} ${j.s.magnitude}`);
    const lowest = Math.min(...ticks.map((t) => t.state.data.self.health));
    const ok = placed && bang !== undefined && bang.s.selfCaused && !bang.startled && others.length === 0;
    return row("its own explosive", ok, `placed: ${placed}; lit: ${lit?.type ?? "not tried"}${lit?.reason ? ` (${lit.reason})` : ""}; the explosion: ${bang ? `intensity ${bang.s.intensity}, self-caused ${bang.s.selfCaused}, magnitude ${bang.s.magnitude}` : "NOT HEARD"}; other startles after lighting: ${others.join(", ") || "none"}; lowest health ${lowest}`, bang?.s);
  },

  /** 6. A mild sound mid-journey: a flinch, and it carries on walking. */
  async flinch() {
    await freshPlaza();
    let at = 0;
    const ticks = await play(
      async (say) => {
        say("do go_to pos:76,151,40");
        await sleep(2500);
        at = Date.now();
        // A far bang: 40 blocks off, loud enough to flinch at and no more.
        rcon(`execute at ${BOT} run summon tnt ~ 153 ~40 {fuse:0}`);
        await sleep(8000);
      },
      // With --same-time a look at the bang runs beside the walk; without it, in a scene with no Jev, the look would take the walk's place.
      { start: "44.5 151 40.5 -90 0", flags: ["--same-time"] },
    );
    const [first] = explosions(ticks, at);
    const journey = ticks.flatMap((t) => t.skillEvents ?? []).filter((e) => e.skill === "go_to" && e.type !== "started");
    const flinched = ticks.flatMap((t) => t.skillEvents ?? []).find((e) => e.skill === "flinch" && e.type === "done");
    const end = ticks.at(-1)!.state.data.self.position.x;
    const ok = first?.s.size === "flinch" && flinched !== undefined && journey.length === 1 && journey[0]!.type === "done" && end >= 74;
    return row("a far bang mid-journey", ok, `${first ? `magnitude ${first.s.magnitude}` : "NO EVENT"}; flinch ${flinched ? `ran (${JSON.stringify(flinched.changes)})` : "did NOT run"}; the journey ended ${journey.map((e) => e.type).join(", ") || "never"} at x=${end} (one journey, not cancelled and restarted: ${journey.length === 1})`, first?.s, first ? startMs(ticks, first) : null);
  },

  /** 7. Prepared action: a goal with an onStartle response; an unrelated bang releases it. Timed against firing it the ordinary way. */
  async prepared() {
    const plan = { goal: "Hold this spot.", steps: [], reason: "", ifThen: [{ when: "zombie", skill: "return_to_base", onStartle: true }] };
    const started = (ticks: Tick[], since: number) => ticks.filter((t) => t.timestamp >= since).flatMap((t) => (t.skillEvents ?? []).filter((e) => e.skill === "return_to_base" && e.type === "started"))[0];
    await freshPlaza();
    const released = await play(
      async () => {
        await sleep(17_000); // the fixed plan arrives with the planner's first run
        rcon(BANG_BEHIND);
        await sleep(4000);
      },
      { plan },
    );
    const [bang] = explosions(released);
    const byStartle = bang ? startMs(released, bang) : null;
    // The ordinary way: the thing it names appears in view.
    await freshPlaza();
    let appearedAt = 0;
    const ordinary = await play(
      async () => {
        await sleep(17_000);
        appearedAt = Date.now();
        rcon("summon zombie 60.5 151 37.5 {NoAI:1b,Silent:1b}");
        await sleep(4000);
      },
      { plan },
    );
    const usual = started(ordinary, appearedAt);
    const byAppearing = usual ? usual.timestamp - appearedAt : null;
    const ok = bang?.s.released === "return_to_base" && byStartle !== null;
    return row("a prepared action released by an unrelated bang", ok, `${bang?.s.released ? `released ${bang.s.released}` : "NOT released"} ${byStartle ?? "?"} ms after the bang; fired the ordinary way (its zombie appearing) it started ${byAppearing ?? "never"} ms after the zombie was summoned`, bang?.s, byStartle);
  },

  /** 8. Ambush, with the whole brain: peak alarm, and whether the planner stayed online. */
  async ambush() {
    await freshPlaza();
    let at = 0;
    const ticks = await play(
      async () => {
        await sleep(8000);
        at = Date.now();
        rcon(`execute at ${BOT} run summon zombie ~ ~ ~2 {Silent:1b}`);
        await sleep(12_000);
      },
      { whole: true },
    );
    const since = ticks.filter((t) => t.timestamp >= at);
    const first = judged(since).find((j) => j.startled);
    const firstTick = since.find((t) => traceOf(t, "noradrenaline").raisedBy);
    const onArrival = firstTick?.signals.alarm?.value ?? 0;
    const peak = Math.max(0, ...since.map((t) => t.signals.alarm?.value ?? 0));
    const offline = since.filter((t) => (t.signals.planner_offline?.value ?? 0) > 0).length;
    const before = 0.9; // 0.6 for the mob appearing plus the old fixed 0.3 for the startle
    return row("ambush (whole brain)", onArrival > 0 && onArrival <= 0.8, `alarm on the tick it appeared: ${onArrival.toFixed(2)} (raised by ${JSON.stringify(firstTick ? traceOf(firstTick, "noradrenaline").raisedBy : {})}); before this change that tick gave ${before}. Peak over the fight: ${peak.toFixed(2)}; planner offline ${offline} of ${since.length} ticks; lowest health ${Math.min(...since.map((t) => t.state.data.self.health))}`, first?.s, first ? startMs(ticks, first) : null);
  },

  /** 9. Starving for a minute: at most one startle. */
  async starving() {
    await freshPlaza();
    const ticks = await play(async () => {
      rcon("difficulty hard");
      rcon(`effect give ${BOT} hunger 30 255 true`);
      await sleep(12_000);
      // Keep it alive: starvation takes half a heart every 4 seconds.
      for (let i = 0; i < 6; i++) {
        await sleep(10_000);
        rcon(`effect give ${BOT} instant_health 1 0 true`);
      }
    });
    rcon("difficulty easy");
    const hunger = judged(ticks).filter((j) => j.s.kind === "hurt:starve");
    const startled = hunger.filter((j) => j.startled);
    const lowestFood = Math.min(...ticks.map((t) => t.state.data.self.food));
    return row("starving for a minute", hunger.length >= 3 && startled.length <= 1, `food down to ${lowestFood}; ${hunger.length} starvation hurts, ${startled.length} startled (${startled.map((j) => j.s.size).join(", ") || "none"}); the rest: ${[...new Set(hunger.filter((j) => !j.startled).map((j) => `${j.s.why}, habituated ${j.s.habituated}`))].join(" | ") || "none"}`, startled[0]?.s ?? hunger[0]?.s);
  },
};

const wanted = process.argv.slice(2);
const rows: Row[] = [];
try {
  for (const [name, run] of Object.entries(scenes)) {
    if (wanted.length && !wanted.includes(name)) continue;
    console.log(`=== ${name}`);
    const result = await run().catch((error: unknown): Row => ({ scene: name, outcome: `ERROR: ${error instanceof Error ? error.message : error}`, magnitude: "", size: "", changedBy: "", startMs: null, ok: false }));
    rows.push(result);
    console.log(`    ${result.ok ? "ok" : "NOT ok"}: ${result.outcome}`);
  }
} finally {
  for (const command of ["kill @e[type=!player,x=60,y=151,z=40,distance=..60]", "fill 40 151 20 80 160 45 air", "fill 40 149 30 80 150 44 stone", "fill 39 151 35 81 152 35 glass", "fill 39 151 45 81 152 45 glass", "fill 40 149 30 80 150 35 air", "time set noon", "difficulty easy", "gamerule spawn_mobs true", "forceload remove 39 35 81 45", `tp ${BOT} -8 69 14`]) rcon(command);
}

const table = [["scene", "magnitude", "flinch or full", "what changed its size", "event to start", "ok"], ...rows.map((r) => [r.scene, r.magnitude, r.size, r.changedBy, r.startMs === null ? "" : `${r.startMs} ms`, r.ok ? "yes" : "NO"])];
const widths = table[0]!.map((_, c) => Math.max(...table.map((r) => r[c]!.length)));
console.log("");
for (const [i, r] of table.entries()) {
  console.log(r.map((cell, c) => cell.padEnd(widths[c]!)).join(" | "));
  if (i === 0) console.log(widths.map((w) => "-".repeat(w)).join("-|-"));
}
const failed = rows.filter((r) => !r.ok);
console.log(failed.length ? `\nFAIL: ${failed.map((r) => r.scene).join(", ")}` : `\nPASS: all ${rows.length} scenes.`);
process.exit(failed.length ? 1 : 0);
