// Live check of the colliculus on the test server: what turns the bot's head, and how fast.
// Most scenes run with no Jev and no planner calls (the scenes say what to do); the field-of-view
// scene runs Jev, since that option only changes what the deciding layers are told.
// Needs the server container (MC_CONTAINER, default familiar-m6).
//   pnpm colliculus-check [scene ...]
import { spawn } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { buildPlaza, rcon, sleep } from "./primitive-check/world.ts";

const BOT = "Gazer";
/** The same bot with the field of view switched on (bots.json). */
const WARY = "Wary";
const REGIONS = "reflex,medulla,brainstem,colliculus,acetylcholine,dopamine,noradrenaline,hippocampus,serotonin,prefrontal";
/** Facing north (toward z=36); behind it is south. */
const START = "60.5 151 40.5 180 0";

interface Won {
  id: string;
  kind: string;
  via: string;
  bearing: string;
  salience: number;
  why: string;
}
interface Tick {
  tick: number;
  timestamp: number;
  state: { data: { self: { position: { x: number; z: number }; health: number; deaths: number; gaze: { id: string | null; yaw: number }; lastHurt: { msAgo: number; by: string | null } | null }; nearby: { mobs: { id: string; type: string; seen?: boolean; dist: number; bearing?: { angle: number } }[]; heard: { type: string }[]; sudden: { id: string; what: string }[] } } };
  winner: { region: string; action: { skill?: string; target?: string }; reason: string } | null;
  alongside?: { region: string; action: { skill?: string } };
  regions: { region: string; trace?: { winner?: Won; look?: { how: string }; scan?: unknown; damped?: Record<string, number>; rules?: { rule: string }[]; worstMs?: number; questions?: { options?: string[] }[]; threshold?: number } }[];
  signals: Record<string, { value: number }>;
  attended?: { id: string } | null;
  skillEvents?: { skill: string; type: string; target?: string; reason?: string }[];
}

interface Options {
  bot?: string;
  start?: string;
  flags?: string[];
  plan?: object;
  jev?: boolean;
}

/** Runs the real bot; `act` scripts the scene while it runs. */
async function play(act: (say: (command: string) => void) => Promise<void>, options: Options = {}): Promise<Tick[]> {
  const bot = options.bot ?? BOT;
  rmSync(`data/${bot}`, { recursive: true, force: true });
  const plan = options.plan ? ["--plan", JSON.stringify(options.plan)] : [];
  const brain = options.jev ? ["--engine", "jev", "--planner", "echo"] : ["--engine", "echo", "--planner", "echo", "--regions", REGIONS];
  const child = spawn("node", ["--env-file-if-exists=.env", "apps/run-bot/dist/index.js", ...brain, ...plan, ...(options.flags ?? []), "--manual", "--name", bot], { stdio: ["pipe", "pipe", "pipe"] });
  let output = "";
  let exited = false;
  child.stdout.on("data", (d: Buffer) => (output += d));
  child.stderr.on("data", (d: Buffer) => (output += d));
  child.once("exit", () => (exited = true));
  const joined = Date.now();
  while (!output.includes("Logging to") && !exited && Date.now() - joined < 30_000) await sleep(200);
  if (exited) throw new Error(`The bot stopped before it started playing:\n${output.slice(-500)}`);
  for (const command of [`gamemode survival ${bot}`, `clear ${bot}`, `effect clear ${bot}`, `effect give ${bot} instant_health 1 10 true`, `effect give ${bot} saturation 1 10 true`, `tp ${bot} ${options.start ?? START}`]) rcon(command);
  await sleep(2000);
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
  for (const command of ["kill @e[type=!player,x=60,y=151,z=40,distance=..60]", "fill 40 151 36 80 160 44 air", "fill 40 149 36 80 150 44 stone", "fill 39 151 35 81 152 35 glass", "fill 39 151 45 81 152 45 glass", "time set noon"]) rcon(command);
  await sleep(500);
}

const traceOf = (t: Tick, region: string) => t.regions.find((r) => r.region === region)?.trace ?? {};
const selfOf = (t: Tick) => t.state.data.self;
/** The ticks on which the colliculus turned the head to something (not a glance around). */
const looksOf = (ticks: Tick[]) => ticks.flatMap((t) => (traceOf(t, "colliculus").winner && traceOf(t, "colliculus").look ? [{ t, won: traceOf(t, "colliculus").winner!, how: traceOf(t, "colliculus").look!.how }] : []));
const drawnBy = (w: Won) => (w.via === "touch" ? "touch" : w.why.endsWith("looming") ? "looming" : w.via);
/** How far a compass heading is from another, in degrees. */
const off = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
const worstOf = (ticks: Tick[]) => Math.max(0, ...ticks.map((t) => traceOf(t, "colliculus").worstMs ?? 0));

interface Row {
  scene: string;
  outcome: string;
  won: string;
  turnMs: number | null;
  how: string;
  worstMs: number;
  ok: boolean;
}
const row = (scene: string, ticks: Tick[], ok: boolean, outcome: string, won = "", turnMs: number | null = null, how = ""): Row => ({ scene, outcome, won, turnMs, how, worstMs: worstOf(ticks), ok });
const describe = (w: Won | undefined) => (w ? `${w.kind} (${drawnBy(w)}, ${w.bearing}, salience ${w.salience})` : "nothing");

/** For a bot at x=44 facing east: an arrow that appears `blocks` east of it, heading straight for it. */
function shootFrom(blocks: number): void {
  rcon(`summon arrow ${44 + blocks}.5 152.6 40.5 {Motion:[-1.7,0.06,0.0]}`);
}
/** A still skeleton `blocks` east of that bot, under a roof so it does not burn. */
function standSkeleton(blocks: number): void {
  for (const command of [`setblock ${44 + blocks} 153 40 stone`, `summon skeleton ${44 + blocks}.5 151 40.5 {NoAI:1b,Silent:1b,PersistenceRequired:1b}`]) rcon(command);
}

const scenes: Record<string, () => Promise<Row>> = {
  /** 1. Bang behind: an explosion behind the bot. It turns toward it. */
  async bang() {
    await freshPlaza();
    let at = 0;
    const ticks = await play(async () => {
      await sleep(3000);
      at = Date.now();
      // In the open air south of the plaza, 10 blocks behind the bot.
      rcon("summon tnt 60.5 153 50.5 {fuse:0}");
      await sleep(5000);
    });
    const heard = ticks.find((t) => t.timestamp >= at - 200 && t.state.data.nearby.heard.some((h) => h.type === "explosion"));
    // South is a heading of 180 degrees.
    const turned = heard ? ticks.find((t) => t.timestamp >= heard.timestamp && off(selfOf(t).gaze.yaw, 180) <= 30) : undefined;
    const by = ticks.find((t) => heard && t.timestamp >= heard.timestamp && (t.winner?.action.skill === "brace" || t.winner?.action.skill === "look_at"));
    const won = heard ? traceOf(heard, "colliculus").winner : undefined;
    // Standing with nothing to do it glances around, so where it faced when the bang came varies: what counts is that it was not already facing it.
    const facedAway = won !== undefined && won.bearing !== "ahead";
    const ms = heard && turned ? turned.timestamp - at : null;
    return row("bang behind", ticks, facedAway && turned !== undefined, `${heard ? "heard the explosion" : "DID NOT HEAR IT"}; ${turned ? `facing it ${ms} ms after it went off` : "never turned to it"}, by ${by?.winner?.action.skill ?? "nothing"} (${by?.winner?.region ?? ""}); map's top: ${describe(won)}`, describe(won), ms, by?.winner?.action.skill === "brace" ? "startle braced toward it" : "took over");
  },

  /** 2. Walking glance (--same-time): something appears to the side mid-journey. It glances and keeps walking. */
  async glance() {
    await freshPlaza();
    let at = 0;
    const ticks = await play(
      async (say) => {
        say("do go_to pos:76,151,40");
        await sleep(2500);
        at = Date.now();
        rcon(`execute at ${BOT} run summon pig ~4 151 37 {NoAI:1b}`);
        await sleep(7000);
      },
      { start: "44.5 151 40.5 -90 0", flags: ["--same-time"] },
    );
    // The pig is seen and (its arrival) heard at the same spot: either may be what wins the look.
    const look = looksOf(ticks).find((l) => l.t.timestamp >= at);
    const facedIt = ticks.some((t) => look && t.timestamp > look.t.timestamp && t.timestamp - look.t.timestamp < 1500 && Math.abs(t.state.data.nearby.mobs.find((m) => m.type === "pig")?.bearing?.angle ?? 180) <= 20);
    const ran = look ? ticks.find((t) => t.timestamp >= look.t.timestamp && (t.skillEvents ?? []).some((e) => e.skill === "look_at" && e.type === "done")) : undefined;
    const journey = ticks.flatMap((t) => t.skillEvents ?? []).find((e) => e.skill === "go_to" && e.type !== "started");
    const end = selfOf(ticks.at(-1)!).position.x;
    const ok = look?.how === "alongside" && facedIt && journey?.type === "done" && end >= 74;
    return row("walking glance (--same-time)", ticks, ok, `${look ? `glanced toward the pig (${look.how}; drawn by ${drawnBy(look.won)}; head on it: ${facedIt})` : "NO glance at the pig"}; the journey ${journey?.type ?? "did not end"} at x=${end}`, describe(look?.won), look && ran ? ran.timestamp - at : null, look?.how ?? "");
  },

  /** 3. Two things: a slow near animal and a fast far one. Which wins, and why. */
  async two() {
    await freshPlaza();
    let at = 0;
    const ticks = await play(async () => {
      // Near and still, to the left; far and fast, coming from ahead.
      rcon("summon cow 57.5 151 38.5 {NoAI:1b}");
      rcon("summon pig 60.5 151 37.5 {NoAI:1b,Tags:[\"runner\"]}");
      rcon("tp @e[tag=runner] 62.5 151 22.5");
      await sleep(4000);
      at = Date.now();
      for (let i = 0; i < 9; i++) rcon("execute as @e[tag=runner] at @s run tp @s ~ ~ ~1.5");
      await sleep(3000);
    });
    // What the map made of each while the runner ran.
    const during = looksOf(ticks).filter((l) => l.t.timestamp >= at - 300);
    const first = during[0];
    const tops = ticks.filter((t) => t.timestamp >= at - 300).flatMap((t) => (traceOf(t, "colliculus") as { top?: { kind: string; salience: number; parts: Record<string, number> }[] }).top ?? []);
    const best = (kind: string) => tops.filter((t) => t.kind === kind).sort((a, b) => b.salience - a.salience)[0];
    const [pig, cow] = [best("pig"), best("cow")];
    return row("slow near animal and fast far one", ticks, first?.won.kind === "pig", `${first ? `turned to the ${first.won.kind} (${first.won.why})` : "turned to neither"}; the fast far pig peaked at ${pig?.salience ?? 0} ${JSON.stringify(pig?.parts ?? {})}, the near still cow at ${cow?.salience ?? 0} ${JSON.stringify(cow?.parts ?? {})}`, describe(first?.won), first ? first.t.timestamp - at : null, first?.how ?? "");
  },

  /** 4. The same wandering animal for two minutes: looks fall off. */
  async habituate() {
    await freshPlaza();
    const ticks = await play(async (say) => {
      say("do idle");
      // Penned in front of the bot, so it wanders in view.
      for (const command of ["fill 57 151 36 63 151 36 oak_fence", "fill 57 151 39 63 151 39 oak_fence", "fill 57 151 37 57 151 38 oak_fence", "fill 63 151 37 63 151 38 oak_fence", "summon cow 60.5 151 37.5"]) rcon(command);
      await sleep(120_000);
    });
    const start = ticks[0]!.timestamp;
    const cowLooks = looksOf(ticks).filter((l) => l.won.kind === "cow");
    const perHalfMinute = [0, 1, 2, 3].map((n) => cowLooks.filter((l) => Math.floor((l.t.timestamp - start) / 30_000) === n).length);
    const damped = [...new Set(ticks.flatMap((t) => Object.keys(traceOf(t, "colliculus").damped ?? {})))];
    const glances = ticks.filter((t) => traceOf(t, "colliculus").scan !== undefined).length;
    const ok = cowLooks.length > 0 && perHalfMinute[3]! + perHalfMinute[2]! < perHalfMinute[0]! + perHalfMinute[1]! + 1 && damped.length > 0;
    return row("the same wandering animal for two minutes", ticks, ok, `looks at the cow per half minute: ${perHalfMinute.join(", ")} (${cowLooks.length} in all); got used to: ${damped.slice(0, 3).join("; ") || "nothing"}; ${glances} glances around meanwhile`, `cow ×${cowLooks.length}`, null, cowLooks[0]?.how ?? "");
  },

  /** 5. Watching for something: a goal with watchFor; that kind wins over a similar one. */
  async watching() {
    await freshPlaza();
    let at = 0;
    const ticks = await play(
      async () => {
        await sleep(17_000); // the fixed plan arrives with the planner's first run
        at = Date.now();
        // The same distance either side, at the same moment.
        rcon("summon cow 56.5 151 37.5 {NoAI:1b}");
        rcon("summon pig 64.5 151 37.5 {NoAI:1b}");
        await sleep(5000);
      },
      { plan: { goal: "Find a pig.", steps: [], reason: "", watchFor: ["pig"] } },
    );
    const first = looksOf(ticks).find((l) => l.t.timestamp >= at && ["pig", "cow"].includes(l.won.kind));
    const top = first ? ((traceOf(first.t, "colliculus") as { top?: { kind: string; salience: number }[] }).top ?? []).map((t) => `${t.kind} ${t.salience}`).join(", ") : "";
    return row("watching for a pig (the goal's watchFor)", ticks, first?.won.kind === "pig", `${first ? `first turned to the ${first.won.kind}` : "turned to neither"}; on the map: ${top}`, describe(first?.won), first ? first.t.timestamp - at : null, first?.how ?? "");
  },

  /** 6. Arrow from 16 blocks: looming fires, alarm rises, and the defence reflex treats it as approaching. */
  async arrow() {
    await freshPlaza();
    let at = 0;
    const ticks = await play(
      async () => {
        standSkeleton(14);
        await sleep(5000); // long enough for the skeleton itself to stop being news
        at = Date.now();
        // Standing with nothing to do it glances around, so some arrows come while it faces away.
        for (let i = 0; i < 5; i++) {
          shootFrom(12);
          await sleep(1500);
          rcon(`effect give ${BOT} instant_health 1 10 true`);
        }
        await sleep(2000);
      },
      { start: "44.5 151 40.5 -90 0" },
    );
    const since = ticks.filter((t) => t.timestamp >= at);
    const before = ticks.filter((t) => t.timestamp < at);
    const looming = Math.max(0, ...since.map((t) => t.signals.looming?.value ?? 0));
    const alarm = [Math.max(0, ...before.map((t) => t.signals.alarm?.value ?? 0)), Math.max(0, ...since.map((t) => t.signals.alarm?.value ?? 0))];
    const fled = since.filter((t) => traceOf(t, "reflex").rules?.some((r) => r.rule === "defence_flee"));
    const beforeFled = before.filter((t) => traceOf(t, "reflex").rules?.some((r) => r.rule === "defence_flee")).length;
    const look = looksOf(since).find((l) => drawnBy(l.won) === "looming");
    const ok = looming > 0 && alarm[1]! > alarm[0]! + 0.3 && fled.length > 0 && beforeFled === 0;
    return row("arrows from 12 blocks, a still skeleton at 14", ticks, ok, `looming up to ${looming.toFixed(2)}; alarm ${alarm[0]!.toFixed(2)} → ${alarm[1]!.toFixed(2)}; defence_flee fired ${fled.length} ticks (${beforeFled} before the arrows); lowest health ${Math.min(...ticks.map((t) => selfOf(t).health))}`, describe(look?.won), look ? look.t.timestamp - at : null, look?.how ?? "");
  },

  /** 7. Busy: during a demanding skill, a mild event is ignored and a looming one is not. */
  async busy() {
    await freshPlaza();
    let mildAt = 0;
    let loomAt = 0;
    const ticks = await play(async (say) => {
      // Something to fight, close in front, that neither moves nor dies quickly.
      rcon("summon zombie 60.5 151 38.5 {NoAI:1b,Silent:1b,PersistenceRequired:1b,attributes:[{id:\"minecraft:max_health\",base:200}],Health:200f}");
      rcon(`give ${BOT} iron_sword`);
      await sleep(2500);
      say("do attack");
      await sleep(3000);
      mildAt = Date.now();
      rcon("summon pig 56.5 151 38.5 {NoAI:1b}");
      await sleep(4000);
      loomAt = Date.now();
      rcon("execute run summon arrow 52.5 152.6 40.5 {Motion:[1.7,0.06,0.0]}");
      await sleep(3000);
    });
    const attacking = (t: Tick) => (t.skillEvents ?? []).some((e) => e.skill === "attack");
    const started = ticks.find(attacking);
    const mild = looksOf(ticks).filter((l) => l.t.timestamp >= mildAt && l.t.timestamp < loomAt);
    const loom = looksOf(ticks).find((l) => l.t.timestamp >= loomAt);
    const threshold = Math.max(0, ...ticks.filter((t) => t.timestamp >= mildAt && t.timestamp < loomAt).map((t) => traceOf(t, "colliculus").threshold ?? 0));
    const ok = started !== undefined && mild.length === 0 && loom !== undefined;
    return row("busy with a demanding skill (attack)", ticks, ok, `${started ? "attacking" : "NEVER ATTACKED"}; a pig appearing to the side drew ${mild.length} look(s) (threshold up to ${threshold}); an arrow from the side drew ${loom ? `a look (${loom.won.why})` : "NO look"}`, describe(loom?.won), loom ? loom.t.timestamp - loomAt : null, loom?.how ?? "");
  },

  /** 8. Field of view on and off: a hostile behind the bot. When does Jev learn of it? */
  async field_of_view() {
    const results: string[] = [];
    let all: Tick[] = [];
    const known: (number | null)[] = [];
    for (const bot of [WARY, BOT]) {
      await freshPlaza();
      let at = 0;
      const ticks = await play(
        async () => {
          await sleep(6000);
          at = Date.now();
          // Sixteen blocks straight behind (beyond the 8 at which it would be "heard"), walking up. A husk does not burn by day.
          rcon("summon husk 72.5 151 40.5 {Silent:1b}");
          await sleep(25_000);
        },
        { bot, jev: true, start: "56.5 151 40.5 90 0" },
      );
      all = [...all, ...ticks];
      const zombie = (t: Tick) => t.state.data.nearby.mobs.find((m) => m.type === "husk");
      const there = ticks.find((t) => t.timestamp >= at && zombie(t));
      // Jev knows of it once it is among the targets it is offered.
      const told = ticks.find((t) => there && t.timestamp >= there.timestamp && zombie(t) && (traceOf(t, "instinct").questions ?? []).some((q) => q.options?.includes(zombie(t)!.id)));
      const lookedAt = looksOf(ticks).find((l) => l.t.timestamp >= at && (l.won.kind === "husk" || l.won.kind === "presence"));
      const hurts = ticks.filter((t, i) => i > 0 && selfOf(t).lastHurt?.by && selfOf(t).lastHurt!.msAgo < (selfOf(ticks[i - 1]!).lastHurt?.msAgo ?? Infinity));
      const blindsided = hurts.filter((t) => !ticks.some((a) => a.attended?.id === selfOf(t).lastHurt!.by && t.timestamp - a.timestamp <= 5000 && a.timestamp < t.timestamp)).length;
      const delay = there && told ? told.timestamp - there.timestamp : null;
      known.push(delay);
      results.push(`${bot === WARY ? "ON" : "OFF"}: Jev told of the husk ${delay === null ? "never" : `${delay} ms after it was in range`}${told ? ` (at ${zombie(told)!.dist} blocks, ${zombie(told)!.seen ? "seen" : "not seen"})` : ""}; first turned to it by ${lookedAt ? `${lookedAt.won.via} (${lookedAt.won.kind})` : "nothing"}; hurt ${hurts.length} times, blindsided ${blindsided}; deaths ${selfOf(ticks.at(-1)!).deaths}, lowest health ${Math.min(...ticks.map((t) => selfOf(t).health))}`);
    }
    const [on, offDelay] = known;
    // Off, Jev knows at once. On, only once the bot has heard it or turned to it.
    const ok = offDelay !== null && offDelay !== undefined && offDelay <= 1000 && (on === null || on === undefined || on > offDelay);
    return row("field of view on and off: a husk 16 blocks behind", all, ok, results.join(" || "), "", null, "");
  },
};

const wanted = process.argv.slice(2);
const rows: Row[] = [];
try {
  for (const [name, run] of Object.entries(scenes)) {
    if (wanted.length && !wanted.includes(name)) continue;
    console.log(`=== ${name}`);
    const result = await run().catch((error: unknown): Row => ({ scene: name, outcome: `ERROR: ${error instanceof Error ? error.message : error}`, won: "", turnMs: null, how: "", worstMs: 0, ok: false }));
    rows.push(result);
    console.log(`    ${result.ok ? "ok" : "NOT ok"}: ${result.outcome}`);
  }
} finally {
  for (const command of ["kill @e[type=!player,x=60,y=151,z=40,distance=..60]", "fill 40 151 20 80 160 45 air", "fill 40 149 36 80 150 44 stone", "fill 39 151 35 81 152 35 glass", "fill 39 151 45 81 152 45 glass", "gamerule spawn_mobs true", "forceload remove 39 35 81 45", `tp ${BOT} -8 69 14`, `tp ${WARY} -8 69 14`]) rcon(command);
}

const table = [["scene", "what won", "event to turn", "alongside or interrupted", "ok"], ...rows.map((r) => [r.scene, r.won, r.turnMs === null ? "" : `${r.turnMs} ms`, r.how, r.ok ? "yes" : "NO"])];
const widths = table[0]!.map((_, c) => Math.max(...table.map((r) => r[c]!.length)));
console.log("");
for (const [i, r] of table.entries()) {
  console.log(r.map((cell, c) => cell.padEnd(widths[c]!)).join(" | "));
  if (i === 0) console.log(widths.map((w) => "-".repeat(w)).join("-|-"));
}
console.log(`\nSlowest map in any scene: ${Math.max(0, ...rows.map((r) => r.worstMs)).toFixed(3)} ms (it should stay under 2).`);
const failed = rows.filter((r) => !r.ok);
console.log(failed.length ? `FAIL: ${failed.map((r) => r.scene).join(", ")}` : `PASS: all ${rows.length} scenes.`);
process.exit(failed.length ? 1 : 0);
