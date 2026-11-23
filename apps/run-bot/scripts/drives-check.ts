// Live check of the hypothalamus's drives on the test server: what the body wants over time,
// what acted before it had to, how stress builds and fades, and what the bot then did. Each scene
// runs the real bot and reports what its own tick log says; a scene is marked a PROBLEM when the
// numbers show a drive not doing what it is for, not when the run breaks.
// No Jev and no planner calls: only the reflexes, dopamine's wants and typed commands act.
// Needs the server container (MC_CONTAINER, default familiar-m6).
//   pnpm drives-check [--runs 3] [scene ...]
import { existsSync, readFileSync } from "node:fs";
import { rcon, sleep } from "./primitive-check/world.ts";
import { after, between, BOT, freshPlaza, HOME, n, play, traceOf, type Tick } from "./live.ts";

const CHEST = "74 151 40";
const CHEST_ID = `pos:${CHEST.split(" ").join(",")}`;
const WANTS_BREAD = { goal: "Carry sixteen bread.", steps: [], reason: "", wants: [{ item: "bread", count: 16 }] };
const PLAN_ARRIVES_MS = 17_000;
/** The game's tick of the day at which dusk begins (three minutes before the sun is down at 13 000). */
const DUSK_BEGINS = 13_000 - 3600;
const drives = (over: Record<string, number>) => ({ drives: over });

interface Shown {
  level: number;
  pressing: number;
  projected?: number;
  target?: number;
  why?: string;
}
interface Hypothalamus {
  needs?: Record<string, Shown>;
  top?: { name: string; kind: string; score: number; unmet?: boolean } | null;
  stress?: number;
  loadBy?: string;
  clock?: { night: boolean; dusk: number };
  desperate?: { need: string; value: number };
  learned?: string[];
  worstMs?: number;
}
interface Row {
  scene: string;
  /** The need the body wanted most, over the run. */
  top: string;
  /** What pressed, or was done, before it had to be. */
  early: string;
  stress: string;
  outcome: string;
  problem: string;
}

const hyp = (t: Tick) => traceOf<Hypothalamus>(t, "hypothalamus");
const need = (t: Tick | undefined, name: string) => (t ? hyp(t).needs?.[name] : undefined);
const signalOf = (t: Tick | undefined, name: string) => t?.signals[name]?.value ?? NaN;
const seconds = (ms: number) => n(ms / 1000, 0);
const wonBy = (t: Tick, region: string, skill?: string) => t.winner?.region === region && (skill === undefined || t.winner.action.skill === skill);
const foodNow = () => Number(/(-?\d+)$/.exec(rcon(`data get entity ${BOT} foodLevel`))?.[1] ?? NaN);

/** The top drive over the run, e.g. "tools 17 s → food_bar 40 s". */
function topOverTime(ticks: Tick[]): string {
  const spans: { name: string; from: number; to: number }[] = [];
  for (const t of ticks) {
    const name = hyp(t).top?.name ?? "nothing";
    if (spans.at(-1)?.name === name) spans.at(-1)!.to = t.timestamp;
    else spans.push({ name, from: t.timestamp, to: t.timestamp });
  }
  // A span is counted to the start of the next, so a need on top for one tick still shows.
  return spans.map((s, i) => `${s.name} ${seconds((spans[i + 1]?.from ?? s.to) - s.from)} s`).join(" → ") || "no hypothalamus";
}
/** Stress over the run: where it started and ended, and its peak. */
function stressOver(ticks: Tick[]): string {
  const values = ticks.map((t) => signalOf(t, "stress")).filter(Number.isFinite);
  return values.length ? `${n(values[0]!)} → ${n(values.at(-1)!)} (peak ${n(Math.max(...values))})` : "not shared";
}
function chest(bread: number): void {
  rcon(`setblock ${CHEST} air`);
  rcon(`setblock ${CHEST} chest`);
  if (bread > 0) rcon(`item replace block ${CHEST} container.0 with bread ${bread}`);
}
async function shortAgain(): Promise<void> {
  rcon(`tp ${BOT} ${HOME}`);
  rcon(`clear ${BOT} bread`);
  await sleep(600);
}
/** Drains the food bar to `level` with the hunger effect (which also makes the bot a little ill while it lasts). */
async function starveTo(level: number): Promise<void> {
  rcon(`effect give ${BOT} hunger 60 255 true`);
  for (let i = 0; i < 200 && !(foodNow() <= level); i++) await sleep(200);
  rcon(`effect clear ${BOT} hunger`);
  await sleep(400);
}
/** Two trips to the chest by hand, so the bot knows it. */
async function learnChest(say: (command: string) => void): Promise<void> {
  await sleep(PLAN_ARRIVES_MS);
  for (let i = 0; i < 2; i++) {
    say(`do take_items ${CHEST_ID}`);
    await sleep(8000);
    await shortAgain();
  }
}

const scenes: Record<string, () => Promise<Row>> = {
  /** 2. Dusk: a lit spot it has learned eases the dark. With the clock on it should head there before night falls; with it off, only after. */
  async dusk() {
    const arm = async (clock: number) => {
      await freshPlaza();
      rcon("fill 72 150 38 76 150 42 glowstone");
      chest(0);
      let began = 0;
      const ticks = await play(
        async ({ say }) => {
          rcon("time set 18000");
          await sleep(3000);
          // Twice by hand in the dark, so it learns that going to the lit chest eases the dark.
          for (let i = 0; i < 2; i++) {
            say(`do go_to ${CHEST_ID}`);
            await sleep(6500);
            rcon(`tp ${BOT} ${HOME}`);
            await sleep(1000);
          }
          rcon(`time set ${DUSK_BEGINS}`);
          rcon(`tp ${BOT} ${HOME}`);
          began = Date.now();
          await sleep(205_000);
        },
        { settings: drives({ clock }) },
      );
      rcon("time set 1000");
      const then = after(ticks, began + 1000);
      const nightAt = then.find((t) => t.state.data.time?.isNight)?.timestamp ?? NaN;
      const wentAt = then.find((t) => wonBy(t, "dopamine", "go_to"))?.timestamp ?? NaN;
      const pressedAt = then.find((t) => (need(t, "night_light")?.pressing ?? 0) > 0.1)?.timestamp ?? NaN;
      return { ticks: then, began, nightAt, wentAt, pressedAt };
    };
    const [on, off] = [await arm(1), await arm(0)];
    const when = (at: number, run: { began: number; nightAt: number }) => (Number.isFinite(at) ? `${seconds(at - run.began)} s in (${at < run.nightAt ? `${seconds(run.nightAt - at)} s before night` : `${seconds(at - run.nightAt)} s after night fell`})` : "never");
    return {
      scene: "dusk",
      top: `clock on: ${topOverTime(on.ticks)} | clock off: ${topOverTime(off.ticks)}`,
      early: `clock on: the dark pressed above 0.1 from ${when(on.pressedAt, on)}, it set off for the light ${when(on.wentAt, on)} | clock off: pressed from ${when(off.pressedAt, off)}, set off ${when(off.wentAt, off)}`,
      stress: stressOver(on.ticks),
      outcome: `night fell ${seconds(on.nightAt - on.began)} s in; with the clock it went ${Number.isFinite(on.wentAt) && on.wentAt < on.nightAt ? "before dark" : "not before dark"}, without it ${Number.isFinite(off.wentAt) && off.wentAt < off.nightAt ? "before dark" : "not before dark"}`,
      problem: !Number.isFinite(on.wentAt) ? "with the clock on it never set off for the light" : on.wentAt >= on.nightAt ? "with the clock on it did not set off before dark" : Number.isFinite(off.wentAt) && off.wentAt <= on.wentAt - on.began + off.began ? "it set off no earlier with the clock than without" : "",
    };
  },

  /** 3. Hungry soon: the food bar full, the reserve gone, nothing carried, a chest of bread it knows. */
  async hungry_soon() {
    const arm = async (lookAhead: number) => {
      await freshPlaza();
      chest(64);
      let ready = 0;
      const ticks = await play(
        async ({ say }) => {
          await learnChest(say);
          // Fed full, then the reserve run down until the bar gives up its first point.
          rcon(`effect give ${BOT} saturation 1 10 true`);
          await sleep(1500);
          await starveTo(19);
          await shortAgain();
          ready = Date.now();
          await sleep(15_000);
        },
        { plan: WANTS_BREAD, settings: drives({ lookAhead }) },
      );
      const then = after(ticks, ready);
      const wentAt = then.find((t) => wonBy(t, "dopamine", "take_items"))?.timestamp ?? NaN;
      return { then, ready, wentAt, bar: need(then[0], "food_bar"), food: then[0]?.state.data.self.food, foodAtTrip: then.find((t) => t.timestamp >= wentAt)?.state.data.self.food };
    };
    const [on, off] = [await arm(1), await arm(0)];
    const say = (run: Awaited<ReturnType<typeof arm>>) => `food bar ${run.food}/20, hunger level ${n(run.bar?.level ?? NaN)} pressing ${n(run.bar?.pressing ?? NaN)}${run.bar?.projected ? ` (heading for ${n(run.bar.projected)})` : ""}; set off ${Number.isFinite(run.wentAt) ? `${n((run.wentAt - run.ready) / 1000, 1)} s in, bar at ${run.foodAtTrip}` : "never"}`;
    return {
      scene: "hungry soon",
      top: `look-ahead on: ${topOverTime(on.then)} | off: ${topOverTime(off.then)}`,
      early: `look-ahead on: ${say(on)} | off: ${say(off)}`,
      stress: stressOver(on.then),
      outcome: `it went for bread ${Number.isFinite(on.wentAt) ? "with the bar still nearly full" : "never"}; with look-ahead off ${Number.isFinite(off.wentAt) ? "it went too (its pockets were empty, which presses by itself)" : "it did not"}`,
      problem: !Number.isFinite(on.wentAt) ? "it never went for food" : (on.bar?.pressing ?? 0) <= (on.bar?.level ?? 0) ? "hunger did not press ahead of the food bar" : "",
    };
  },

  /** 4. Hurt: carrying nine bread, which is enough for a healthy bot. Hurt, enough is more, and it goes for more. */
  async hurt() {
    await freshPlaza();
    chest(64);
    let [healthy, hurt] = [0, 0];
    const ticks = await play(
      async ({ say }) => {
        await learnChest(say);
        await sleep(12_000); // short again, it fetches its bread by itself (16)
        // Seven taken away leaves nine. Never emptied: a moment with none would send it off for more.
        rcon(`tp ${BOT} ${HOME}`);
        rcon(`clear ${BOT} bread 7`);
        await sleep(1000);
        healthy = Date.now();
        await sleep(12_000);
        // Hurt, with the food bar just too low for the body to heal by itself.
        await starveTo(17);
        rcon(`tp ${BOT} ${HOME}`);
        rcon(`damage ${BOT} 13`);
        hurt = Date.now();
        await sleep(20_000);
      },
      { plan: WANTS_BREAD },
    );
    const [well, bad] = [between(ticks, healthy + 1000, hurt - 8000), after(ticks, hurt + 500)];
    const targets = (part: Tick[]) => part.map((t) => need(t, "food_stock")?.target ?? NaN).filter(Number.isFinite);
    const trips = (part: Tick[]) => part.filter((t) => wonBy(t, "dopamine", "take_items")).length;
    const level = Math.max(...bad.map((t) => need(t, "food_stock")?.level ?? 0));
    return {
      scene: "hurt",
      top: topOverTime(after(ticks, healthy)),
      early: `healthy with 9 bread: enough is ${n(Math.max(...targets(well)), 1)}, the pull to the chest won ${trips(well)} ticks | hurt (health ${Math.min(...bad.map((t) => t.state.data.self.health))}): enough is ${n(Math.max(...targets(bad)), 1)}, short by ${n(level)}, the pull won ${trips(bad)} ticks`,
      stress: stressOver(after(ticks, healthy)),
      outcome: `bread carried at the end: ${ticks.at(-1)?.state.data.self.inventory.bread ?? 0}`,
      problem: !well.length || well.some((t) => (t.state.data.self.inventory.bread ?? 0) !== 9) ? "the scene did not set up: it was not carrying nine bread while healthy" : Math.max(...targets(bad)) <= Math.max(...targets(well)) ? "being hurt did not raise how much food is enough" : trips(well) > 0 ? "healthy and stocked, it went for more anyway" : trips(bad) === 0 ? "hurt and short of what is now enough, it never went for more" : "",
    };
  },

  /** 5. Learned target: it runs out of food, hungry, twice. Enough should rise each time, and be saved. */
  async learned_target() {
    await freshPlaza();
    const marks: number[] = [];
    const ticks = await play(async () => {
      await sleep(4000);
      for (let i = 0; i < 2; i++) {
        // Nothing carried, and the food bar run down to under half: caught short.
        await starveTo(9);
        await sleep(2500);
        // Fed and restocked with what used to be enough.
        rcon(`effect give ${BOT} saturation 1 10 true`);
        rcon(`give ${BOT} bread 8`);
        await sleep(3500);
        marks.push(Date.now());
        rcon(`clear ${BOT} bread`);
        await sleep(1500);
      }
    });
    const learned = ticks.flatMap((t) => hyp(t).learned ?? []);
    const withEight = marks.map((at) => need(between(ticks, at - 1500, at).at(-1), "food_stock"));
    const saved = existsSync(`data/${BOT}/targets.json`) ? (JSON.parse(readFileSync(`data/${BOT}/targets.json`, "utf8")) as Record<string, { times: number }>) : {};
    return {
      scene: "learned target",
      top: topOverTime(ticks),
      early: `carrying 8 bread after each shortage: enough is ${withEight.map((r) => n(r?.target ?? NaN, 1)).join(", then ")} (short by ${withEight.map((r) => n(r?.level ?? NaN)).join(", then ")}); to begin with 8 was enough`,
      stress: stressOver(ticks),
      outcome: `${learned.length} shortages learned from (${learned.join("; ") || "none"}); saved: food_stock × ${n(saved.food_stock?.times ?? NaN)}`,
      problem: learned.length !== 2 ? `it learned from ${learned.length} shortages, not 2` : !((withEight[1]?.target ?? 0) > (withEight[0]?.target ?? 0) && (withEight[0]?.target ?? 0) > 8) ? "enough did not rise with each shortage" : !((saved.food_stock?.times ?? 0) > 1.5) ? "what it learned was not saved" : "",
    };
  },

  /** 6. After a bad night: three attacks in three minutes, then calm. Stress should stay up for minutes, with patience lower and curiosity quieter, then all recover. */
  async bad_night() {
    await freshPlaza();
    let [calmBefore, attacksOver] = [0, 0];
    const ticks = await play(async () => {
      // Hard to hurt, so that three attacks are a strain and not a death.
      rcon(`effect give ${BOT} resistance 600 3 true`);
      // Fed and by day throughout, so that what is seen afterwards is the stress and not hunger or the dusk.
      rcon(`give ${BOT} bread 16`);
      await sleep(40_000);
      calmBefore = Date.now();
      for (let i = 0; i < 3; i++) {
        rcon("summon husk 66.5 151 40.5 {IsBaby:0b}");
        await sleep(25_000);
        rcon("kill @e[type=husk]");
        await sleep(35_000);
      }
      rcon("time set 1000");
      attacksOver = Date.now();
      await sleep(330_000);
    });
    const at = (ms: number) => ticks.find((t) => t.timestamp >= ms);
    const patience = (t: Tick | undefined) => signalOf(t, "patience");
    const curiosity = (t: Tick | undefined) => {
      const bored = need(t, "novelty");
      return bored && bored.level > 0 ? bored.pressing / bored.level : NaN;
    };
    const marks = [0, 60, 180, 300].map((s) => at(attacksOver + s * 1000));
    const line = (read: (t: Tick | undefined) => number) => marks.map((t) => n(read(t))).join(", ");
    const before = at(calmBefore - 1000);
    const peak = Math.max(...ticks.map((t) => signalOf(t, "stress")).filter(Number.isFinite));
    return {
      scene: "bad night",
      top: topOverTime(after(ticks, calmBefore)),
      early: `before the attacks: stress ${n(signalOf(before, "stress"))}, patience ${n(patience(before))}, curiosity pressing at ${n(curiosity(before))} of its level | at 0, 1, 3 and 5 min after the last attack: stress ${line((t) => signalOf(t, "stress"))}; patience ${line(patience)}; curiosity at ${line(curiosity)} of its level; alarm ${line((t) => signalOf(t, "alarm"))}`,
      stress: `${stressOver(ticks)}, by ${[...new Set(between(ticks, calmBefore, attacksOver).map((t) => hyp(t).loadBy))].filter((by) => by && by !== "nothing").join(", ")}`,
      outcome: `deaths ${ticks.at(-1)?.state.data.self.deaths ?? 0}; a minute after the last attack alarm was ${n(signalOf(marks[1], "alarm"))} and stress still ${n(signalOf(marks[1], "stress"))}`,
      problem: peak < 0.4 ? `three attacks raised stress only to ${n(peak)}` : signalOf(marks[1], "stress") < 0.5 * peak ? "stress was mostly gone a minute after the danger" : signalOf(marks[3], "stress") > 0.6 * peak ? "stress had hardly faded five minutes on" : !(patience(marks[1]) < patience(marks[3])) ? "patience was no lower while stressed than once it had faded" : "",
    };
  },

  /** 7. Cold: standing in powder snow. Warmth should come to press; what does the bot then do? */
  async cold() {
    await freshPlaza();
    let snowed = 0;
    const ticks = await play(async () => {
      await sleep(4000);
      rcon("fill 59 151 39 61 152 41 powder_snow");
      snowed = Date.now();
      await sleep(40_000);
    });
    rcon("fill 59 151 39 61 152 41 air");
    const then = after(ticks, snowed);
    const warmth = then.map((t) => need(t, "warmth")?.level ?? 0);
    const outAt = then.find((t) => Math.hypot(t.state.data.self.position.x - 60.5, t.state.data.self.position.z - 40.5) > 2)?.timestamp ?? NaN;
    const winners = [...new Set(then.filter((t) => t.winner).map((t) => `${t.winner!.region} ${t.winner!.action.skill ?? "?"}`))].join(", ");
    const onTop = then.find((t) => hyp(t).top?.name === "warmth")?.timestamp ?? NaN;
    return {
      scene: "cold",
      top: topOverTime(then),
      early: `warmth rose to ${n(Math.max(...warmth))}${Number.isFinite(onTop) ? `, on top from ${seconds(onTop - snowed)} s in` : ", never on top"}; health fell to ${Math.min(...then.map((t) => t.state.data.self.health))}`,
      stress: stressOver(then),
      outcome: `${Number.isFinite(outAt) ? `out of the snow ${seconds(outAt - snowed)} s in` : "still in the snow after 40 s"}; what acted: ${winners || "nothing"}`,
      problem: Math.max(...warmth) < 0.3 ? `in powder snow, warmth pressed at ${n(Math.max(...warmth))} at most` : !Number.isFinite(outAt) ? "it never left the snow" : "",
    };
  },

  /** 8. Desperate: starving, sent to a chest of bread that stands inside a husk's reach. With desperate on it should go; with it off, the husk should turn it back. */
  async desperate() {
    const arm = async (desperate: number) => {
      await freshPlaza();
      chest(64);
      let sent = 0;
      const ticks = await play(
        async ({ say }) => {
          // The goal is what lets it take bread from a chest; it has never been to this one, so nothing draws it there by itself.
          await sleep(PLAN_ARRIVES_MS);
          await starveTo(2);
          // A husk that stands still facing the bot, 3.5 blocks past the chest: where the bot stands to open the chest is inside the usual flight distance (8) and outside the shortened one (6).
          rcon("summon husk 77.5 151 40.5 {IsBaby:0b,NoAI:1b,Rotation:[90f,0f]}");
          await sleep(1500);
          sent = Date.now();
          say(`do take_items ${CHEST_ID}`);
          await sleep(14_000);
        },
        { plan: WANTS_BREAD, settings: drives({ desperate }) },
      );
      const then = after(ticks, sent);
      const flight = then.map((t) => (traceOf<{ defence?: { flightDistance?: number | null } }>(t, "brainstem").defence?.flightDistance ?? NaN)).filter(Number.isFinite);
      return { then, bread: Math.max(0, ...then.map((t) => t.state.data.self.inventory.bread ?? 0)), fled: then.filter((t) => t.winner?.action.skill === "flee").length, flight: flight.length ? Math.min(...flight) : NaN, desperate: Math.max(0, ...then.map((t) => signalOf(t, "desperate")).filter(Number.isFinite)), nearest: Math.min(...then.map((t) => Math.hypot(t.state.data.self.position.x - 77.5, t.state.data.self.position.z - 40.5))) };
    };
    const [on, off] = [await arm(1), await arm(0)];
    const say = (run: Awaited<ReturnType<typeof arm>>) => `desperate ${n(run.desperate)}, flight distance ${n(run.flight, 1)}, got within ${n(run.nearest, 1)} blocks of the husk, fled on ${run.fled} ticks, bread taken ${run.bread}`;
    return {
      scene: "desperate",
      top: `on: ${topOverTime(on.then)} | off: ${topOverTime(off.then)}`,
      early: `desperate on: ${say(on)} | off: ${say(off)}`,
      stress: stressOver(on.then),
      outcome: `with desperate on it ${on.bread > 0 ? "got the bread" : "did not get the bread"}; with it off it ${off.bread > 0 ? "got the bread" : "did not"}`,
      problem: !(on.flight < off.flight) ? "desperation did not shorten the flight distance" : on.bread === 0 ? "desperate, it still did not go for the food" : off.bread > 0 ? "with desperate off it went just the same" : "",
    };
  },

  /** 9. Unmet: starving, with nothing it knows of that helps. Search should rise, and sooner than with unmet off. */
  async unmet() {
    const arm = async (unmet: number) => {
      await freshPlaza();
      let hungry = 0;
      const ticks = await play(
        async ({ say }) => {
          await sleep(4000);
          await starveTo(4);
          hungry = Date.now();
          say("do idle");
          await sleep(75_000);
        },
        { settings: drives({ unmet }) },
      );
      const then = after(ticks, hungry);
      const search = then.map((t) => signalOf(t, "search"));
      return { then, hungry, search, highAt: then.find((t) => signalOf(t, "search") > 0.6)?.timestamp ?? NaN, unmet: Math.max(0, ...then.map((t) => signalOf(t, "unmet")).filter(Number.isFinite)) };
    };
    const [on, off] = [await arm(1), await arm(0)];
    const say = (run: Awaited<ReturnType<typeof arm>>) => `unmet ${n(run.unmet)}; search ${n(run.search[0]!)} → ${n(run.search.at(-1)!)}, above 0.6 ${Number.isFinite(run.highAt) ? `${seconds(run.highAt - run.hungry)} s in` : "never"}`;
    return {
      scene: "unmet",
      top: topOverTime(on.then),
      early: `unmet on: ${say(on)} | off: ${say(off)}`,
      stress: stressOver(on.then),
      outcome: `search reached ${n(Math.max(...on.search))} with unmet on and ${n(Math.max(...off.search))} with it off`,
      problem: on.unmet <= 0 ? "starving with nothing known that helps, unmet was never shared" : !(Math.max(...on.search) > 0.6) ? `search never rose above ${n(Math.max(...on.search))}` : "",
    };
  },
};

// Runs the scenes named on the command line (default: all) `--runs` times each, and prints the table.
const args = process.argv.slice(2);
const runsAt = args.indexOf("--runs");
const runs = runsAt >= 0 ? Number(args[runsAt + 1]) : 1;
const names = args.filter((_, i) => runsAt < 0 || (i !== runsAt && i !== runsAt + 1));
const wanted = names.length ? names : Object.keys(scenes);
const unknown = wanted.filter((name) => !scenes[name]);
if (unknown.length || !(runs >= 1)) {
  console.error(`Use: pnpm drives-check [--runs 3] [${Object.keys(scenes).join(" | ")}]`);
  process.exit(1);
}
const rows: Row[] = [];
for (const name of wanted) {
  for (let run = 1; run <= runs; run++) {
    console.log(`=== ${name} (run ${run} of ${runs})`);
    try {
      const row = await scenes[name]!();
      rows.push({ ...row, scene: runs > 1 ? `${row.scene} ${run}` : row.scene });
      for (const [label, text] of [["top drive", row.top], ["early", row.early], ["stress", row.stress], ["outcome", row.outcome]] as const) for (const line of text.split(" | ")) console.log(`    ${label}: ${line}`);
      console.log(`    ${row.problem ? `PROBLEM: ${row.problem}` : "no problem seen"}`);
    } catch (error) {
      rows.push({ scene: `${name} ${run}`, top: "", early: "", stress: "", outcome: "", problem: `the scene broke: ${error instanceof Error ? error.message : error}` });
      console.log(`    BROKE: ${error instanceof Error ? error.message : error}`);
    }
  }
}
rcon(`tp ${BOT} -8 69 14`);
console.log("\nscene | top drive over time | what acted early | stress | outcome");
for (const row of rows) console.log(`${row.scene} | ${row.top} | ${row.early} | ${row.stress} | ${row.outcome}${row.problem ? ` | PROBLEM: ${row.problem}` : ""}`);
const problems = rows.filter((r) => r.problem);
console.log(`\n${rows.length} runs; ${problems.length} showed a problem${problems.length ? `: ${problems.map((r) => r.scene).join(", ")}` : ""}.`);
