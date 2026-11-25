// Live check of the basal ganglia on the test server: who wins, by which term, how often the
// choice waits on a near tie, and how much of the time a habit acts. Every scene runs several
// times; the table gives each scene over all its runs.
// Needs the server container (MC_CONTAINER, default familiar-m6) and the base bed (for `bedtime`).
//   pnpm selection-check [--runs 5] [--minutes 10] [scene ...]
import { rcon, sleep } from "./primitive-check/world.ts";
import { after, BOT, freshPlaza, play, type Tick } from "./live.ts";
import { byHabit, type Selection, type SelectionTick } from "./selection-report.ts";

type Chosen = Tick & { selection?: Selection & { rivals?: { region: string; layer: number; skill?: string; urgency: number }[] }; alongside?: { region: string; action: { skill?: string } } };
interface Run {
  ticks: Chosen[];
  ok: boolean;
  note: string;
}
interface Row {
  scene: string;
  won: string;
  waits: string;
  habit: string;
  outcome: string;
  problem: string;
}

const flag = (name: string, otherwise: number) => {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? Number(process.argv[at + 1]) : otherwise;
};
const RUNS = flag("runs", 5);
const MINUTES = flag("minutes", 10);
const wanted = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && !all[i - 1]?.startsWith("--"));

/** No Jev: the reflexes, upkeep, the modulators, the reticular formation, the colliculus and the thalamus. */
const QUIET = { also: ["reticular", "colliculus", "thalamus"] };
const STILL = { colliculus: { scanning: 0 } };
const ALL_OFF = { bodyFirst: 0, wait: 0, channels: 0, habits: 0 };
const BED_SIDE = "-7.5 69 13.5 0 0";
const CALM = ["gamerule spawn_mobs false", "weather clear", "gamerule players_sleeping_percentage 101", "kill @e[type=item]"];

const tally = (keys: string[]) => [...keys.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
const list = (keys: string[], limit = 4) => tally(keys).slice(0, limit).map(([k, n]) => `${k} ×${n}`).join(", ") || "none";
const events = (ticks: Tick[], skill: string, type: string) => ticks.flatMap((t) => (t.skillEvents ?? []).filter((e) => e.skill === skill && e.type === type));
const trace = (t: Tick, region: string) => (t.regions.find((r) => r.region === region)?.trace ?? {}) as Record<string, any>;
const asked = (ticks: Tick[]) => ticks.filter((t) => trace(t, "instinct").engine !== undefined).length;
const perMinute = (count: number, ticks: Tick[]) => (ticks.length > 1 ? (count * 60_000) / (ticks.at(-1)!.timestamp - ticks[0]!.timestamp) : 0);
const waiting = (t: Chosen) => (t.selection?.conflicts ?? []).filter((c) => c.state === "waiting");
const settledHow = (ticks: Chosen[]) => ticks.flatMap((t, i) => (t.selection?.conflicts ?? []).filter((c) => c.state === "settled" && !(ticks[i - 1]?.selection?.conflicts ?? []).some((b) => b.state === "settled" && b.channel === c.channel)).map((c) => c.how ?? "?"));
/** How often the action changed from one skill to another, a minute. */
const switches = (ticks: Tick[]) => perMinute(ticks.flatMap((t) => (t.skillEvents ?? []).filter((e) => e.type === "started" && !(e as { alongside?: boolean }).alongside)).filter((e, i, all) => i > 0 && e.skill !== all[i - 1]!.skill).length, ticks);

/** One scene over all its runs, as a row of the table. */
function row(scene: string, runs: Run[], outcome = ""): Row {
  const ticks = runs.flatMap((r) => r.ticks);
  const wins = ticks.filter((t) => t.winner?.action.skill);
  const by = list(ticks.flatMap((t) => t.selection?.decidedBy ?? []));
  const waited = ticks.filter((t) => waiting(t).length).length;
  const habit = ticks.filter((t) => byHabit(t as unknown as SelectionTick)).length;
  const failed = runs.filter((r) => !r.ok);
  return {
    scene,
    won: `${list(wins.map((t) => `${t.winner!.region} ${t.winner!.action.skill}`))}; decided by ${by}`,
    waits: `${waited} ticks waiting; settled: ${list(settledHow(ticks))}`,
    habit: `${Math.round((100 * habit) / Math.max(1, ticks.length))}%`,
    outcome: `${runs.length - failed.length} of ${runs.length} runs as expected. ${outcome || runs[0]?.note || ""}`,
    problem: failed.length ? `${failed.length} of ${runs.length} runs: ${failed[0]!.note}` : "",
  };
}
const times = async (run: (i: number) => Promise<Run>, count = RUNS): Promise<Run[]> => {
  const runs: Run[] = [];
  for (let i = 0; i < count; i++) runs.push(await run(i));
  return runs;
};

const foodNow = () => Number(/(-?\d+)$/.exec(rcon(`data get entity ${BOT} foodLevel`))?.[1] ?? NaN);
async function starveTo(level: number): Promise<void> {
  rcon(`effect give ${BOT} hunger 60 255 true`);
  for (let i = 0; i < 150 && !(foodNow() <= level); i++) await sleep(200);
  rcon(`effect clear ${BOT}`);
}
function herd(count: number): void {
  const kinds = ["cow", "sheep", "pig"];
  for (let i = 0; i < count; i++) rcon(`summon ${kinds[i % 3]} ${63.5 + (i % 6) * 2} 151 ${37.5 + Math.floor(i / 6) * 1.4} {NoAI:1b,Silent:1b,PersistenceRequired:1b}`);
}
/** A calm place to live for a while: a few animals, a chest with bread. */
async function homestead(): Promise<void> {
  await freshPlaza();
  herd(6);
  rcon("setblock 64 151 43 chest");
  rcon("item replace block 64 151 43 container.0 with bread 16");
}

const scenes: Record<string, () => Promise<Row>> = {
  /** 1. Cornered in a closed room with a husk, unarmed, Jev deciding: the fight goes ahead. */
  async cornered() {
    const runs = await times(async () => {
      await freshPlaza();
      for (const command of ["difficulty easy", "fill 57 151 37 63 153 43 stone", "fill 58 151 38 62 153 42 air", "fill 57 154 37 63 154 43 glass"]) rcon(command);
      const ticks: Chosen[] = await play(
        async () => {
          await sleep(1500);
          rcon("summon husk 61.5 151 41.5 {IsBaby:0b}");
          await sleep(14_000);
          rcon("kill @e[type=husk]");
        },
        { whole: true, start: "58.5 151 38.5 -45 0", settings: STILL },
      );
      const cornered = ticks.filter((t) => trace(t, "brainstem").defence?.cornered);
      const fought = cornered.filter((t) => t.winner?.action.skill === "attack");
      // Who the fight went ahead of, and how strongly they asked: what a soft fight would have had to beat.
      const rivals = fought.flatMap((t) => t.selection?.rivals ?? []).filter((r) => r.skill !== "attack");
      const strongest = (layer0: boolean) => Math.max(0, ...rivals.filter((r) => (r.layer === 0) === layer0).map((r) => r.urgency));
      return { ticks, ok: cornered.length > 0 && events(ticks, "attack", "started").length > 0, note: `cornered on ${cornered.length} ticks, the fight won ${fought.length} of them (attack started ${events(ticks, "attack", "started").length}×); strongest rival: a decider at ${strongest(false).toFixed(2)}, another request of the body at ${strongest(true).toFixed(2)} (${list(rivals.map((r) => `${r.region} ${r.skill}`), 3)}); deaths ${ticks.at(-1)?.state.data.self.deaths}` };
    });
    return row("1 cornered (husk in a shut room, unarmed, Jev on)", runs, runs.map((r) => r.note).join(" || "));
  },

  /** 2. Tired, at night, beside the bed, Jev deciding: the body's request for bed goes ahead. */
  async bedtime() {
    const runs = await times(async () => {
      const ticks: Chosen[] = await play(async () => void (await sleep(30_000)), { whole: true, awakeDays: 1, before: [...CALM, "difficulty peaceful", "time set 14000"], start: BED_SIDE, settings: STILL });
      const started = ticks.find((t) => (t.skillEvents ?? []).some((e) => e.skill === "sleep" && e.type === "started"));
      const asleep = ticks.some((t) => (t.state.data.self as { asleep?: boolean }).asleep);
      const others = ticks.filter((t) => t.winner?.action.skill && t.winner.action.skill !== "sleep" && t.winner.layer >= 1).length;
      return { ticks, ok: started?.winner?.action.skill === "sleep" && asleep, note: `bed started by ${started?.winner?.region ?? "nothing"} after ${started ? ((started.timestamp - ticks[0]!.timestamp) / 1000).toFixed(0) : "?"} s (${started?.winner?.reason ?? ""}); asleep: ${asleep}; a decider's other choice went ahead on ${others} ticks` };
    });
    rcon("time set 1000");
    return row("2 bedtime (tired, night, by the bed, Jev on)", runs, runs.map((r) => r.note).join(" || "));
  },

  /** 3. Starving with bread in hand, Jev deciding: the urge to eat goes ahead. */
  async urge() {
    const runs = await times(async () => {
      await homestead();
      let at = 0;
      const ticks: Chosen[] = await play(
        async () => {
          rcon(`give ${BOT} bread 6`);
          await sleep(4000);
          await starveTo(6);
          at = Date.now();
          await sleep(16_000);
        },
        { whole: true, settings: STILL },
      );
      const since = after(ticks, at) as Chosen[];
      const meals = events(since, "eat", "done").length;
      const first = since.find((t) => t.winner?.action.skill === "eat");
      const overDecider = since.filter((t) => t.winner?.action.skill === "eat" && (t.selection?.decidedBy ?? []).includes("body-first")).length;
      return { ticks: since, ok: meals > 0 && ticks.at(-1)!.state.data.self.food >= 16, note: `ate ${meals}×, food at the end ${ticks.at(-1)!.state.data.self.food}; eat first won ${first ? `${((first.timestamp - at) / 1000).toFixed(1)} s after it was starving, from ${first.winner!.region} at ${first.winner!.urgency.toFixed(2)}` : "NEVER"}; body-first decided it on ${overDecider} ticks` };
    });
    return row("3 urge (starving with bread, Jev on)", runs, runs.map((r) => r.note).join(" || "));
  },

  /** 4. Idle, something appears to the side: the look goes ahead on its graded urgency (no full-urgency take-over). */
  async idle_look() {
    const runs = await times(async () => {
      await freshPlaza();
      let at = 0;
      const ticks: Chosen[] = await play(
        async () => {
          await sleep(3000);
          at = Date.now();
          rcon(`execute at ${BOT} run summon pig ~ 151 ~-5 {NoAI:1b}`);
          await sleep(6000);
        },
        { ...QUIET, settings: STILL },
      );
      const since = after(ticks, at) as Chosen[];
      const looks = since.flatMap((t) => t.regions.filter((r) => r.region === "colliculus").flatMap((r) => (r as unknown as { proposals: { action: { skill?: string }; urgency: number }[] }).proposals.filter((p) => p.action.skill === "look_at")));
      const ran = events(since, "look_at", "done").length;
      const how = list(since.flatMap((t) => (t.alongside?.action.skill === "look_at" ? ["alongside"] : t.winner?.action.skill === "look_at" ? ["as the action"] : [])));
      const most = Math.max(0, ...looks.map((p) => p.urgency));
      return { ticks: since, ok: ran > 0 && looks.length > 0 && most < 1, note: `${looks.length} looks proposed, the most urgent at ${most.toFixed(2)}; went ahead ${how}; look_at finished ${ran}×` };
    });
    return row("4 idle look (a pig appears to the side; no take-over urgency)", runs, runs.map((r) => r.note).join(" || "));
  },

  /** 5. A minute of ordinary life with Jev, with and without waiting: near ties, and how often the action switches. */
  async near_tie() {
    const arm = (wait: number) =>
      times(async () => {
        await homestead();
        const ticks: Chosen[] = await play(async () => void (await sleep(60_000)), { whole: true, settings: { selection: { wait, habits: 0 } } });
        // Without waiting nothing is logged as a near tie: count the ticks on which the top two were within 0.05 all the same.
        const close = ticks.filter((t) => {
          const scores = (t.selection?.candidates ?? []).map((c) => (c as unknown as { score: number }).score).sort((a, b) => b - a);
          return scores.length > 1 && scores[0]! - scores[1]! < 0.05;
        }).length;
        return { ticks, ok: true, note: `${switches(ticks).toFixed(1)} switches a minute, top two within 0.05 on ${close} of ${ticks.length} ticks, waited on ${ticks.filter((t) => waiting(t).length).length}` };
      });
    const [off, on] = [await arm(0), await arm(1)];
    const mean = (runs: Run[]) => runs.reduce((sum, r) => sum + switches(r.ticks), 0) / runs.length;
    const longest = Math.max(0, ...on.flatMap((r) => r.ticks.flatMap((t) => (t.selection?.conflicts ?? []).map((c) => c.ms))));
    const out = row("5 near tie (a minute of ordinary life, Jev on)", on, `switches a minute: ${mean(off).toFixed(1)} without waiting, ${mean(on).toFixed(1)} with (each over ${RUNS} runs); longest near tie ${longest} ms. Without: ${off.map((r) => r.note).join(" || ")}. With: ${on.map((r) => r.note).join(" || ")}`);
    return { ...out, problem: on.some((r) => r.ticks.some((t) => waiting(t).some((c) => c.ms > 300 + 200))) ? "a wait lasted well over 300 ms" : "" };
  },

  /** 6. Walking, something appears to the side: the look runs beside the walk and the walk arrives. No --same-time flag. */
  async look_and_walk() {
    const runs = await times(async () => {
      await freshPlaza();
      let at = 0;
      const ticks: Chosen[] = await play(
        async ({ say }) => {
          say("do go_to pos:76,151,40");
          await sleep(1800);
          at = Date.now();
          rcon(`execute at ${BOT} run summon pig ~6 151 37 {NoAI:1b}`);
          await sleep(8000);
        },
        { ...QUIET, start: "44.5 151 40.5 -90 0", settings: STILL },
      );
      const since = after(ticks, at) as Chosen[];
      const beside = since.filter((t) => t.alongside?.action.skill === "look_at").length;
      const took = since.filter((t) => t.winner?.action.skill === "look_at").length;
      const journey = ticks.flatMap((t) => t.skillEvents ?? []).find((e) => e.skill === "go_to" && e.type !== "started");
      // A look asked for only once the walk was over has nothing to run beside: that run tested nothing.
      const midWalk = since.filter((t) => t.state.data.current?.skill === "go_to" && (t.regions as { proposals?: { action: { skill?: string } }[] }[]).some((r) => (r.proposals ?? []).some((p) => p.action.skill === "look_at"))).length;
      if (midWalk === 0) return { ticks: since, ok: true, note: `NOT TESTED this run: no look was asked for during the walk (the walk ${journey?.type ?? "did not end"})` };
      const x = ticks.at(-1)!.state.data.self.position.x;
      return { ticks: since, ok: beside > 0 && took === 0 && journey?.type === "done" && x >= 74, note: `look ran alongside on ${beside} ticks and took the body on ${took}; look_at finished ${events(since, "look_at", "done").length}×; the walk ${journey?.type ?? "did not end"} at x=${x.toFixed(0)}` };
    });
    return row("6 look and walk (channels, no --same-time)", runs, runs.map((r) => r.note).join(" || "));
  },

  /** 7 and 8. Ten minutes of routine with Jev: habits form and Jev is asked less; then a husk appears and the habit is broken. */
  async habit() {
    const runs = await times(async () => {
      await homestead();
      let brokenAt = 0;
      // The day is held still: dusk raises a safety need (light for the night), and no habit acts while one presses.
      rcon("time set 1000");
      rcon("gamerule advance_time false");
      const ticks: Chosen[] = await play(
        async () => {
          await sleep(MINUTES * 60_000);
          brokenAt = Date.now();
          rcon("difficulty easy");
          rcon(`execute at ${BOT} run summon husk ~9 151 ~ {IsBaby:0b,NoAI:1b,PersistenceRequired:1b}`);
          await sleep(12_000);
          rcon("kill @e[type=husk]");
        },
        { whole: true },
      ).finally(() => rcon("gamerule advance_time true"));
      const routine = ticks.filter((t) => t.timestamp < brokenAt);
      const minute = (from: number) => routine.filter((t) => t.timestamp >= routine[0]!.timestamp + from * 60_000 && t.timestamp < routine[0]!.timestamp + (from + 1) * 60_000);
      const [first, last] = [minute(0), minute(MINUTES - 1)];
      const habitTicks = (part: Chosen[]) => part.filter((t) => byHabit(t as unknown as SelectionTick)).length;
      const counts = trace(routine.at(-1)!, "striatum") as { saved?: number; wrong?: number; broken?: number; habit?: { skill: string; strength: number; wins: number } };
      const before = routine.slice(-10).filter((t) => trace(t, "striatum").use).length;
      const afterIt = after(ticks, brokenAt) as Chosen[];
      const why = afterIt.map((t) => trace(t, "striatum").why as string | undefined).find((w) => w !== undefined);
      const usedAfter = afterIt.filter((t) => t.timestamp > brokenAt + 2000 && trace(t, "striatum").use).length;
      const askedAfter = asked(afterIt.filter((t) => t.timestamp > brokenAt + 2000));
      return {
        ticks: routine,
        ok: habitTicks(last) > 0 && asked(last) < asked(first) && (before === 0 || usedAfter === 0),
        note: `Jev calls a minute: ${asked(first)} in the first, ${asked(last)} in the last; the action came from a habit on ${habitTicks(routine)} of ${routine.length} ticks (${habitTicks(last)} of ${last.length} in the last minute); strongest habit ${counts.habit ? `${counts.habit.skill} ${counts.habit.strength} after ${counts.habit.wins} wins` : "none"}; calls saved ${counts.saved ?? 0}, wrong ${counts.wrong ?? 0}, broken ${counts.broken ?? 0}. Then a husk appeared: the habit was ${before ? "in use" : "NOT in use"} just before; after it, used on ${usedAfter} ticks, Jev asked on ${askedAfter}${why ? ` (${why})` : ""}`,
      };
    });
    return row(`7+8 habit (${MINUTES} minutes of routine, then a husk appears)`, runs, runs.map((r) => r.note).join(" || "));
  },

  /** Every part at 0: a minute of ordinary life, to see the bot plays as it did before Step Two. */
  async all_off() {
    const runs = await times(async () => {
      await homestead();
      const ticks: Chosen[] = await play(async () => void (await sleep(45_000)), { whole: true, settings: { selection: ALL_OFF } });
      const extra = ticks.filter((t) => t.selection?.conflicts || t.selection?.channels || t.regions.some((r) => r.region === "striatum") || t.signals.conflict || t.signals.habit).length;
      return { ticks, ok: extra === 0, note: `${ticks.length} ticks, ${extra} with any sign of waiting, channels or habits` };
    }, Math.min(RUNS, 2));
    return row("all parts at 0 (ordinary life, Jev on)", runs);
  },
};

const names = wanted.length ? wanted : Object.keys(scenes);
const unknown = names.filter((name) => !scenes[name]);
if (unknown.length) {
  console.error(`Unknown scene(s): ${unknown.join(", ")}. Use: ${Object.keys(scenes).join(", ")}`);
  process.exit(1);
}
const rows: Row[] = [];
for (const name of names) {
  console.log(`=== ${name} (${RUNS} runs)`);
  try {
    const out = await scenes[name]!();
    rows.push(out);
    console.log(`    ${out.problem ? `PROBLEM: ${out.problem}` : "no problem seen"}`);
  } catch (error) {
    rows.push({ scene: name, won: "", waits: "", habit: "", outcome: "", problem: `the scene broke: ${error instanceof Error ? error.message : error}` });
    console.log(`    BROKE: ${error instanceof Error ? error.message : error}`);
  }
}
rcon(`tp ${BOT} -8 69 14`);
console.log("\nscene | who won, and by which term | waits | habit share | outcome");
for (const r of rows) console.log(`${r.scene} | ${r.won} | ${r.waits} | ${r.habit} | ${r.outcome}${r.problem ? ` PROBLEM: ${r.problem}` : ""}`);
const problems = rows.filter((r) => r.problem);
console.log(`\n${rows.length} scenes, ${RUNS} runs each; ${problems.length} showed a problem${problems.length ? `: ${problems.map((r) => r.scene).join(", ")}` : ""}.`);
