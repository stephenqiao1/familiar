// Live check of the cortex on the test server: the motor area carrying out a plan, a stuck step
// waking the planner, a goal to stay still under water, and the forced retreat goal standing
// through a re-plan. Every scene runs several times; the table gives each scene over all its runs.
// The planner is the echo planner with a fixed plan (or a list: it moves to the next when a stuck
// step wakes it), so only Jev is a model here. `claude` runs the stuck scene once with the Claude planner.
// `notes` and `nonotes` are the planner's notes, with the Claude planner (run only when named).
// `skill` is chunks: a routine done three times becomes one skill (`skilljev`: the same with Jev choosing).
// `cost` is an hour of ordinary play before and after (`--minutes` to change the hour).
// `surprise` is the sensory area: something added to and removed from a place the bot knows.
//   pnpm cortex-check [--runs 5] [scene ...]
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { playerNumber, rcon, sleep } from "./primitive-check/world.ts";
import { after, BOT, freshPlaza, play, type Tick } from "./live.ts";
import { finishedSteps, surpriseReport, type CortexTick } from "./cortex-report.ts";

interface Run {
  ticks: Tick[];
  ok: boolean;
  note: string;
}
interface Row {
  scene: string;
  areas: string;
  outcome: string;
  problem: string;
}

const flag = (name: string, otherwise: number) => {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? Number(process.argv[at + 1]) : otherwise;
};
const RUNS = flag("runs", 5);
const wanted = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && !all[i - 1]?.startsWith("--"));
const STILL = { colliculus: { scanning: 0 } };
const Y = 151;
const spot = (x: number) => `pos:${x},${Y},40`;
const walkTo = (x: number, text: string) => ({ text, skill: "go_to", target: spot(x), doneWhen: `within 3 of ${spot(x)}` });

const trace = (t: Tick, region: string) => (t.regions.find((r) => r.region === region)?.trace ?? {}) as Record<string, any>;
const goalOf = (t: Tick) => t.goal as { text: string; setBy: string; stepsDone: number; protected?: boolean } | null | undefined;
const count = (keys: string[]) => [...keys.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ×${n}`).join(", ") || "none";
const sec = (ms: number) => (ms / 1000).toFixed(1);

/** What each area did over a scene's runs, in a line. */
function areas(ticks: Tick[]): string {
  const motor = ticks.map((t) => trace(t, "motor"));
  const proposed = ticks.flatMap((t) => (t.regions.find((r) => r.region === "motor") as unknown as { proposals?: { action: { skill?: string } }[] } | undefined)?.proposals ?? []).map((p) => p.action.skill ?? "?");
  const won = ticks.filter((t) => t.winner?.region === "motor").length;
  const plans = ticks.flatMap((t) => t.regions.filter((r) => r.region === "prefrontal" && r.trace?.plan).map((r) => r.trace as Record<string, any>));
  const asked = ticks.filter((t) => trace(t, "instinct").questions !== undefined);
  const focused = asked.filter((t) => JSON.stringify(trace(t, "instinct").questions).includes("The step to do now")).length;
  return [
    `motor: proposed ${count(proposed)} (won ${won} ticks), finished ${motor.filter((m) => m.advanced).length} steps, reported stuck ${motor.filter((m) => m.stuck).length}×`,
    `prefrontal: ${plans.length} plans, ${plans.filter((p) => p.woken).length} woken at once, ${plans.filter((p) => p.goalKept).length} kept out by the goal channel`,
    `instinct: asked ${asked.length}×, ${focused} with a step as its focus`,
    `sensory: ${surpriseReport(ticks as unknown as CortexTick[]).found.length} surprises`,
  ].join("; ");
}

function row(scene: string, runs: Run[]): Row {
  const failed = runs.filter((r) => !r.ok);
  return { scene, areas: areas(runs.flatMap((r) => r.ticks)), outcome: `${runs.length - failed.length} of ${runs.length} runs as expected. ${runs.map((r) => r.note).join(" || ")}`, problem: failed.length ? `${failed.length} of ${runs.length} runs: ${failed[0]!.note}` : "" };
}

async function times(run: () => Promise<Run>, runs = RUNS): Promise<Run[]> {
  const out: Run[] = [];
  for (let i = 0; i < runs; i++) {
    try {
      out.push(await run());
    } catch (error) {
      // A run that never started (no log) is tried once more.
      console.log(`    run ${i + 1} broke (${error instanceof Error ? error.message : error}); trying it again`);
      out.push(await run());
    }
  }
  return out;
}

/** Waits until the bot stands within about 3 blocks of this x (or the seconds run out). */
const untilNear = async (x: number, seconds: number) => {
  for (let waited = 0; waited < seconds * 2; waited++) {
    const at = Number(/(-?\d+(\.\d+)?)d?/.exec(rcon(`data get entity ${BOT} Pos[0]`).split(":").pop() ?? "")?.[1]);
    if (Math.abs(at - x) <= 3.2) return true;
    await sleep(500);
  }
  return false;
};

const scenes: Record<string, () => Promise<Row>> = {
  /** 1. A plan carried out: three steps with conditions. Two are finished by the bot's own walking, the third by the world (night falls). */
  async plan() {
    const plan = { goal: "Walk to the far end of the plaza, then to the near end, then wait there for night.", steps: [walkTo(72, "walk to the far end"), walkTo(50, "walk to the near end"), { text: "wait for night", skill: "idle", doneWhen: "time is night" }] };
    const runs = await times(async () => {
      await freshPlaza();
      const ticks = await play(
        async () => {
          await untilNear(72, 50);
          await untilNear(50, 40);
          await sleep(4000);
          rcon("time set 14000");
          await sleep(5000);
        },
        { whole: true, plan, settings: STILL },
      );
      rcon("time set 1000");
      const finished = finishedSteps(ticks as unknown as CortexTick[]);
      const done = goalOf(ticks.at(-1)!)?.stepsDone ?? 0;
      const gaps = finished.map((f) => `step ${f.step + 1} ${f.ticksLate} ticks (${f.msLate} ms)`).join(", ");
      const byPlanner = ticks.flatMap((t) => t.regions.filter((r) => r.region === "prefrontal" && r.trace?.stepFinished)).length;
      return { ticks, ok: done === 3 && finished.length === 3 && finished.every((f) => f.ticksLate === 0) && byPlanner === 0, note: `${done} of 3 steps done; from the condition first holding to the step finishing: ${gaps || "nothing finished"}; the planner's word finished ${byPlanner}` };
    });
    return row("1 plan (three steps with conditions, Jev on)", runs);
  },

  /** 2. Stuck: a step that cannot be done (a spot in mid-air). The planner is woken with the reason and changes the plan. */
  async stuck() {
    return row("2 stuck (a spot it cannot get to; the echo planner's second plan)", await times(stuckRun));
  },

  /** The Claude planner, once: two minutes of its own plans, to see that it writes steps the motor area can carry out. */
  async claude() {
    const runs = await times(async () => {
      await freshPlaza();
      rcon(`summon cow 66.5 ${Y} 40.5 {NoAI:1b}`);
      const ticks = await play(
        async () => {
          rcon(`give ${BOT} bread 3`);
          await sleep(120_000);
        },
        { whole: true, settings: STILL, flags: ["--planner", "claude"] },
      );
      const plans = ticks.flatMap((t) => t.regions.filter((r) => r.region === "prefrontal" && r.trace?.plan).map((r) => r.trace!.plan as { goal: string; priority?: number; steps: (string | { text: string; skill?: string; doneWhen?: string })[] }));
      const errors = ticks.flatMap((t) => t.regions.filter((r) => r.region === "prefrontal" && (r as { error?: string }).error).map((r) => (r as { error?: string }).error!));
      const steps = plans.flatMap((p) => p.steps).map((s) => (typeof s === "string" ? { text: s } : s));
      const unread = ticks.flatMap((t) => Object.values((trace(t, "motor").unread ?? {}) as Record<string, string>));
      const finished = finishedSteps(ticks as unknown as CortexTick[]);
      const sample = plans.at(-1);
      return {
        ticks,
        ok: plans.length > 0 && errors.length === 0,
        note: `${plans.length} plans (${errors.length} failed${errors.length ? `: ${errors[0]!.slice(0, 120)}` : ""}); ${steps.length} steps, ${steps.filter((s) => s.skill).length} naming a skill, ${steps.filter((s) => s.doneWhen).length} with a done-when; not understood: ${count([...new Set(unread)])}; steps finished by their condition: ${finished.length}; the last plan: ${JSON.stringify(sample).slice(0, 600)}`,
      };
    }, 1);
    return row("the Claude planner (one run of its own plans)", runs);
  },

  /** 3. Stay still: a goal (at the highest priority) to hold position at the bottom of a pool. It surfaces anyway. */
  async staystill() {
    const plan = { goal: "Stay still at the bottom of the pool. Do not move or do anything else.", priority: 1, steps: [{ text: "stay still", skill: "idle", doneWhen: "time is night" }] };
    const runs = await times(async () => {
      await freshPlaza();
      for (const command of ["fill 68 151 38 72 159 42 glass hollow", "fill 69 152 39 71 156 41 water", "gamerule random_tick_speed 0"]) rcon(command);
      let at = 0;
      const ticks = await play(
        async () => {
          await sleep(16_000); // the fixed plan arrives with the planner's first run
          rcon(`tp ${BOT} 70.5 152 40.5`);
          at = Date.now();
          await sleep(40_000);
        },
        { whole: true, plan, settings: STILL },
      );
      rcon("gamerule random_tick_speed 3");
      const self = (t: Tick) => t.state.data.self as Tick["state"]["data"]["self"] & { air: number; inWater: boolean };
      const under = after(ticks, at).filter((t) => self(t).inWater);
      const firstUp = under.find((t) => t.winner?.action.skill === "surface");
      const idle = under.filter((t) => t.regions.some((r) => r.region === "motor" && JSON.stringify((r as unknown as { proposals?: unknown }).proposals ?? []).includes('"idle"'))).length;
      const lived = ticks.every((t) => t.state.data.self.deaths === 0);
      const lowest = Math.min(...under.map((t) => self(t).air));
      return { ticks: after(ticks, at), ok: firstUp !== undefined && lived, note: `under water ${under.length} ticks, the motor area proposing idle on ${idle}; first surfaced at air ${firstUp ? self(firstUp).air : "?"} by ${firstUp ? `${firstUp.winner!.region} at ${firstUp.winner!.urgency.toFixed(2)}` : "nothing"}; lowest air ${lowest}; ${lived ? "lived" : "DIED"}` };
    });
    return row("3 stay still (a top-priority goal to stay at the bottom of a pool, Jev on)", runs);
  },

  /** 5. Surprise: something is added to and removed from a place the bot knows well. No Jev. */
  async surprise() {
    return row("5 surprise (a pig added to, then the chest taken from, a place it knows; no Jev)", await times(surpriseRun));
  },

  /** 6. Notes: the bot tries something that fails, notes it, and does not repeat it in the next plans. The Claude planner and Jev. */
  async notes() {
    return row("6 notes (hungry, the only food a cow it cannot reach; the Claude planner, notes on)", await times(() => notesRun(1)));
  },

  /** 6, without notes: the same scene, to see what the notes change. */
  async nonotes() {
    return row("6 without notes (the same scene, cortex.notes 0)", await times(() => notesRun(0)));
  },

  /** 7. A learned skill: the same routine three times becomes one skill and is then chosen whole. Instinct chooses by fixed rules (no model). */
  async skill() {
    return row("7 a learned skill (take meat from the chest and eat, round after round; instinct by fixed rules)", await times(() => skillRun(false)));
  },

  /** 7 with Jev as instinct: whether Jev's own choices make the same routine often enough. */
  async skilljev() {
    return row("7 with Jev (the same scene, instinct is Jev)", await times(() => skillRun(true)));
  },

  /** 8. Cost: ordinary play before (every cortex strength at 0) and after (all on), with Jev and the Claude planner. `--minutes` for each arm (default 60). */
  async cost() {
    const before = await costArm("before (cortex all 0)", OFF);
    const after = await costArm("after (cortex all on)", undefined);
    return { scene: `8 cost (${MINUTES} minutes of ordinary play at the base, each way; Jev and the Claude planner)`, areas: areas(after.ticks), outcome: `${before.line} || ${after.line}`, problem: "" };
  },

  /** 4. Retreat: a minute of a threat in its face forces the retreat goal. Hurt and with the threat gone, the next plans do not replace it; healed, the next one does. */
  async retreat() {
    const runs = await times(async () => {
      await freshPlaza();
      // A cell with a husk that cannot act and will not die: a threat one block off for as long as it stands there.
      for (const command of ["fill 58 150 39 61 154 41 bedrock hollow", `summon husk 60.5 ${Y} 40.5 {NoAI:1b,Silent:1b,PersistenceRequired:1b,Health:1000f,attributes:[{id:"minecraft:max_health",base:1000}]}`]) rcon(command);
      let gone = 0;
      let healed = 0;
      try {
        const ticks = await play(
          async () => {
            rcon(`effect give ${BOT} resistance 600 255 true`);
            await sleep(80_000);
            // Hurt (and kept so), with the threat gone: alarm falls and the planner is back, but the bot is not safe yet.
            rcon(`attribute ${BOT} minecraft:max_health base set 8`);
            rcon("kill @e[type=husk,distance=..200]");
            gone = Date.now();
            await sleep(50_000);
            rcon(`attribute ${BOT} minecraft:max_health base set 20`);
            rcon(`effect give ${BOT} instant_health 1 10 true`);
            healed = Date.now();
            await sleep(35_000);
          },
          { plan: { goal: "Walk about the plaza." }, start: "59.5 151 40.5 -90 0" },
        );
        const lock = ticks.find((t) => goalOf(t)?.setBy === "noradrenaline");
        const hurt = ticks.filter((t) => t.timestamp >= gone && t.timestamp < healed);
        const keptOut = hurt.flatMap((t) => t.regions.filter((r) => r.region === "prefrontal" && r.trace?.goalKept)).length;
        const offered = hurt.flatMap((t) => t.regions.filter((r) => r.region === "prefrontal" && r.trace?.plan)).length;
        const stood = hurt.length > 0 && hurt.every((t) => goalOf(t)?.setBy === "noradrenaline");
        const replaced = after(ticks, healed).find((t) => goalOf(t)?.setBy === "prefrontal");
        return { ticks, ok: lock !== undefined && offered > 0 && keptOut === offered && stood && replaced !== undefined, note: `retreat goal set ${lock ? `${sec(lock.timestamp - ticks[0]!.timestamp)} s in (protected: ${goalOf(lock)?.protected})` : "never"}; hurt with the threat gone: ${offered} plans offered, ${keptOut} kept out, the retreat stood ${stood ? "throughout" : "NOT throughout"}; healed: replaced ${replaced ? `${sec(replaced.timestamp - healed)} s later` : "never"}` };
      } finally {
        rcon(`attribute ${BOT} minecraft:max_health base set 20`);
      }
    });
    return row("4 retreat (the forced retreat goal and the next plans, no Jev)", runs);
  },
};

/**
 * One run of the surprise scene. The bot gets to know a place with a chest in it (it is moved in
 * and out of the cell sixteen times: each coming in is one look about). Then a pig is put there
 * (a kind never seen here), and later the chest is taken away (a thing that is usually here).
 */
async function surpriseRun(): Promise<Run> {
  await freshPlaza();
  rcon(`setblock 63 ${Y} 40 chest`);
  let [added, removed] = [0, 0];
  const ticks = await play(
    async () => {
      for (let i = 0; i < 16; i++) {
        rcon(`tp ${BOT} 72.5 ${Y} 40.5 90 0`);
        await sleep(700);
        rcon(`tp ${BOT} 60.5 ${Y} 40.5 -90 0`);
        await sleep(700);
      }
      await sleep(7000);
      added = Date.now();
      rcon(`summon pig 62.5 ${Y} 42.5 {NoAI:1b,Silent:1b}`);
      await sleep(9000);
      removed = Date.now();
      rcon(`setblock 63 ${Y} 40 air`);
      await sleep(14_000);
    },
    { also: ["reticular", "colliculus", "thalamus", "sensory"], settings: STILL },
  );
  const part = (from: number, to: number) => ticks.filter((t) => t.timestamp >= from && t.timestamp < to) as unknown as CortexTick[];
  const tell = (name: string, window: CortexTick[]) => {
    const { found } = surpriseReport(window);
    const most = Math.max(0, ...window.map((t) => (t as unknown as Tick).signals.unexpected?.value ?? 0));
    const fresh = window.filter((t) => ((trace(t as unknown as Tick, "thalamus").views ?? {}) as Record<string, { items?: { id: string; by: string[] }[] }>).prefrontal?.items?.some((i) => i.by.includes("fresh"))).length;
    const focus = window.filter((t) => (trace(t as unknown as Tick, "acetylcholine").inputs?.unexpected ?? 0) > 0).length;
    const keptBy = window.filter((t) => JSON.stringify(trace(t as unknown as Tick, "hippocampus")).includes("Was surprised")).length;
    const woken = window.flatMap((t) => t.regions.filter((r) => r.region === "prefrontal" && String(r.trace?.woken ?? "").startsWith("Something is not as expected"))).length;
    return { found, most, woken, keptBy, focus, fresh, text: `${name}: ${found.map((f) => `${f.what} ${f.kind} ${f.size.toFixed(2)} ${sec(f.at - (window[0]?.timestamp ?? f.at))} s in`).join(", ") || "nothing found"}; unexpected up to ${most.toFixed(2)}; thalamus passed something as new on ${fresh} ticks, focus took it in on ${focus}, the hippocampus kept ${keptBy}, the planner woken ${woken}×` };
  };
  const before = surpriseReport(part(0, added)).found;
  const [add, remove] = [tell("pig added", part(added, removed)), tell("chest removed", part(removed, Infinity))];
  const ok = before.length === 0 && add.found.some((f) => f.what === "new" && f.kind === "pig") && add.focus > 0 && add.woken === 0 && remove.found.some((f) => f.what === "missing" && f.kind === "chest") && remove.keptBy > 0 && remove.woken > 0;
  return { ticks, ok, note: `getting to know the place: ${before.length ? before.map((f) => `${f.what} ${f.kind}`).join(", ") : "nothing unexpected"}. ${add.text}. ${remove.text}` };
}

interface Planned {
  at: number;
  goal: string;
  steps: { text: string; skill?: string; target?: string }[];
  notes: Record<string, string[]>;
  given: { key: string; text: string }[];
  woken?: string;
}
/** Every plan of a run, with what it said of the notes. */
const plansOf = (ticks: Tick[]): Planned[] =>
  ticks.flatMap((t) =>
    t.regions
      .filter((r) => r.region === "prefrontal" && r.trace?.plan)
      .map((r) => {
        const plan = r.trace!.plan as { goal: string; steps: (string | Planned["steps"][number])[]; notes?: Planned["given"] };
        return { at: t.timestamp, goal: plan.goal, steps: plan.steps.map((s) => (typeof s === "string" ? { text: s } : s)), notes: (r.trace!.notes ?? {}) as Record<string, string[]>, given: plan.notes ?? [], ...(r.trace!.woken ? { woken: String(r.trace!.woken) } : {}) };
      }),
  );
/**
 * One run of the notes scene, with the Claude planner. The bot is hungry with no food, on a
 * plaza in the sky: the way home has no path, and the only food in sight is a cow shut in a
 * bedrock box. Whatever it sets out to do first fails. With notes the planner can write down
 * what failed; without, each plan starts from nothing. Counted: each thing (a skill at a
 * target) that was reported stuck and told to the planner, whether a note was written in that
 * plan, and whether the bot set out on the very same thing again later.
 */
async function notesRun(notes: number): Promise<Run> {
  await freshPlaza();
  for (const command of ["fill 65 150 38 69 154 42 bedrock hollow", `summon cow 67.5 ${Y} 40.5 {NoAI:1b,Silent:1b,PersistenceRequired:1b}`]) rcon(command);
  const ticks = await play(
    async () => {
      rcon(`effect give ${BOT} hunger 60 255 true`);
      for (let waited = 0; waited < 60 && !(playerNumber("foodLevel") <= 8); waited++) await sleep(1000);
      rcon(`effect clear ${BOT} hunger`);
      await sleep(210_000);
    },
    { whole: true, settings: { ...STILL, cortex: { notes } }, flags: ["--planner", "claude"] },
  );
  const plans = plansOf(ticks);
  const doing = (t: Tick) => ((step) => (step?.skill ? `${step.skill} ${step.target ?? ""}`.trim() : null))(trace(t, "motor").step as { skill?: string; target?: string } | undefined);
  // Each stuck report the planner was told of: what was being tried, and the plan that answered.
  const failed = new Map<string, { toldAt: number; noted: boolean; again: number }>();
  for (const plan of plans.filter((p) => p.woken?.includes("is stuck"))) {
    const report = [...ticks].reverse().find((t) => t.timestamp <= plan.at && trace(t, "motor").stuck);
    const thing = report && doing(report);
    if (thing && !failed.has(thing)) failed.set(thing, { toldAt: plan.at, noted: (plan.notes.added?.length ?? 0) + (plan.notes.changed?.length ?? 0) > 0, again: 0 });
  }
  // Setting out on the same thing again: the motor area carrying that very skill at that target, in a later stretch.
  let last: string | null = null;
  for (const t of ticks) {
    const thing = doing(t);
    const was = thing ? failed.get(thing) : undefined;
    if (was && thing !== last && t.timestamp > was.toldAt + 1000) was.again++;
    last = thing;
  }
  const things = [...failed];
  const errors = ticks.flatMap((t) => t.regions.filter((r) => r.region === "prefrontal" && (r as { error?: string }).error)).length;
  const calls = plans.length;
  const wokenCalls = plans.filter((p) => p.woken).length;
  const lastNotes = [...plans].reverse().find((p) => p.given.length)?.given ?? [];
  const again = things.reduce((n, [, f]) => n + f.again, 0);
  return {
    ticks,
    ok: things.length > 0 && errors === 0 && (notes > 0 ? things.some(([, f]) => f.noted) : true),
    note: `${calls} plans (${wokenCalls} woken at once, ${errors} failed); failed and told: ${things.map(([thing, f]) => `${thing}${notes > 0 ? (f.noted ? " (noted)" : " (no note)") : ""}${f.again ? `, tried again ${f.again}×` : ""}`).join("; ") || "nothing"}; tried again in all: ${again}${notes > 0 ? `; notes at the end: ${lastNotes.map((n) => `"${n.key}: ${n.text.slice(0, 90)}"`).join(" ") || "none"}` : ""}`,
  };
}

/** What instinct chooses in the learned-skill scene when it is not Jev: the learned skill once there is one, else take bread, then eat it. */
const ROUTINE = [
  { when: "not need hunger below 0.4", choose: "take_items_then_eat" },
  { when: "need hunger below 0.4", choose: "idle" },
  { when: "not carrying 1 cooked_beef", choose: "take_items" },
  { when: "carrying 1 cooked_beef", choose: "eat" },
];

/**
 * One run of the learned-skill scene, with the echo planner. A chest of cooked meat stands on the
 * plaza. Round after round the bot is made a little hungry with empty pockets, and the goal's second
 * step is left to instinct: "take meat from the chest and eat" (done when it is no longer
 * hungry: one piece is enough). The chain instinct's choices make is noted each time; three the same become a skill,
 * which the echo planner names after its links. `jev`: instinct is Jev. Otherwise it is the echo
 * engine with fixed rules of choice (ROUTINE), so that the scene shows the mechanism and not what
 * Jev happens to pick: the whole brain, the real arbiter and the real skills, with no model.
 */
async function skillRun(jev: boolean): Promise<Run> {
  await freshPlaza();
  const CHEST = `pos:63,${Y},40`;
  rcon(`setblock 63 ${Y} 40 air`);
  rcon(`setblock 63 ${Y} 40 chest{Items:[{Slot:0b,id:"minecraft:cooked_beef",count:48}]} replace`);
  const round = (i: number) => ({ goal: `Eat from the chest, round ${i}.`, wants: [{ item: "cooked_beef", count: 1 }], steps: [{ text: `wait until hungry (${i})`, doneWhen: "not need hunger below 0.4" }, { text: `take meat from the chest and eat it (${i})`, doneWhen: "need hunger below 0.4" }] });
  // Two steps a round: the first waits for hunger, so the second begins on the tick the bot is hungry, with empty pockets.
  const plans = Array.from({ length: 12 }, (_, i) => round(i + 1));
  const food = () => playerNumber("foodLevel");
  const hungry = async () => {
    rcon(`clear ${BOT}`);
    rcon(`effect give ${BOT} hunger 30 255 true`);
    for (let waited = 0; waited < 60 && !(food() <= 9); waited++) await sleep(500);
    rcon(`effect clear ${BOT} hunger`);
  };
  // It starts out knowing the chest and what is in it (as if it had opened it before): take_items then goes to it without being told where.
  rmSync(`data/${BOT}`, { recursive: true, force: true });
  mkdirSync(`data/${BOT}`, { recursive: true });
  writeFileSync(`data/${BOT}/chests.json`, JSON.stringify({ [CHEST]: { contents: { cooked_beef: 48 }, seenAt: Date.now() } }));
  const ticks = await play(
    async () => {
      await sleep(17_000);
      for (let i = 0; i < 8; i++) {
        await hungry();
        // Up to 40 s for the round: until it has eaten its fill.
        for (let waited = 0; waited < 80 && !(food() >= 13); waited++) await sleep(500);
        // The next round's plan comes with the planner's next turn.
        await sleep(17_000);
      }
    },
    { whole: true, keep: true, plan: plans, settings: STILL, flags: jev ? [] : ["--engine", "echo", "--choices", JSON.stringify(ROUTINE)] },
  );
  const cortex = ticks as unknown as CortexTick[];
  const chains = ticks.flatMap((t) => ((c) => (c === undefined ? [] : [typeof c === "string" ? c : `${(c.links as { skill: string; target?: string }[]).map((l) => `${l.skill}${l.target ? ` ${l.target}` : ""}`).join(" > ")} (seen ${c.seen})`]))(trace(t, "motor").chain));
  const named = ticks.flatMap((t) => t.regions.filter((r) => r.region === "prefrontal" && r.trace?.named).map((r) => ({ at: t.timestamp, as: String((r.trace!.named as { as: string }).as) })))[0];
  const runs = (type: string) => (named ? ticks.flatMap((t) => (t.skillEvents ?? []).filter((e) => e.skill === named.as && e.type === type)) : []);
  const chosen = named ? ticks.filter((t) => t.timestamp > named.at && t.winner?.action.skill === named.as) : [];
  const reasons = runs("failed").map((e) => e.reason ?? "").slice(0, 2);
  const rounds = finishedSteps(cortex).filter((f) => f.step === 1).length;
  return {
    ticks,
    ok: jev ? true : named !== undefined && runs("done").length > 0,
    note: `${rounds} rounds finished; chains: ${chains.join("; ") || "none"}. ${named ? `Became the skill "${named.as}" ${sec(named.at - ticks[0]!.timestamp)} s in; after that it was the action on ${chosen.length} ticks (${count(chosen.map((t) => `by ${t.winner!.region}`))}), started ${runs("started").length}×, done ${runs("done").length}×, failed ${runs("failed").length}×${reasons.length ? ` (${reasons.join("; ")})` : ""}` : "No skill was made"}`,
  };
}

const MINUTES = flag("minutes", 60);
const OFF = { motor: 0, conditions: 0, holdBack: 0, goalGate: 0, sensory: 0, notes: 0, chunks: 0 };

/** One arm of the cost scene: ordinary play at the base for a while, with Jev and the Claude planner, and the cortex as given. */
async function costArm(name: string, cortex: object | undefined): Promise<{ ticks: Tick[]; line: string }> {
  for (const command of ["gamerule spawn_mobs false", "weather clear", "time set 1000"]) rcon(command);
  const ticks = await play(async () => void (await sleep(MINUTES * 60_000)), { whole: true, start: "-7.5 69 13.5 0 0", settings: cortex ? { cortex } : {}, flags: ["--planner", "claude"] });
  const minutes = (ticks.at(-1)!.timestamp - ticks[0]!.timestamp) / 60_000;
  const plans = plansOf(ticks);
  const jev = ticks.filter((t) => trace(t, "instinct").questions !== undefined).length;
  const finished = finishedSteps(ticks as unknown as CortexTick[]).length;
  const byPlanner = ticks.flatMap((t) => t.regions.filter((r) => r.region === "prefrontal" && r.trace?.stepFinished)).length;
  const withSteps = plans.filter((p) => p.steps.length).length;
  const errors = ticks.flatMap((t) => t.regions.filter((r) => r.region === "prefrontal" && (r as { error?: string }).error)).length;
  const stuck = ticks.filter((t) => trace(t, "motor").stuck).length;
  const named = ticks.flatMap((t) => t.regions.filter((r) => r.region === "prefrontal" && r.trace?.named)).length;
  const actions = count(ticks.flatMap((t) => (t.skillEvents ?? []).filter((e) => e.type === "started" && !["look_at", "flinch"].includes(e.skill)).map((e) => e.skill)));
  const deaths = ticks.at(-1)!.state.data.self.deaths;
  return {
    ticks,
    line: `${name}, ${minutes.toFixed(0)} min: planner ${plans.length} calls (${(plans.length / minutes).toFixed(1)} a minute; ${plans.filter((p) => p.woken).length} woken at once, ${errors} failed); Jev ${jev} calls (${(jev / minutes).toFixed(1)} a minute); plans with steps ${withSteps}; steps finished ${finished} by their condition and ${byPlanner} by the planner's word; stuck reports ${stuck}; skills learned ${named}; skills started: ${actions}; deaths ${deaths}`,
  };
}

/** One run of the stuck scene. The first plan's only step is a spot in mid-air; the second is a walk it can do. */
async function stuckRun(): Promise<Run> {
  const cannot = { text: "walk to the high ledge", skill: "go_to", target: `pos:72,${Y + 9},40`, doneWhen: `within 2 of pos:72,${Y + 9},40` };
  const plans = [
    { goal: "Get to the high ledge at the far end of the plaza.", steps: [cannot] },
    { goal: "The ledge cannot be reached: walk to the near end of the plaza instead.", steps: [walkTo(50, "walk to the near end")] },
  ];
  await freshPlaza();
  // The walk to a spot in mid-air does not fail: it keeps trying. With nothing learned about go_to yet, it is stuck after three times 30 s.
  const ticks = await play(async () => void (await sleep(135_000)), { whole: true, plan: plans, settings: STILL });
  const stuck = ticks.find((t) => trace(t, "motor").stuck);
  const woken = ticks.flatMap((t) => t.regions.filter((r) => r.region === "prefrontal" && r.trace?.woken).map((r) => ({ at: t.timestamp, trace: r.trace as Record<string, any> })))[0];
  const first = goalOf(ticks.find((t) => goalOf(t))!)?.text;
  const changed = stuck && ticks.find((t) => t.timestamp > stuck.timestamp && goalOf(t) && goalOf(t)!.text !== first);
  const plansAfter = stuck ? ticks.filter((t) => t.timestamp >= stuck.timestamp).flatMap((t) => t.regions.filter((r) => r.region === "prefrontal" && r.trace?.plan)).length : 0;
  const finished = finishedSteps(ticks as unknown as CortexTick[]);
  const why = stuck ? (trace(stuck, "motor").stuck.why as string) : "";
  return {
    ticks,
    ok: stuck !== undefined && woken !== undefined && changed !== undefined,
    note: `stuck ${stuck ? `${sec(stuck.timestamp - ticks[0]!.timestamp)} s in (${why})` : "never"}; the planner woken ${woken && stuck ? `${sec(woken.at - stuck.timestamp)} s later, told "${String(woken.trace.woken).slice(0, 90)}"` : "never"}; new goal ${changed ? `"${goalOf(changed)!.text.slice(0, 70)}" ${sec(changed.timestamp - stuck!.timestamp)} s after` : "none"}; ${plansAfter} plans after the report; steps of the new plan finished: ${finished.length}`,
  };
}

/** The scenes that call the Claude planner are run only when named. */
const PAID = ["claude", "notes", "nonotes", "cost"];
/** A long scene that is run only when named. */
const LONG = ["skilljev"];
const names = wanted.length ? wanted : Object.keys(scenes).filter((name) => !PAID.includes(name) && !LONG.includes(name));
const unknown = names.filter((name) => !scenes[name]);
if (unknown.length) {
  console.error(`Unknown scene(s): ${unknown.join(", ")}. Use: ${Object.keys(scenes).join(", ")}`);
  process.exit(1);
}
const rows: Row[] = [];
for (const name of names) {
  console.log(`=== ${name} (${name === "claude" ? 1 : RUNS} runs)`);
  try {
    const made = await scenes[name]!();
    rows.push(made);
    console.log(`    ${made.problem ? `PROBLEM: ${made.problem}` : "no problem seen"}`);
  } catch (error) {
    rows.push({ scene: name, areas: "", outcome: "", problem: `the scene broke: ${error instanceof Error ? error.message : error}` });
    console.log(`    BROKE: ${error instanceof Error ? error.message : error}`);
  }
}
rcon(`tp ${BOT} -8 69 14`);
console.log("\nscene | what each area did | outcome");
for (const r of rows) console.log(`${r.scene} | ${r.areas} | ${r.outcome}${r.problem ? ` PROBLEM: ${r.problem}` : ""}`);
const problems = rows.filter((r) => r.problem);
console.log(`\n${rows.length} scenes, ${RUNS} runs each; ${problems.length} showed a problem${problems.length ? `: ${problems.map((r) => r.scene).join(", ")}` : ""}.`);
