// Live check of the thalamus on the test server: what the deciding layers are told. Most scenes
// run with no Jev (the views are built and logged whether or not anyone reads them); `cost`
// runs the whole brain, with the thalamus in and left out.
// Needs the server container (MC_CONTAINER, default familiar-m6).
//   pnpm thalamus-check [--runs 3] [scene ...]
import { rcon, sleep } from "./primitive-check/world.ts";
import { after, between, BOT, freshPlaza, HOME, n, play, type Tick } from "./live.ts";

interface Row {
  scene: string;
  sizes: string;
  opened: string;
  bursts: string;
  outcome: string;
  problem: string;
}
interface View {
  paused?: boolean;
  limit: number;
  spent: number;
  size: number;
  over?: number;
  channels: Record<string, { open: string | false; full: number; brief: number; counted: number }>;
  items: { id: string; form: "full" | "brief"; priority: number; by: string[] }[];
  bursts?: string[];
  heldBack: Record<string, number>;
}
interface Thalamus {
  views?: Record<string, View>;
  asks?: string[];
  arousal?: number;
  focus?: number;
  fullSize?: number;
  worstMs?: number;
}
type Seen = Tick & { attended?: { id: string; kind: string } | null };

/** No Jev: the reflexes, upkeep, the modulators, the colliculus and the thalamus. The bot does not glance around, so what is in view is what the scene put there. */
const QUIET = { also: ["colliculus", "thalamus"] };
const settled = (over: object = {}) => ({ colliculus: { scanning: 0 }, ...over });
const CHEST = "64 151 40";
const CHEST_ID = "pos:64,151,40";
const WANTS_BREAD = { goal: "Carry sixteen bread.", steps: [], reason: "", wants: [{ item: "bread", count: 16 }] };
const PLAN_ARRIVES_MS = 17_000;
const tha = (t: Tick) => (t.regions.find((r) => r.region === "thalamus")?.trace ?? {}) as Thalamus;
const viewOf = (t: Tick, reader = "instinct") => tha(t).views?.[reader];
const built = (ticks: Tick[], reader = "instinct") => ticks.flatMap((t) => (viewOf(t, reader)?.limit ? [viewOf(t, reader)!] : []));
const mobs = (t: Tick) => (t.state.data as unknown as { nearby: { mobs: { id: string; type: string; hostile: boolean }[] } }).nearby.mobs;
const idOf = (ticks: Tick[], type: string) => ticks.flatMap((t) => mobs(t)).find((m) => m.type === type)?.id;
const formOf = (view: View | undefined, id: string | undefined) => view?.items.find((i) => i.id === id)?.form ?? "counted";
const middle = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? NaN;
const range = (values: number[]) => (values.length ? `${Math.min(...values)} to ${Math.max(...values)}` : "none");
const sizes = (ticks: Tick[]) => `instinct ${range(built(ticks).map((v) => v.size))} of ${middle(built(ticks).map((v) => v.limit))}; planner ${range(built(ticks, "prefrontal").map((v) => v.size))} of ${middle(built(ticks, "prefrontal").map((v) => v.limit))}; the full state ${range(ticks.flatMap((t) => (tha(t).fullSize ? [tha(t).fullSize!] : [])))}`;
/** Each channel that was open on some tick, and why. */
const opened = (ticks: Tick[], reader = "instinct") => {
  const why = new Map<string, Set<string>>();
  for (const view of built(ticks, reader)) for (const [name, c] of Object.entries(view.channels)) if (c.open) why.set(name, (why.get(name) ?? new Set()).add(c.open));
  return [...why].map(([name, reasons]) => `${name} (${[...reasons].join("; ")})`).join(", ") || "nothing";
};
const burstsIn = (ticks: Tick[], reader = "instinct") => built(ticks, reader).flatMap((v) => v.bursts ?? []);
export const worstMs = (ticks: Tick[]) => Math.max(0, ...ticks.map((t) => tha(t).worstMs ?? 0));
let worst = 0;
const run = async (act: Parameters<typeof play>[0], options: Parameters<typeof play>[1] = {}) => {
  const ticks = await play(act, options);
  worst = Math.max(worst, worstMs(ticks));
  return ticks;
};

/** A herd of still animals in rows ahead of the bot. */
function herd(count: number): void {
  const kinds = ["cow", "sheep", "pig"];
  for (let i = 0; i < count; i++) rcon(`summon ${kinds[i % 3]} ${63.5 + (i % 6) * 2} 151 ${37.5 + Math.floor(i / 6) * 1.4} {NoAI:1b,Silent:1b,PersistenceRequired:1b}`);
}
function chest(stacks: number): void {
  rcon(`setblock ${CHEST} air`);
  rcon(`setblock ${CHEST} chest`);
  for (let slot = 0; slot < stacks; slot++) rcon(`item replace block ${CHEST} container.${slot} with bread 64`);
}

const scenes: Record<string, () => Promise<Row>> = {
  /** 1. Crowd: thirty animals and one hostile. Jev's view stays inside its limit and holds the hostile in full. */
  async crowd() {
    await freshPlaza();
    let there = 0;
    const ticks = await run(
      async () => {
        herd(30);
        // A husk in a glass box nine blocks off: seen, and it cannot get to the bot.
        for (const command of ["fill 68 151 43 70 153 44 glass", "setblock 69 151 43 air", "setblock 69 152 43 air", "summon husk 69.5 151 43.5 {NoAI:1b,Silent:1b,PersistenceRequired:1b,IsBaby:0b}"]) rcon(command);
        await sleep(3000);
        there = Date.now();
        await sleep(8000);
      },
      { ...QUIET, settings: settled() },
    );
    const crowded = after(ticks, there).filter((t) => mobs(t).length >= 25);
    const husk = idOf(crowded, "husk");
    const views = built(crowded);
    const full = views.filter((v) => formOf(v, husk) === "full").length;
    const overBy = Math.max(0, ...views.map((v) => v.size - v.limit));
    const told = middle(views.map((v) => v.items.length));
    return {
      scene: "crowd",
      sizes: sizes(crowded),
      opened: opened(crowded),
      bursts: `${burstsIn(crowded).length}`,
      outcome: `${middle(crowded.map((t) => mobs(t).length))} mobs in the state; Jev told of ${told} things, the rest counted (${JSON.stringify(views.at(-1)?.heldBack ?? {})}); the husk in full on ${full} of ${views.length} ticks; over the limit by at most ${overBy}`,
      problem: !crowded.length ? "the crowd never showed in the state" : !husk ? "the husk was not in the state" : full < views.length ? "the hostile was not held in full on every tick" : overBy > 100 && !views.some((v) => v.over) ? "the view went over its limit with nothing to explain it" : "",
    };
  },

  /** 2. Spotlight: whatever the colliculus picks is told in full; the same thing, unattended, is brief. */
  async spotlight() {
    await freshPlaza();
    let moved = 0;
    const ticks = (await run(
      async () => {
        herd(8);
        rcon('summon pig 64.5 151 42.5 {NoAI:1b,Silent:1b,PersistenceRequired:1b,Tags:["walker"]}');
        await sleep(8000);
        moved = Date.now();
        // It starts to walk: the colliculus turns to it.
        for (let i = 1; i <= 12; i++) {
          rcon(`tp @e[tag=walker] 64.5 151 ${(42.5 - 0.25 * i).toFixed(2)}`);
          await sleep(250);
        }
        await sleep(9000);
      },
      { ...QUIET, settings: settled() },
    )) as Seen[];
    const since = after(ticks, moved) as Seen[];
    const walker = since.flatMap((t) => (t.attended?.kind === "pig" ? [t.attended.id] : []))[0];
    const attendedTicks = since.filter((t) => t.attended?.id === walker && viewOf(t)?.limit);
    const otherTicks = since.filter((t) => t.attended?.id !== walker && viewOf(t)?.limit && mobs(t).some((m) => m.id === walker));
    const share = (part: Seen[], form: string) => `${part.filter((t) => formOf(viewOf(t), walker) === form).length} of ${part.length}`;
    return {
      scene: "spotlight",
      sizes: sizes(since),
      opened: opened(attendedTicks),
      bursts: `${burstsIn(since).length}`,
      outcome: `the pig the colliculus picked: in full on ${share(attendedTicks, "full")} ticks while attended; unattended, in full on ${share(otherTicks, "full")}, brief on ${share(otherTicks, "brief")}, counted on ${share(otherTicks, "counted")}`,
      problem: !walker ? "the colliculus never picked the pig" : attendedTicks.some((t) => formOf(viewOf(t), walker) !== "full") ? "the attended thing was not told in full" : !otherTicks.length ? "the pig was never unattended (the scene shows nothing)" : otherTicks.every((t) => formOf(viewOf(t), walker) === "full") ? "unattended, it was still told in full" : "",
    };
  },

  /** 3. Hungry: out of bread, the chest it has learned gives bread is told in full; stocked, it is brief or counted. (The pull itself is off, so the bot stays put.) */
  async hungry() {
    await freshPlaza();
    chest(1);
    herd(12);
    let [stocked, short] = [0, 0];
    const ticks = await run(
      async ({ say }) => {
        await sleep(PLAN_ARRIVES_MS);
        for (let i = 0; i < 2; i++) {
          say(`do take_items ${CHEST_ID}`);
          await sleep(6000);
          rcon(`tp ${BOT} ${HOME}`);
          rcon(`clear ${BOT} bread`);
          await sleep(1500);
        }
        rcon(`give ${BOT} bread 16`);
        await sleep(8000);
        stocked = Date.now();
        await sleep(10_000);
        rcon(`clear ${BOT} bread`);
        short = Date.now();
        await sleep(10_000);
      },
      { ...QUIET, plan: WANTS_BREAD, settings: settled({ personality: { wanting: 0 } }) },
    );
    const [fed, hungry] = [between(ticks, stocked, short), after(ticks, short + 1000)];
    const forms = (part: Tick[]) => built(part).map((v) => formOf(v, CHEST_ID));
    const share = (part: Tick[], form: string) => `${forms(part).filter((f) => f === form).length} of ${forms(part).length}`;
    return {
      scene: "hungry",
      sizes: sizes(hungry),
      opened: `out of bread: ${opened(hungry)} | stocked: ${opened(fed)}`,
      bursts: `${burstsIn(after(ticks, stocked)).length}`,
      outcome: `the chest was told in full on ${share(hungry, "full")} ticks out of bread, and on ${share(fed, "full")} stocked (brief on ${share(fed, "brief")}, counted on ${share(fed, "counted")})`,
      problem: forms(hungry).filter((f) => f === "full").length < forms(hungry).length * 0.8 ? "out of bread, the chest it knows was not told in full" : forms(fed).some((f) => f === "full") ? "stocked, the chest was still told in full" : "",
    };
  },

  /** 4. Burst: something appears in a turned-down channel (and the colliculus does not pick it). It is shown once, marked new. */
  async burst() {
    await freshPlaza();
    let came = 0;
    const ticks = await run(
      async () => {
        herd(18);
        await sleep(8000);
        came = Date.now();
        rcon('summon pig 62.5 151 43.5 {NoAI:1b,Silent:1b,PersistenceRequired:1b,Tags:["late"]}');
        await sleep(9000);
      },
      // The threshold is out of reach, so the colliculus picks nothing and no channel is opened by attention.
      { ...QUIET, settings: settled({ colliculus: { scanning: 0, threshold: 5 } }) },
    );
    const since = after(ticks, came);
    const all = burstsIn(since);
    const once = new Set(all).size === all.length;
    const first = since.find((t) => (viewOf(t)?.bursts ?? []).length);
    const late = all[0];
    const next = first ? since.filter((t) => t.timestamp > first.timestamp + 2000 && viewOf(t)?.limit) : [];
    const laterForms = next.map((t) => formOf(viewOf(t), late));
    return {
      scene: "burst",
      sizes: sizes(since),
      opened: opened(since),
      bursts: `${all.length} for Jev (${all.join(", ") || "none"}); ${burstsIn(since, "prefrontal").length} for the planner`,
      outcome: `the new pig was marked new on ${all.length} tick(s), ${n(((first?.timestamp ?? NaN) - came) / 1000, 1)} s after it was made, in ${first ? formOf(viewOf(first), late) : "no"} form; two seconds on it was ${[...new Set(laterForms)].join(" or ") || "gone"}`,
      problem: !all.length ? "nothing burst through" : !once ? "the same thing was marked new more than once" : first && formOf(viewOf(first), late) === "counted" ? "the news was not passed on" : "",
    };
  },

  /** 5. Drowsy and alert: the same crowd, with arousal resting low and resting as usual. The view size in each. */
  async drowsy() {
    const arm = async (resting: number) => {
      await freshPlaza();
      const ticks = await run(
        async () => {
          herd(18);
          await sleep(15_000);
        },
        // The reticular formation is what makes arousal: it is added here (the usual quiet list leaves it out).
        { also: [...QUIET.also, "reticular"], settings: settled({ arousal: { resting } }) },
      );
      const late = ticks.slice(Math.floor(ticks.length / 2));
      return { late, views: built(late), arousal: middle(late.map((t) => tha(t).arousal ?? NaN)) };
    };
    const alert = await arm(0.5);
    const drowsy = await arm(0.25);
    const say = (a: Awaited<ReturnType<typeof arm>>) => `arousal ${n(a.arousal)}: limit ${middle(a.views.map((v) => v.limit))}, view ${middle(a.views.map((v) => v.size))} characters, ${middle(a.views.map((v) => v.items.length))} things told`;
    return {
      scene: "drowsy and alert",
      sizes: `alert: ${sizes(alert.late)} | drowsy: ${sizes(drowsy.late)}`,
      opened: opened(alert.late),
      bursts: `${burstsIn(alert.late).length}`,
      outcome: `alert, ${say(alert)} | drowsy, ${say(drowsy)}`,
      problem: !(middle(drowsy.views.map((v) => v.limit)) < middle(alert.views.map((v) => v.limit))) ? "drowsy, the limit was no smaller" : "",
    };
  },

  /** 6. The planner asks: a goal with `detail` gets what it asked for in the planner's view. */
  async asks() {
    await freshPlaza();
    const ticks = await run(
      async () => {
        herd(18);
        await sleep(PLAN_ARRIVES_MS + 10_000);
      },
      { ...QUIET, plan: { goal: "Look after the sheep.", steps: [], reason: "", detail: ["sheep"] }, settings: settled() },
    );
    const asked = ticks.findIndex((t) => (tha(t).asks ?? []).includes("sheep"));
    const [before, since] = [asked < 0 ? ticks : ticks.slice(0, asked), asked < 0 ? [] : ticks.slice(asked)];
    const sheep = new Set(ticks.flatMap((t) => mobs(t)).filter((m) => m.type === "sheep").map((m) => m.id));
    const fullSheep = (part: Tick[]) => middle(built(part, "prefrontal").map((v) => v.items.filter((i) => sheep.has(i.id) && i.form === "full").length));
    return {
      scene: "the planner asks",
      sizes: sizes(since),
      opened: `planner: ${opened(since, "prefrontal")} (before the ask: ${opened(before, "prefrontal")})`,
      bursts: `${burstsIn(since, "prefrontal").length}`,
      outcome: `${sheep.size} sheep in the state; in the planner's view ${fullSheep(before)} were in full before the goal asked and ${fullSheep(since)} after`,
      problem: asked < 0 ? "the goal's ask never reached the thalamus" : !(fullSheep(since) > fullSheep(before)) ? "the planner was told no more of what it asked for" : "",
    };
  },

  /** 7. Cost: the same crowded scene with the whole brain, the thalamus in and left out. Jev's request size, answer time and what it picked. */
  async cost() {
    const arm = async (without: string[] | undefined) => {
      await freshPlaza();
      chest(1);
      const ticks = await run(
        async () => {
          herd(24);
          await sleep(25_000);
        },
        { whole: true, ...(without ? { without } : {}), settings: settled() },
      );
      const asked = ticks.flatMap((t) => t.regions.filter((r) => r.region === "instinct" && r.trace?.engineMs !== undefined));
      const picked = asked.flatMap((r) => ((r.trace?.answers as { id: string; choice?: string }[] | undefined) ?? []).filter((a) => a.id === "next_action").map((a) => a.choice ?? "?"));
      // What Jev was sent: its view, or the whole state with the thalamus left out.
      const sent = ticks.flatMap((t) => (asked.length ? [viewOf(t)?.size ?? JSON.stringify(t.state).length] : []));
      return { size: middle(sent), ms: middle(asked.map((r) => r.trace!.engineMs as number)), calls: asked.length, picked };
    };
    const runs = 5;
    const [inn, out]: [Awaited<ReturnType<typeof arm>>[], Awaited<ReturnType<typeof arm>>[]] = [[], []];
    for (let i = 0; i < runs; i++) {
      inn.push(await arm(undefined));
      out.push(await arm(["thalamus"]));
    }
    const tally = (arms: typeof inn) => {
      const counts = new Map<string, number>();
      for (const choice of arms.flatMap((a) => a.picked)) counts.set(choice, (counts.get(choice) ?? 0) + 1);
      const total = [...counts.values()].reduce((a, b) => a + b, 0);
      return [...counts].sort((a, b) => b[1] - a[1]).map(([choice, count]) => `${choice} ${Math.round((100 * count) / total)}%`).join(", ");
    };
    const say = (arms: typeof inn) => `request ${range(arms.map((a) => a.size))} characters, answer time ${range(arms.map((a) => Math.round(a.ms)))} ms (median of each run), picked: ${tally(arms)}`;
    return {
      scene: "cost",
      sizes: `in: ${middle(inn.map((a) => a.size))}; left out: ${middle(out.map((a) => a.size))}`,
      opened: "",
      bursts: "",
      outcome: `thalamus in (${runs} runs): ${say(inn)} | left out (${runs} runs): ${say(out)}`,
      problem: !(middle(inn.map((a) => a.size)) < middle(out.map((a) => a.size))) ? "with the thalamus in, Jev's request was no smaller" : inn.some((a) => !a.calls) || out.some((a) => !a.calls) ? "Jev was not called in some run" : "",
    };
  },
};

const args = process.argv.slice(2);
const runsAt = args.indexOf("--runs");
const runs = runsAt >= 0 ? Number(args[runsAt + 1]) || 1 : 1;
const wanted = args.filter((_, i) => runsAt < 0 || (i !== runsAt && i !== runsAt + 1));
const unknown = wanted.filter((name) => !scenes[name]);
if (unknown.length) {
  console.error(`Unknown scene(s): ${unknown.join(", ")}. Use: ${Object.keys(scenes).join(", ")}`);
  process.exit(1);
}
const rows: Row[] = [];
for (const name of wanted.length ? wanted : Object.keys(scenes)) {
  // The cost scene already repeats itself five times in each arm.
  for (let i = 1; i <= (name === "cost" ? 1 : runs); i++) {
    console.log(`=== ${name}${runs > 1 && name !== "cost" ? ` (run ${i} of ${runs})` : ""}`);
    const row = await scenes[name]!().catch((error: unknown): Row => ({ scene: name, sizes: "", opened: "", bursts: "", outcome: "", problem: `the scene broke: ${error instanceof Error ? error.message : error}` }));
    rows.push({ ...row, scene: runs > 1 && name !== "cost" ? `${row.scene} ${i}` : row.scene });
    for (const line of [`sizes: ${row.sizes}`, `opened: ${row.opened}`, `bursts: ${row.bursts}`, ...row.outcome.split(" | ")]) console.log(`    ${line}`);
    console.log(`    ${row.problem ? `PROBLEM: ${row.problem}` : "no problem seen"}`);
  }
}
rcon("kill @e[type=!player,x=60,y=151,z=40,distance=..60]");
console.log("\nscene | view sizes | what was opened and why | bursts | outcome");
for (const r of rows) console.log(`${r.scene} | ${r.sizes} | ${r.opened} | ${r.bursts} | ${r.outcome}${r.problem ? ` | PROBLEM: ${r.problem}` : ""}`);
console.log(`\nSlowest thalamus tick in any scene: ${worst.toFixed(3)} ms (it should stay under 2).`);
const failed = rows.filter((r) => r.problem);
console.log(failed.length ? `FAIL: ${failed.map((r) => r.scene).join(", ")}` : `PASS: all ${rows.length} runs.`);
process.exit(failed.length ? 1 : 0);
