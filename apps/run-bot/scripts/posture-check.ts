// Live check of balance and posture on the test server. The real bot runs with no Jev and no
// planner calls: the scenes tell it what to try (dig here, walk there) and drop, shove and move
// it. Each scene is judged from the bot's own tick log.
// Needs the server container (MC_CONTAINER, default familiar-m6).
//   pnpm posture-check [scene ...]
import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { buildPlaza, rcon, sleep } from "./primitive-check/world.ts";

/** A bot with the default posture (born knowing sand and gravel are loose), and one born knowing nothing loose. */
const BORN = "Poser";
const BLANK = "Naive";
const REGIONS = "reflex,medulla,brainstem,acetylcholine,dopamine,noradrenaline,hippocampus,amygdala,serotonin,prefrontal";

interface Posture {
  balance?: number;
  refusals?: { action: string; at: string; reason: string }[];
  stance?: string[];
  falls?: { blocks: number; damage: number; steered: boolean; onto: string; note?: string }[];
  learned?: string[];
  displaced?: string[];
  worstCheckMs?: number;
}
interface Tick {
  timestamp: number;
  state: { data: { self: { position: { x: number; y: number; z: number }; health: number; deaths: number; inBlock: boolean; balance: number; displaced: boolean; velocity: { x: number; z: number }; support: { kind: string; edges: number } } } };
  winner: { region: string; action: { skill?: string }; reason: string } | null;
  regions: { region: string; trace?: { rules?: { rule: string }[]; posture?: Posture } }[];
  signals: Record<string, { value: number }>;
  skillEvents?: { skill: string; type: string; target?: string; reason?: string; changes?: Record<string, unknown> }[];
}

/** Runs the real bot; `act` scripts the scene while it runs. */
async function play(bot: string, act: (say: (command: string) => void) => Promise<void>, start = "60.5 151 40.5 180 0"): Promise<Tick[]> {
  rmSync(`data/${bot}`, { recursive: true, force: true });
  const child = spawn("node", ["apps/run-bot/dist/index.js", "--engine", "echo", "--planner", "echo", "--regions", REGIONS, "--manual", "--name", bot], { stdio: ["pipe", "pipe", "pipe"] });
  let output = "";
  let exited = false;
  child.stdout.on("data", (d: Buffer) => (output += d));
  child.stderr.on("data", (d: Buffer) => (output += d));
  child.once("exit", () => (exited = true));
  const joined = Date.now();
  while (!output.includes("Logging to") && !exited && Date.now() - joined < 30_000) await sleep(200);
  if (exited) throw new Error(`The bot stopped before it started playing:\n${output.slice(-500)}`);
  for (const command of [`gamemode survival ${bot}`, `clear ${bot}`, `effect clear ${bot}`, `effect give ${bot} instant_health 1 10 true`, `effect give ${bot} saturation 1 10 true`, `tp ${bot} ${start}`]) rcon(command);
  await sleep(1500);
  try {
    await act((command) => void child.stdin.write(`${command}\n`));
  } finally {
    child.stdin.end();
    child.kill("SIGINT");
    const hard = setTimeout(() => child.kill("SIGKILL"), 8000);
    if (!exited) await new Promise((resolve) => child.once("exit", resolve));
    clearTimeout(hard);
  }
  for (const line of output.split("\n").filter((l) => l.includes("posture:"))) console.log(`   ${line.trim()}`);
  const file = output.match(/Logging to (\S+)/)?.[1];
  if (!file) throw new Error("no log file");
  console.log(`    log: ${file}`);
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as Tick);
}

/** The plaza floor (top at y=150) with a 6-block drop north of it (z below 36), down to a floor at y=144. */
async function freshPlaza(): Promise<void> {
  buildPlaza();
  for (const command of ["kill @e[type=!player,x=60,y=151,z=40,distance=..40]", "fill 40 151 36 80 160 44 air", "fill 40 149 36 80 150 44 stone", "fill 54 144 20 66 144 35 stone", "fill 54 145 20 66 160 35 air"]) rcon(command);
  await sleep(500);
}

const selfOf = (t: Tick) => t.state.data.self;
const postureOf = (t: Tick) => t.regions.find((r) => r.region === "brainstem")?.trace?.posture ?? {};
const events = (ticks: Tick[], skill: string, type?: string) => ticks.flatMap((t) => (t.skillEvents ?? []).filter((e) => e.skill === skill && (!type || e.type === type)));
const refusalsOf = (ticks: Tick[]) => ticks.flatMap((t) => postureOf(t).refusals ?? []).map((r) => `${r.action}: ${r.reason}`);
const learnedOf = (ticks: Tick[]) => ticks.flatMap((t) => postureOf(t).learned ?? []);
const fallsOf = (ticks: Tick[]) => ticks.flatMap((t) => postureOf(t).falls ?? []);
const worstOf = (ticks: Tick[]) => Math.max(0, ...ticks.map((t) => postureOf(t).worstCheckMs ?? 0));

interface Row {
  scene: string;
  outcome: string;
  refusals: string[];
  learned: string[];
  worstCheckMs: number;
  ok: boolean;
}
const row = (scene: string, ticks: Tick[], ok: boolean, outcome: string): Row => ({ scene, outcome, refusals: [...new Set(refusalsOf(ticks))], learned: learnedOf(ticks), worstCheckMs: worstOf(ticks), ok });

/** One fall from 8 blocks up over the plaza floor, with or without water one block to the side. */
async function drop(scene: string, water: boolean): Promise<Row> {
  await freshPlaza();
  if (water) rcon("setblock 61 150 40 water");
  const ticks = await play(BORN, async () => {
    for (let i = 0; i < 3; i++) {
      rcon(`effect give ${BORN} instant_health 1 10 true`);
      rcon(`tp ${BORN} 60.5 159 40.5 180 0`);
      await sleep(4000);
    }
  });
  const falls = fallsOf(ticks);
  const steered = falls.filter((f) => f.steered);
  const unhurt = falls.filter((f) => f.damage === 0).length;
  const fired = ticks.filter((t) => t.regions.some((r) => r.region === "reflex" && r.trace?.rules?.some((f) => f.rule === "falling_right"))).length;
  const told = falls.map((f) => `${f.blocks} onto ${f.onto}, damage ${f.damage}${f.steered ? ", steered" : ""}`).join(" | ");
  const inWater = steered.filter((f) => f.onto === "water" && f.damage === 0).length;
  if (water) return row(scene, ticks, inWater >= 2, `landed in the water unhurt ${inWater} of ${falls.length} times; ${falls.length} falls: ${told}; falling_right fired ${fired} ticks; landed unhurt ${unhurt} of ${falls.length}`);
  return row(scene, ticks, falls.length === 3 && steered.length === 0 && fired === 0 && falls.every((f) => f.note !== undefined), `${falls.length} falls recorded: ${told}; falling_right fired ${fired} ticks (nothing to steer for)`);
}

const scenes: Record<string, () => Promise<Row>> = {
  /**
   * 1. Dig the block underfoot 6 high: refused, with the reason. On a 1-high step: allowed.
   * The perch is one block with nothing under it. (A solid pillar is safe to dig down a block at
   * a time, and is allowed: each dig drops the bot one block.)
   */
  async pillar() {
    await freshPlaza();
    for (const command of ["setblock 60 156 40 dirt", "setblock 64 151 40 dirt"]) rcon(command);
    const ticks = await play(
      BORN,
      async (say) => {
        say("do break_block pos:60,156,40");
        await sleep(2500);
        rcon(`tp ${BORN} 64.5 152 40.5 180 0`);
        await sleep(1200);
        say("do break_block pos:64,151,40");
        await sleep(3500);
      },
      "60.5 157 40.5 180 0",
    );
    const refused = events(ticks, "break_block", "failed").find((e) => e.target === "pos:60,156,40");
    const allowed = events(ticks, "break_block", "done").some((e) => e.target === "pos:64,151,40");
    const lowest = Math.min(...ticks.filter((t) => selfOf(t).position.x === 60).map((t) => selfOf(t).position.y));
    return row("dig the block underfoot 6 high, then on a 1-high step", ticks, refused?.reason?.includes("drop me") === true && allowed && lowest >= 157, `6 high: ${refused ? `refused ("${refused.reason}")` : "NOT refused"}, stayed at y=${lowest}; on the step: ${allowed ? "allowed" : "NOT allowed"}`);
  },

  /** 2. Dig into a wall under a gravel column: refused, or done from the side; never buried. */
  async gravel() {
    await freshPlaza();
    for (const command of ["setblock 60 151 39 stone", "setblock 60 152 39 dirt", "fill 60 153 39 60 155 39 gravel"]) rcon(command);
    const ticks = await play(BORN, async (say) => {
      say("do break_block pos:60,152,39");
      await sleep(2500);
      // From one step to the side, as the refusal suggests.
      rcon(`tp ${BORN} 61.5 151 40.5 135 0`);
      await sleep(1200);
      say("do break_block pos:60,152,39");
      await sleep(4000);
    });
    const tries = events(ticks, "break_block").filter((e) => e.type !== "started");
    const first = tries[0];
    const second = tries[1];
    const buried = ticks.filter((t) => selfOf(t).inBlock).length;
    const ok = first?.type === "failed" && first.reason?.includes("gravel") === true && second?.type === "done" && buried === 0;
    return row("dig into a wall under a gravel column", ticks, ok, `facing it: ${first?.type === "failed" ? `refused ("${first.reason}")` : `NOT refused (${first?.type})`}; from the side: ${second?.type ?? "not tried"}${second?.changes?.cameDown ? `, ${String(second.changes.cameDown)} came down` : ""}; buried ${buried} ticks`);
  },

  /** 3. Break a block while standing at a cliff edge: sneaks during, does not fall, stands up after. */
  async edge() {
    await freshPlaza();
    rcon("setblock 61 151 36 dirt");
    const ticks = await play(
      BORN,
      async (say) => {
        say("do break_block pos:61,151,36");
        await sleep(4000);
        // The same dig on open ground, for comparison.
        rcon("setblock 61 151 40 dirt");
        rcon(`tp ${BORN} 60.5 151 40.5 -90 0`);
        await sleep(1200);
        say("do break_block pos:61,151,40");
        await sleep(3500);
      },
      "60.5 151 36.5 -90 0",
    );
    const digs = events(ticks, "break_block", "done");
    const [atEdge, inOpen] = digs;
    const held = ticks.flatMap((t) => postureOf(t).stance ?? []);
    const lowest = Math.min(...ticks.map((t) => selfOf(t).position.y));
    const ok = atEdge?.changes?.stance === true && atEdge.changes.sneaking === undefined && inOpen !== undefined && inOpen.changes?.stance === undefined && lowest >= 151 && held.length === 1;
    return row("break a block at a cliff edge", ticks, ok, `at the edge: sneak held ${atEdge?.changes?.stance === true ? "yes" : "NO"}, still sneaking after: ${atEdge?.changes?.sneaking === true ? "YES" : "no"}; on open ground: sneak held ${inOpen?.changes?.stance === true ? "YES" : "no"}; lowest y ${lowest} (the edge is at 151)`);
  },

  /** 4. Walk a one-wide bridge over a drop: caution rises, it sneaks, it gets across. */
  async bridge() {
    await freshPlaza();
    for (const command of ["fill 60 150 26 60 150 35 stone", "fill 58 150 21 62 150 25 stone"]) rcon(command);
    const ticks = await play(
      BORN,
      async (say) => {
        say("do go_to pos:60,151,23");
        await sleep(22_000);
      },
      "60.5 151 39.5 180 0",
    );
    const onBridge = ticks.filter((t) => selfOf(t).position.z >= 26 && selfOf(t).position.z <= 35 && selfOf(t).position.y >= 150);
    const speeds = onBridge.map((t) => Math.hypot(selfOf(t).velocity.x, selfOf(t).velocity.z)).filter((v) => v > 0.2).sort((a, b) => a - b);
    const pace = speeds[Math.floor(speeds.length / 2)] ?? 0;
    const unsteady = Math.max(0, ...onBridge.map((t) => t.signals.unsteady?.value ?? 0));
    const end = selfOf(ticks.at(-1)!).position;
    const fell = ticks.some((t) => selfOf(t).position.y < 150);
    const journey = events(ticks, "go_to").find((e) => e.type !== "started");
    const ok = !fell && end.z <= 25 && unsteady >= 0.5 && pace > 0 && pace < 2.5;
    return row("walk a one-wide bridge over a drop", ticks, ok, `${fell ? "FELL" : "did not fall"}; ended at z=${end.z} (the far side is z<=25), journey ${journey?.type ?? "still going"}; unsteady up to ${unsteady.toFixed(2)} on the bridge; median pace there ${pace.toFixed(1)} blocks/s (a walk is 4.3, sneaking about 1.3)`);
  },

  /** 5a. Fall from 8 high with water one block to the side: it steers into the water. */
  fall_water: () => drop("fall 8 blocks, water one block to the side", true),
  /** 5b. With no water: it does nothing and the fall is recorded. */
  fall_plain: () => drop("fall 8 blocks, nothing in reach", false),

  /** 6. Teleport it 50 blocks mid-journey: it stops, re-plans, and does not walk back to the old route. */
  async teleport() {
    await freshPlaza();
    rcon("forceload add 100 36 120 44");
    for (const command of ["fill 100 149 36 120 150 44 stone", "fill 100 151 36 120 156 44 air"]) rcon(command);
    let movedAt = 0;
    const ticks = await play(
      BORN,
      async (say) => {
        say("do go_to pos:76,151,40");
        await sleep(2500);
        movedAt = Date.now();
        rcon(`tp ${BORN} 110.5 151 40.5`);
        await sleep(8000);
      },
      "44.5 151 40.5 -90 0",
    );
    rcon("fill 100 149 36 120 156 44 air");
    rcon("forceload remove 100 36 120 44");
    const after = ticks.filter((t) => t.timestamp > movedAt + 1000);
    const noticed = ticks.filter((t) => t.timestamp >= movedAt && selfOf(t).displaced).length;
    const replan = ticks.filter((t) => t.timestamp >= movedAt && (t.signals.replan?.value ?? 0) > 0).length;
    const journey = events(ticks, "go_to").find((e) => e.type !== "started");
    const strayed = Math.max(0, ...after.map((t) => Math.abs(selfOf(t).position.x - 110)));
    const heldGround = ticks.filter((t) => t.regions.some((r) => r.region === "reflex" && r.trace?.rules?.some((f) => f.rule === "hold_ground"))).length;
    const ok = noticed === 1 && replan >= 1 && journey?.type === "interrupted" && strayed <= 2 && heldGround === 0;
    return row("teleported 50 blocks mid-journey", ticks, ok, `noticed ${noticed} time(s); journey ${journey?.type ?? "not ended"}; replan raised ${replan} tick(s); afterwards strayed ${strayed.toFixed(1)} blocks from where it was put; hold_ground fired ${heldGround} ticks`);
  },

  /** 7. Born knowing nothing loose: dig under sand twice, and it learns. Then the check uses what it learned. */
  async learn_loose() {
    await freshPlaza();
    for (const x of [60, 63]) for (const command of [`setblock ${x} 151 39 dirt`, `setblock ${x} 152 39 sand`]) rcon(command);
    for (const command of ["setblock 66 151 39 stone", "setblock 66 152 39 dirt", "setblock 66 153 39 sand"]) rcon(command);
    const ticks = await play(BLANK, async (say) => {
      for (const x of [60, 63]) {
        rcon(`tp ${BLANK} ${x}.5 151 40.5 180 0`);
        await sleep(1200);
        say(`do break_block pos:${x},151,39`);
        await sleep(4000);
      }
      // Now it knows: the same kind of dig at head height is refused.
      rcon(`tp ${BLANK} 66.5 151 40.5 180 0`);
      await sleep(1200);
      say("do break_block pos:66,152,39");
      await sleep(3000);
    });
    const cameDown = events(ticks, "break_block", "done").filter((e) => e.changes?.cameDown === "sand").length;
    const last = events(ticks, "break_block").filter((e) => e.type !== "started").at(-1);
    const saved = existsSync(`data/${BLANK}/surfaces.json`) ? (JSON.parse(readFileSync(`data/${BLANK}/surfaces.json`, "utf8")) as { loose?: Record<string, number> }).loose : undefined;
    const ok = cameDown === 2 && learnedOf(ticks).includes("sand is loose") && last?.type === "failed" && last.reason?.includes("sand") === true && saved?.sand === 2;
    return row("born knowing nothing loose: dig under sand twice", ticks, ok, `sand came down in ${cameDown} of 2 digs; learned: ${learnedOf(ticks).join(", ") || "nothing"}; a third dig under sand at head height: ${last?.type === "failed" ? `refused ("${last.reason}")` : `NOT refused (${last?.type})`}; saved: ${JSON.stringify(saved ?? {})}`);
  },

  /** 8. Walk on ice for a while, then on soul sand and honey: show what was learned. Reported, not judged. */
  async surfaces() {
    await freshPlaza();
    const ticks = await play(
      BORN,
      async (say) => {
        for (const [block, legMs] of [["ice", 8000], ["soul_sand", 8000], ["honey_block", 14_000]] as const) {
          rcon(`fill 44 150 37 76 150 43 ${block}`);
          rcon(`tp ${BORN} 46.5 151.2 40.5 -90 0`);
          await sleep(1500);
          for (const x of [74, 46, 74, 46, 74, 46]) {
            say(`do go_to pos:${x},151,40`);
            await sleep(legMs);
          }
        }
      },
      "46.5 151 40.5 -90 0",
    );
    const learned = learnedOf(ticks);
    const kinds = [...new Set(ticks.map((t) => selfOf(t).support.kind))];
    return row("walk on ice, soul sand and honey", ticks, true, `learned: ${learned.join(", ") || "nothing"}; support kinds felt: ${kinds.join(", ")}`);
  },
};

const wanted = process.argv.slice(2);
const rows: Row[] = [];
try {
  for (const [name, run] of Object.entries(scenes)) {
    if (wanted.length && !wanted.includes(name)) continue;
    console.log(`=== ${name}`);
    const result = await run().catch((error: unknown): Row => ({ scene: name, outcome: `ERROR: ${error instanceof Error ? error.message : error}`, refusals: [], learned: [], worstCheckMs: 0, ok: false }));
    rows.push(result);
    console.log(`    ${result.ok ? "ok" : "NOT ok"}: ${result.outcome}`);
  }
} finally {
  for (const command of ["kill @e[type=!player,x=60,y=151,z=40,distance=..40]", "fill 40 140 20 80 160 45 air", "fill 40 149 36 80 150 44 stone", "fill 39 151 35 81 152 35 glass", "fill 39 151 45 81 152 45 glass", "gamerule spawn_mobs true", "forceload remove 39 35 81 45", `tp ${BORN} -8 69 14`, `tp ${BLANK} -8 69 14`]) rcon(command);
}

const table = [["scene", "outcome", "refusals", "learned", "ok"], ...rows.map((r) => [r.scene, r.outcome.split(";")[0]!, r.refusals.join(" / "), r.learned.join(", "), r.ok ? "yes" : "NO"])];
const widths = table[0]!.map((_, c) => Math.max(...table.map((r) => r[c]!.length)));
console.log("");
for (const [i, r] of table.entries()) {
  console.log(r.map((cell, c) => cell.padEnd(widths[c]!)).join(" | "));
  if (i === 0) console.log(widths.map((w) => "-".repeat(w)).join("-|-"));
}
console.log(`\nSlowest posture check in any scene: ${Math.max(0, ...rows.map((r) => r.worstCheckMs)).toFixed(3)} ms (it should stay under 2).`);
const failed = rows.filter((r) => !r.ok);
console.log(failed.length ? `FAIL: ${failed.map((r) => r.scene).join(", ")}` : `PASS: all ${rows.length} scenes.`);
process.exit(failed.length ? 1 : 0);
