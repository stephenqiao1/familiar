// Live check of the defence circuit on the test server: which defence the bot picks for a threat
// that has not noticed it, one coming over open ground, one that has it cornered, one that cannot
// reach it and one that shoots; what it learns; and how it recovers. No Jev and no planner calls:
// the scenes say what to do, and only the reflexes defend.
// Needs the server container (MC_CONTAINER, default familiar-m6).
//   pnpm defence-check [scene ...]
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { buildPlaza, rcon, sleep } from "./primitive-check/world.ts";

const GUARD = "Guard";
/** A bot born knowing no threats at all (bots.json). */
const BLANK = "Blank";
const REGIONS = "reflex,medulla,brainstem,colliculus,acetylcholine,dopamine,noradrenaline,hippocampus,amygdala,serotonin,prefrontal";
/** The middle of the lane, facing east along it. */
const MIDDLE = "60.5 151 40.5 -90 0";

interface Threat {
  id: string;
  kind: string;
  dist: number;
  stage: string;
  noticed: boolean;
  noticedBy: string | null;
  canReach: boolean;
  escapable: boolean;
  danger: number;
  beatable: boolean;
  shoots: boolean;
  flightDistance: number;
}
interface Defence {
  mode: string;
  why: string;
  target: string | null;
  threat: number;
  flightDistance: number | null;
  cornered: boolean;
  threats: Threat[];
  analgesia: number;
  recovering: boolean;
  learned?: string[];
  costMs?: number;
  worstMs?: number;
}
interface Tick {
  tick: number;
  timestamp: number;
  state: { data: { self: { position: { x: number; y: number; z: number }; health: number; deaths: number }; nearby: { mobs: { id: string; type: string; dist: number; reachable: boolean }[] } } };
  winner: { region: string; action: { skill?: string } } | null;
  regions: { region: string; trace?: { defence?: Defence; rules?: { rule: string; skill: string | null; gain: number; urgency: number }[]; vitals?: { pain: number } } }[];
  signals: Record<string, { value: number }>;
  skillEvents?: { skill: string; type: string; timestamp: number; reason?: string; changes?: Record<string, unknown> }[];
}

interface Options {
  bot?: string;
  start?: string;
  give?: string[];
  /** What the bot already knows about threats (written to its threats.json before it joins). */
  /** Extra flags for the bot. */
  flags?: string[];
  knows?: Record<string, Partial<{ seen: number; hurts: number; damage: number; kills: number; deaths: number; badLosses: number; rangedHurts: number; danger: number }>>;
}

/** Runs the real bot; `act` scripts the scene while it runs. Returns its ticks and everything it printed. */
async function play(act: (say: (command: string) => void) => Promise<void>, options: Options = {}): Promise<{ ticks: Tick[]; output: string; learned: Record<string, Record<string, number>> }> {
  const bot = options.bot ?? GUARD;
  rmSync(`data/${bot}`, { recursive: true, force: true });
  if (options.knows) {
    mkdirSync(`data/${bot}`, { recursive: true });
    const blank = { seen: 0, hurts: 0, damage: 0, kills: 0, deaths: 0, badLosses: 0, rangedHurts: 0, danger: 0.5 };
    writeFileSync(`data/${bot}/threats.json`, JSON.stringify(Object.fromEntries(Object.entries(options.knows).map(([kind, k]) => [kind, { ...blank, ...k }]))));
  }
  const child = spawn("node", ["--env-file-if-exists=.env", "apps/run-bot/dist/index.js", "--engine", "echo", "--planner", "echo", "--regions", REGIONS, ...(options.flags ?? []), "--manual", "--name", bot], { stdio: ["pipe", "pipe", "pipe"] });
  let output = "";
  let exited = false;
  child.stdout.on("data", (d: Buffer) => (output += d));
  child.stderr.on("data", (d: Buffer) => (output += d));
  child.once("exit", () => (exited = true));
  const joined = Date.now();
  while (!output.includes("Logging to") && !exited && Date.now() - joined < 30_000) await sleep(200);
  if (exited) throw new Error(`The bot stopped before it started playing:\n${output.slice(-500)}`);
  for (const command of [`gamemode survival ${bot}`, `clear ${bot}`, `effect clear ${bot}`, `effect give ${bot} instant_health 1 10 true`, `effect give ${bot} saturation 1 10 true`, ...(options.give ?? []).map((item) => `give ${bot} ${item}`), `tp ${bot} ${options.start ?? MIDDLE}`]) rcon(command);
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
  let learned: Record<string, Record<string, number>> = {};
  try {
    learned = JSON.parse(readFileSync(`data/${bot}/threats.json`, "utf8")) as typeof learned;
  } catch {
    // Nothing saved.
  }
  return { ticks: readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as Tick), output, learned };
}

/** The lane: a stone floor in the sky, 41 long and 9 wide, walled with glass, at noon. */
async function freshLane(): Promise<void> {
  buildPlaza();
  for (const command of ["kill @e[type=!player,x=60,y=151,z=40,distance=..60]", "fill 40 151 36 80 160 44 air", "fill 40 146 36 80 148 44 air", "fill 40 149 36 80 150 44 stone", "fill 39 151 35 81 152 35 glass", "fill 39 151 45 81 152 45 glass", "time set noon", "weather clear", "difficulty easy"]) rcon(command);
  await sleep(500);
}

const traceOf = (t: Tick, region: string) => t.regions.find((r) => r.region === region)?.trace ?? {};
const defenceOf = (t: Tick) => traceOf(t, "brainstem").defence;
const modeOf = (t: Tick) => defenceOf(t)?.mode ?? "none";
const topOf = (t: Tick) => defenceOf(t)?.threats.find((x) => x.id === defenceOf(t)?.target);
const fired = (t: Tick, rule: string) => traceOf(t, "reflex").rules?.find((r) => r.rule === rule);
const started = (ticks: Tick[], skill: string) => ticks.flatMap((t) => (t.skillEvents ?? []).filter((e) => e.skill === skill && e.type === "started"));
/** The modes in order, with how many ticks each lasted: "wary×4 → flee×9". */
function timeline(ticks: Tick[]): string {
  const runs: { mode: string; n: number }[] = [];
  for (const t of ticks) {
    const mode = modeOf(t);
    if (runs.at(-1)?.mode === mode) runs.at(-1)!.n++;
    else runs.push({ mode, n: 1 });
  }
  return runs.filter((r) => r.mode !== "none" || r.n > 3).map((r) => `${r.mode}×${r.n}`).join(" → ");
}
const worstCost = (ticks: Tick[]) => Math.max(0, ...ticks.map((t) => defenceOf(t)?.worstMs ?? 0));
const learnedIn = (ticks: Tick[]) => ticks.flatMap((t) => defenceOf(t)?.learned ?? []);
const max = (ticks: Tick[], signal: string) => Math.max(0, ...ticks.map((t) => t.signals[signal]?.value ?? 0));

interface Row {
  scene: string;
  outcome: string;
  modes: string;
  costMs: number;
  ok: boolean;
}
const row = (scene: string, ticks: Tick[], ok: boolean, outcome: string): Row => ({ scene, outcome, modes: timeline(ticks), costMs: worstCost(ticks), ok });

/** How far off the plain husk was when the bot fled it, for the scene that compares. */
let plainFlight: number | null = null;

const scenes: Record<string, () => Promise<Row>> = {
  /** 1. A hostile 10 blocks off, facing away, that never notices: the bot freezes and watches it. */
  async unnoticed() {
    await freshLane();
    const { ticks } = await play(async () => {
      await sleep(2000);
      rcon("summon husk 70.5 151 40.5 {IsBaby:0b,NoAI:1b,Rotation:[-90f,0f]}");
      await sleep(9000);
    });
    const frozen = ticks.filter((t) => modeOf(t) === "freeze");
    const noticed = ticks.filter((t) => defenceOf(t)?.threats.some((x) => x.noticed));
    const froze = started(ticks, "freeze");
    const top = frozen[0] && topOf(frozen[0]);
    const ok = frozen.length >= 5 && froze.length >= 1 && noticed.length === 0 && started(ticks, "flee").length === 0;
    return row("unnoticed: a husk 10 blocks off, facing away", ticks, ok, `froze on ${frozen.length} ticks (freeze skill started ${froze.length} time(s)); the husk was sized up as ${top ? `${top.stage}, noticed ${top.noticed}, flight distance ${top.flightDistance}` : "nothing"}; ticks on which it had noticed: ${noticed.length}`);
  },

  /** 1b. The same husk beside the bot's route: the journey bends round it. */
  async around() {
    await freshLane();
    const husk = { x: 60.5, z: 43.5 };
    const { ticks, output } = await play(
      async (say) => {
        rcon(`summon husk ${husk.x} 151 ${husk.z} {IsBaby:0b,NoAI:1b,Rotation:[0f,0f]}`);
        await sleep(1500);
        say("do go_to pos:78,151,40");
        await sleep(12_000);
      },
      // --same-time: a look at the husk runs beside the journey instead of replacing it (nothing proposes a journey started by hand).
      { start: "42.5 151 40.5 -90 0", knows: { husk: { danger: 0.2 } }, flags: ["--same-time"] },
    );
    const avoiding = ticks.filter((t) => modeOf(t) === "avoid");
    const closest = Math.min(...ticks.map((t) => Math.hypot(t.state.data.self.position.x + 0.5 - husk.x, t.state.data.self.position.z + 0.5 - husk.z)));
    const arrived = ticks.some((t) => t.state.data.self.position.x >= 76);
    const flight = avoiding[0] ? (topOf(avoiding[0])?.flightDistance ?? 0) : 0;
    const replanned = output.includes("routing round");
    // A straight walk along z=40 would pass 3.5 blocks from it.
    const ok = avoiding.length >= 3 && arrived && closest >= 4.4 && started(ticks, "freeze").length === 0;
    return row("around: the husk beside a journey's route", ticks, ok, `avoid on ${avoiding.length} ticks; came no closer than ${closest.toFixed(1)} blocks (a straight walk passes at 3.5; flight distance ${flight}); route planned again: ${replanned}; arrived: ${arrived}`);
  },

  /** 2. Noticed, open ground: it flees, starting at the flight distance. */
  async open() {
    await freshLane();
    const { ticks } = await play(async () => {
      await sleep(1500);
      rcon("summon husk 79.5 151 40.5 {IsBaby:0b}");
      await sleep(11_000);
    });
    const first = ticks.find((t) => modeOf(t) === "flee");
    const top = first && topOf(first);
    const rule = first && fired(first, "defence_flee");
    plainFlight = top?.dist ?? null;
    const before = first ? ticks.filter((t) => t.timestamp < first.timestamp && defenceOf(t)?.threats.length).map(modeOf) : [];
    const ok = top !== undefined && top.dist <= top.flightDistance && top.dist >= top.flightDistance - 3 && started(ticks, "flee").length >= 1;
    return row("open: a husk walks up over open ground", ticks, ok, `${top ? `fled when it was ${top.dist} blocks off (flight distance ${top.flightDistance}, noticed by ${top.noticedBy}); first-tick gain ${rule?.gain.toFixed(2) ?? "?"}, urgency ${rule?.urgency.toFixed(2) ?? "?"}` : "NEVER FLED"}; before that: ${[...new Set(before)].join(", ") || "nothing"}; alarm reached ${max(ticks, "alarm").toFixed(2)}`);
  },

  /** 3. The same husk with what the bot has learned: a kind that has hurt it badly sets it off from further away. */
  async dangerous() {
    await freshLane();
    const { ticks } = await play(
      async () => {
        await sleep(1500);
        rcon("summon husk 79.5 151 40.5 {IsBaby:0b}");
        await sleep(9000);
      },
      { knows: { husk: { seen: 5, hurts: 6, damage: 40, deaths: 2, danger: 0.9 } } },
    );
    const first = ticks.find((t) => modeOf(t) === "flee");
    const top = first && topOf(first);
    const ok = top !== undefined && top.flightDistance > 10 && top.dist > (plainFlight ?? 8);
    return row("dangerous: a kind that has killed it before", ticks, ok, `${top ? `fled when it was ${top.dist} blocks off (danger ${top.danger}, flight distance ${top.flightDistance})` : "NEVER FLED"}${plainFlight !== null ? `, against ${plainFlight} for a kind it knows nothing of` : ""}`);
  },

  /** 4. Cornered in a closed room, unarmed: it fights. */
  async cornered() {
    await freshLane();
    // A 5×5 room with stone walls three high and a glass roof; the husk is put inside with the bot.
    for (const command of ["fill 57 151 37 63 153 43 stone", "fill 58 151 38 62 153 42 air", "fill 57 154 37 63 154 43 glass"]) rcon(command);
    const { ticks } = await play(
      async () => {
        await sleep(1500);
        rcon("summon husk 61.5 151 41.5 {IsBaby:0b}");
        await sleep(12_000);
        rcon("kill @e[type=husk]");
      },
      { start: "58.5 151 38.5 -45 0" },
    );
    const cornered = ticks.filter((t) => defenceOf(t)?.cornered);
    const fights = ticks.filter((t) => modeOf(t) === "fight");
    const fled = ticks.filter((t) => modeOf(t) === "flee");
    const firstCornered = cornered[0];
    const firstThreat = ticks.find((t) => defenceOf(t)?.threats.length);
    const tookMs = firstCornered && firstThreat ? firstCornered.timestamp - firstThreat.timestamp : null;
    const ok = cornered.length > 0 && fights.length > 0 && started(ticks, "attack").length >= 1;
    return row("cornered: shut in a room with a husk, unarmed", ticks, ok, `cornered on ${cornered.length} ticks (the route check said so ${tookMs ?? "?"} ms after the husk appeared); fought on ${fights.length} ticks (attack started ${started(ticks, "attack").length} time(s)), fled on ${fled.length}; health at the end ${ticks.at(-1)!.state.data.self.health}, deaths ${ticks.at(-1)!.state.data.self.deaths}`);
  },

  /** 5. Armed and healthy with a husk suddenly on it: it fights, and the kill is learned. */
  async armed() {
    await freshLane();
    const { ticks, learned } = await play(
      async () => {
        await sleep(1500);
        rcon("summon husk 62.5 151 40.5 {IsBaby:0b}");
        await sleep(12_000);
      },
      { give: ["iron_sword"] },
    );
    const fights = ticks.filter((t) => modeOf(t) === "fight");
    const kills = learned.husk?.kills ?? 0;
    const ok = fights.length > 0 && started(ticks, "attack").length >= 1 && kills >= 1;
    return row("armed: a husk 2 blocks off, sword in hand", ticks, ok, `fought on ${fights.length} ticks; kills recorded for husk: ${kills} (danger now ${learned.husk?.danger?.toFixed(2) ?? "?"}); analgesia up to ${max(ticks, "analgesia").toFixed(2)}; health at the end ${ticks.at(-1)!.state.data.self.health}`);
  },

  /** 6. A husk in a pit 5 blocks away: in plain view, but it cannot get out. No defence, and alarm does not hold. */
  async pit() {
    await freshLane();
    for (const command of ["fill 64 149 39 66 150 41 air", "fill 64 148 39 66 148 41 stone", "fill 63 148 38 67 148 42 stone"]) rcon(command);
    const { ticks } = await play(async () => {
      await sleep(1500);
      rcon("summon husk 65.5 149 40.5 {IsBaby:0b}");
      await sleep(14_000);
    });
    const sized = ticks.filter((t) => defenceOf(t)?.threats.length);
    const answered = sized.find((t) => defenceOf(t)!.threats[0]!.canReach === false);
    const cheap = sized[0]?.state.data.nearby.mobs.find((m) => m.type === "husk")?.reachable;
    const after = answered ? ticks.filter((t) => t.timestamp > answered.timestamp + 1000) : [];
    const acted = after.filter((t) => ["flee", "fight", "freeze"].includes(modeOf(t)));
    const alarmEnd = ticks.at(-1)!.signals.alarm?.value ?? 0;
    const ok = answered !== undefined && acted.length === 0 && alarmEnd < 0.3;
    return row("pit: a husk 5 blocks off that cannot climb out", ticks, ok, `the cheap guess said it could reach the bot: ${cheap}; the route check said no after ${answered && sized[0] ? answered.timestamp - sized[0].timestamp : "?"} ms; defences after that: ${acted.length}; alarm at the end ${alarmEnd.toFixed(2)} (peak ${max(ticks, "alarm").toFixed(2)})`);
  },

  /** 6b. The same pit, a second husk: what was found for that spot is remembered, so it is known harmless at first sight. */
  async pit_again() {
    await freshLane();
    for (const command of ["fill 64 149 39 66 150 41 air", "fill 64 148 39 66 148 41 stone", "fill 63 148 38 67 148 42 stone"]) rcon(command);
    let second = 0;
    const { ticks } = await play(async () => {
      await sleep(1500);
      rcon("summon husk 65.5 149 40.5 {IsBaby:0b}");
      await sleep(8000);
      rcon("kill @e[type=husk]");
      await sleep(3000);
      second = Date.now();
      rcon("summon husk 65.5 149 40.5 {IsBaby:0b}");
      await sleep(8000);
    });
    const later = ticks.filter((t) => t.timestamp > second && defenceOf(t)?.threats.length);
    const guessed = later.filter((t) => defenceOf(t)!.threats[0]!.canReach);
    const acted = later.filter((t) => ["flee", "fight", "freeze"].includes(modeOf(t)));
    const peak = Math.max(0, ...ticks.filter((t) => t.timestamp > second).map((t) => t.signals.alarm?.value ?? 0));
    const ok = later.length > 0 && guessed.length === 0 && acted.length === 0 && peak < 0.3;
    return row("pit_again: a second husk in the same pit", ticks, ok, `the second husk was sized up on ${later.length} ticks; thought able to reach on ${guessed.length} of them (the cheap guess said ${later[0]?.state.data.nearby.mobs.find((m) => m.type === "husk")?.reachable}); defences: ${acted.length}; alarm after it appeared at most ${peak.toFixed(2)}`);
  },

  /** 7. A skeleton sat in a boat on a pillar: it cannot come down to the bot, but it shoots. Two hits, and the bot knows that. */
  async shooter() {
    await freshLane();
    rcon("fill 67 151 40 67 156 40 stone");
    const { ticks, learned } = await play(async () => {
      await sleep(1500);
      rcon('summon oak_boat 67.5 157 40.5 {Passengers:[{id:"minecraft:skeleton",equipment:{head:{id:"minecraft:leather_helmet",count:1},mainhand:{id:"minecraft:bow",count:1}}}]}');
      // Keep it alive, and put it back where it is shot at, until it has been hit a few times.
      for (let i = 0; i < 9; i++) {
        await sleep(2500);
        rcon(`effect give ${GUARD} instant_health 1 1 true`);
        if (i % 3 === 2) rcon(`tp ${GUARD} ${MIDDLE}`);
      }
    });
    const notes = learnedIn(ticks);
    const found = notes.find((n) => n.includes("found to shoot"));
    const knewAt = ticks.find((t) => defenceOf(t)?.learned?.some((n) => n.includes("found to shoot")));
    const before = knewAt ? ticks.filter((t) => t.timestamp < knewAt.timestamp).flatMap((t) => defenceOf(t)?.threats.filter((x) => x.kind === "skeleton") ?? []) : [];
    const after = knewAt ? ticks.filter((t) => t.timestamp > knewAt.timestamp).flatMap((t) => defenceOf(t)?.threats.filter((x) => x.kind === "skeleton") ?? []) : [];
    const ok = found !== undefined && after.some((x) => x.shoots && x.canReach) && (learned.skeleton?.rangedHurts ?? 0) >= 2;
    return row("shooter: a skeleton held on a pillar, shooting", ticks, ok, `${found ?? "NEVER LEARNED it shoots"}; before: could reach on ${before.filter((x) => x.canReach).length} of ${before.length} ticks; after: on ${after.filter((x) => x.canReach).length} of ${after.length}; hurts from afar recorded: ${learned.skeleton?.rangedHurts ?? 0}; fled ${started(ticks, "flee").length} time(s)`);
  },

  /** 8. A bot born knowing no threats: nothing is a threat until it hurts. */
  async blank() {
    await freshLane();
    const { ticks, learned } = await play(
      async () => {
        await sleep(1500);
        rcon("summon husk 66.5 151 40.5 {IsBaby:0b}");
        await sleep(12_000);
      },
      { bot: BLANK },
    );
    const firstThreat = ticks.find((t) => defenceOf(t)?.threats.length);
    const firstHurt = ticks.find((t, i) => i > 0 && t.state.data.self.health < ticks[i - 1]!.state.data.self.health);
    const before = firstHurt ? ticks.filter((t) => t.timestamp < firstHurt.timestamp) : ticks;
    const defendedBefore = before.filter((t) => ["flee", "fight", "freeze"].includes(modeOf(t))).length;
    const notes = learnedIn(ticks);
    const ok = firstHurt !== undefined && defendedBefore === 0 && firstThreat !== undefined && firstThreat.timestamp >= firstHurt.timestamp && notes.some((n) => n.includes("husk became a threat"));
    return row("blank: a bot born knowing no threats meets a husk", ticks, ok, `defences before it was first hurt: ${defendedBefore} (the husk walked up from 6 blocks); ${notes.join("; ") || "LEARNED NOTHING"}; first sized up ${firstThreat && firstHurt ? firstThreat.timestamp - firstHurt.timestamp : "?"} ms after the first hit; husk in threats.json: ${learned.husk ? `hurts ${learned.husk.hurts}, danger ${learned.husk.danger?.toFixed(2)}` : "no"}; health at the end ${ticks.at(-1)!.state.data.self.health}`);
  },

  /** 9. Hurt while fleeing: the pain is dulled; then, with the threat gone, it rests until it has mended. */
  async recover() {
    await freshLane();
    let hurtAt = 0;
    let clearAt = 0;
    let healedAt = 0;
    const { ticks } = await play(async () => {
      await sleep(1500);
      rcon("summon husk 68.5 151 40.5 {IsBaby:0b}");
      await sleep(5000);
      hurtAt = Date.now();
      rcon(`damage ${GUARD} 15 minecraft:generic`);
      await sleep(700);
      clearAt = Date.now();
      rcon("kill @e[type=husk]");
      // Left alone, it mends by itself (it is well fed); this is only a backstop.
      await sleep(14_000);
      healedAt = Date.now();
      rcon(`effect give ${GUARD} instant_health 1 2 true`);
      await sleep(3000);
    });
    const struck = ticks.find((t) => t.timestamp >= hurtAt && (traceOf(t, "medulla").vitals?.pain ?? 0) > 0.3);
    const felt = struck?.signals.pain?.value ?? 0;
    const real = struck ? (traceOf(struck, "medulla").vitals?.pain ?? 0) : 0;
    const resting = ticks.filter((t) => t.timestamp >= clearAt && (t.signals.recovering?.value ?? 0) > 0);
    const rested = started(ticks, "recuperate");
    const afterHeal = ticks.filter((t) => t.timestamp >= healedAt + 1500);
    const stillResting = afterHeal.filter((t) => (t.signals.recovering?.value ?? 0) > 0).length;
    const fadeTick = ticks.find((t) => t.timestamp >= clearAt + 10_000);
    const ok = struck !== undefined && felt < real * 0.8 && resting.length >= 3 && rested.length >= 1 && stillResting === 0;
    return row("recover: hurt in flight, then left alone", ticks, ok, `analgesia ${struck?.signals.analgesia?.value.toFixed(2) ?? "?"} when struck: pain felt ${felt.toFixed(2)} of ${real.toFixed(2)}; analgesia 10 s after the husk was gone: ${fadeTick?.signals.analgesia?.value.toFixed(2) ?? "?"}; recovering on ${resting.length} ticks, recuperate started ${rested.length} time(s) (${JSON.stringify(ticks.flatMap((t) => (t.skillEvents ?? []).filter((e) => e.skill === "recuperate" && e.type !== "started").map((e) => e.changes ?? e.type)).at(-1) ?? "still running")}); still recovering after healing: ${stillResting} ticks`);
  },
};

const wanted = process.argv.slice(2);
const rows: Row[] = [];
try {
  for (const [name, run] of Object.entries(scenes)) {
    if (wanted.length && !wanted.includes(name)) continue;
    console.log(`=== ${name}`);
    const result = await run().catch((error: unknown): Row => ({ scene: name, outcome: `ERROR: ${error instanceof Error ? error.message : error}`, modes: "", costMs: 0, ok: false }));
    rows.push(result);
    console.log(`    ${result.ok ? "ok" : "NOT ok"}: ${result.outcome}`);
    console.log(`    modes: ${result.modes || "none"}; sizing up cost at worst ${result.costMs} ms`);
  }
} finally {
  // Leave the lane as the other live checks expect it.
  for (const command of ["kill @e[type=!player,x=60,y=151,z=40,distance=..60]", "fill 40 151 36 80 160 44 air", "fill 40 146 36 80 148 44 air", "fill 40 149 36 80 150 44 stone", "fill 39 151 35 81 152 35 glass", "fill 39 151 45 81 152 45 glass", "time set noon"]) rcon(command);
}

const table = [["scene", "modes", "worst cost", "ok"], ...rows.map((r) => [r.scene, r.modes, `${r.costMs} ms`, r.ok ? "yes" : "NO"])];
const widths = table[0]!.map((_, c) => Math.max(...table.map((r) => r[c]!.length)));
console.log("");
for (const [i, r] of table.entries()) {
  console.log(r.map((cell, c) => cell.padEnd(widths[c]!)).join(" | "));
  if (i === 0) console.log(widths.map((w) => "-".repeat(w)).join("-|-"));
}
const failed = rows.filter((r) => !r.ok);
console.log(failed.length ? `\nFAIL: ${failed.map((r) => r.scene).join(", ")}` : `\nPASS: all ${rows.length} scenes.`);
process.exit(failed.length ? 1 : 0);
