// The cerebellum's live scenes with its readers on: each teaches the real bot something by
// practice, then changes one thing and looks at what the models said, what happened, how the
// error went over the tries, and who read it.
//   pnpm cerebellum-check pace late giveup mismatch newtool expectations
import { rcon, sleep } from "./primitive-check/world.ts";
import { BOT, freshPlaza, n, play, traceOf, type Row, type Tick } from "./live.ts";
import { digs, ground, laps, LANE, put, repeat, Y, type Say } from "./cerebellum-check-ground.ts";

interface Run {
  movement: string;
  key: string;
  cutShort?: boolean;
  mismatch?: number;
  missing?: string[];
  measures: { measure: string; predicted: number | null; from: string | null; actual: number; error: number | null }[];
  today?: { seconds?: number; late?: boolean; estimateSeconds?: number; asExpected?: boolean; expects?: string[]; used?: { late?: boolean; estimateSeconds?: number; lateAfterSeconds?: number; expects?: string[]; why?: string } };
}
type Own = { runs?: Run[]; mismatch?: number; behind?: number };
const runsOf = (ticks: Tick[], movement: string) => ticks.flatMap((t) => (traceOf<Own>(t, "cerebellum").runs ?? []).filter((r) => r.movement === movement));
const seconds = (r: Run) => r.measures.find((m) => m.measure === "seconds");
const errors = (rs: Run[]) => rs.map((r) => (seconds(r)?.error == null ? "-" : n(seconds(r)!.error!))).join(" ");
/** Who read the mismatch signal: focus by its input, alarm by its rise from the tick before the signal came up. */
function readBy(ticks: Tick[]): string {
  const first = ticks.findIndex((t) => (t.signals.mismatch?.value ?? 0) > 0);
  if (first < 1) return "nobody (the signal never came up)";
  const up = ticks.filter((t) => (t.signals.mismatch?.value ?? 0) > 0);
  const focus = up.filter((t) => (traceOf<{ inputs?: Record<string, number> }>(t, "acetylcholine").inputs?.mismatch ?? 0) > 0).length;
  const alarm = Math.max(...ticks.slice(first, first + 6).map((t) => t.signals.alarm?.value ?? 0)) - (ticks[first - 1]!.signals.alarm?.value ?? 0);
  return `mismatch up on ${up.length} ticks (peak ${n(Math.max(...up.map((t) => t.signals.mismatch!.value)))}); focus read it on ${focus}; alarm rose by ${n(alarm)}`;
}
async function start(): Promise<void> {
  await freshPlaza();
  for (const command of ["difficulty easy", "time set 1000", "weather clear", "gamerule random_tick_speed 0"]) rcon(command);
}
const row = (scene: string, predicted: string, actual: string, overTime: string, read: string, problem: string): Row => ({ scene, saw: `predicted: ${predicted} | actual: ${actual} | error over time: ${overTime} | read by: ${read}`, problem });
const at = (x: number) => `pos:${x},${Y},${LANE.z}`;

export const readerScenes: Record<string, () => Promise<Row>> = {
  /** 1. The journey's estimate comes from the learned pace on the ground it starts on. */
  async pace() {
    await start();
    const ticks = await play(async (bot) => {
      ground("stone");
      put(LANE.from);
      await sleep(1500);
      await laps(bot, 10, 8);
    });
    const journeys = runsOf(ticks, "journey:goTo").filter((r) => !r.cutShort && r.today?.used && r.today.seconds !== undefined);
    const learned = journeys.filter((r) => Math.abs(r.today!.used!.estimateSeconds! - r.today!.estimateSeconds!) > 0.001);
    const off = (rs: Run[], by: (r: Run) => number) => rs.reduce((sum, r) => sum + Math.abs(by(r) - r.today!.seconds!), 0) / Math.max(1, rs.length);
    const last = learned.at(-1);
    return row(
      "1 pace (ten crossings of 24 blocks of stone)",
      last ? `estimate ${n(last.today!.used!.estimateSeconds!, 1)} s by the learned pace (fixed speed: ${n(last.today!.estimateSeconds!, 1)} s)` : "no estimate from a learned pace",
      last ? `${n(last.today!.seconds!, 1)} s` : "-",
      `learned estimates off by ${n(off(learned, (r) => r.today!.used!.estimateSeconds!))} s on average, the fixed ones by ${n(off(learned, (r) => r.today!.estimateSeconds!))} s, over ${learned.length} of ${journeys.length} journeys`,
      "the locomotion controller (estimate)",
      learned.length < 3 ? `only ${learned.length} journeys had an estimate from the learned pace` : "",
    );
  },

  /** 2. A journey held up is late by the learned pace before it is late by the fixed rule, and is behind its pace meanwhile. */
  async late() {
    await start();
    const ticks = await play(async (bot) => {
      ground("stone");
      put(LANE.from);
      await sleep(1500);
      await laps(bot, 8, 8);
      // The ninth crossing: a wall across the lane for a few seconds, then gone.
      bot.say(`do go_to ${at(LANE.to)}`);
      await sleep(1200);
      rcon(`fill 56 ${Y} 34 56 ${Y + 2} 46 obsidian`);
      await sleep(2500);
      rcon(`fill 56 ${Y} 36 56 ${Y + 2} 44 air`);
      await sleep(9000);
      rcon(`fill 56 ${Y} 34 56 ${Y + 2} 46 air`);
      for (const wall of [`39 ${Y} 35 81 ${Y + 2} 35`, `39 ${Y} 45 81 ${Y + 2} 45`]) rcon(`fill ${wall} glass`);
    });
    const journeys = runsOf(ticks, "journey:goTo").filter((r) => r.today?.used);
    const held = journeys.at(-1);
    const before = journeys.slice(0, -1);
    const behind = ticks.filter((t) => traceOf<Own>(t, "cerebellum").behind).length;
    const problem = !held || held.today?.seconds === undefined ? "the held-up journey did not finish" : !held.today!.used!.late ? "the held-up journey was not called late" : before.some((r) => r.today!.used!.late) ? "an ordinary crossing was called late" : behind === 0 ? "it was never behind its pace while held up" : "";
    return row(
      "2 late (eight crossings, then one held up by a wall for 2.5 s)",
      held ? `late after ${n(held.today!.used!.lateAfterSeconds!, 1)} s by the learned pace (fixed rule: after ${n(2 * held.today!.estimateSeconds!, 1)} s)` : "-",
      held?.today?.seconds !== undefined ? `${n(held.today.seconds, 1)} s: late by the rule used ${held.today!.used!.late}, by the fixed rule ${held.today!.late}` : "-",
      `ordinary crossings called late: ${before.filter((r) => r.today!.used!.late).length} of ${before.length}`,
      `locomotion (late); behind its pace on ${behind} ticks; ${readBy(ticks)}`,
      problem,
    );
  },

  /** 3. The give-up clock starts from the skill's own usual time. */
  async giveup() {
    await start();
    let asked = 0;
    const ticks = await play(async (bot) => {
      ground("stone");
      put(59);
      await sleep(1500);
      await digs(bot, "dirt", 7, 2.5);
      // A block that will not break by hand in any time worth waiting.
      rcon(`setblock 61 ${Y} ${LANE.z} obsidian`);
      await sleep(400);
      asked = Date.now();
      bot.say(`do break_block ${at(61)}`);
      await sleep(75_000);
      rcon(`setblock 61 ${Y} ${LANE.z} air`);
    });
    const ended = ticks.flatMap((t) => (t.skillEvents ?? []).filter((e) => e.skill === "break_block" && e.type !== "started" && t.timestamp >= asked + 3000).map((e) => ({ ...e, after: (t.timestamp - asked) / 1000 })))[0];
    const status = ticks.filter((t) => t.timestamp >= asked + 2000).map((t) => traceOf<{ persistence?: { skill: string; baseSeconds?: number; giveUpSeconds?: number } }>(t, "serotonin").persistence).find((p) => p?.skill === "break_block");
    const usual = runsOf(ticks, "skill:break_block").filter((r) => seconds(r));
    const problem = status?.baseSeconds === undefined ? "the clock's base was not logged" : status.baseSeconds >= 120 ? "the base stayed at the fixed 2 minutes" : !ended?.reason?.startsWith("gave up") ? `the dig was not given up on (${ended ? `${ended.type}: ${ended.reason ?? ""}` : "still running after 75 s"})` : "";
    return row(
      "3 give-up (seven digs of dirt, then obsidian by hand)",
      `base ${n(status?.baseSeconds ?? NaN, 0)} s from a usual ${n(usual.at(-1) ? seconds(usual.at(-1)!)!.actual : NaN, 1)} s (fixed: 120 s); give up after ${n(status?.giveUpSeconds ?? NaN, 0)} s at this patience`,
      ended ? `${ended.type} after ${n(ended.after, 0)} s (${ended.reason ?? "no reason"})` : "still digging after 75 s",
      `the skill's time, dig by dig: ${usual.map((r) => n(seconds(r)!.actual, 1)).join(" ")}`,
      "serotonin's give-up clock",
      problem,
    );
  },

  /** 4. A movement in a known situation that comes out far from its prediction raises `mismatch` at once. */
  async mismatch() {
    await start();
    let slowed = 0;
    const ticks = await play(async (bot) => {
      ground("stone");
      put(59);
      await sleep(1500);
      await digs(bot, "dirt", 7, 2.5);
      // The same block with the same bare hand, but the arm is slowed: nothing in the situation key says so.
      rcon(`effect give ${BOT} mining_fatigue 30 0 true`);
      await sleep(1000);
      slowed = Date.now();
      await digs(bot, "dirt", 2, 9);
    });
    const digsDone = runsOf(ticks, "primitive:break_block");
    const wrong = digsDone.filter((r) => r.mismatch);
    const afterSlow = ticks.filter((t) => t.timestamp >= slowed);
    const early = ticks.filter((t) => t.timestamp < slowed && (t.signals.mismatch?.value ?? 0) >= 0.5).length;
    const problem = !wrong.length ? "no dig was a mismatch" : early ? `mismatch was large on ${early} ticks before anything was changed` : !afterSlow.some((t) => (traceOf<{ inputs?: Record<string, number> }>(t, "acetylcholine").inputs?.mismatch ?? 0) > 0) ? "focus did not read it" : "";
    return row(
      "4 mismatch (seven digs of dirt by hand, then two with a slowed arm)",
      wrong[0] ? `${n(seconds(wrong[0])?.predicted ?? NaN)} s (from ${seconds(wrong[0])?.from})` : "-",
      wrong[0] ? `${n(seconds(wrong[0])?.actual ?? NaN)} s: mismatch ${n(wrong[0].mismatch!)}` : "-",
      errors(digsDone),
      readBy(afterSlow.length ? ticks.slice(Math.max(0, ticks.indexOf(afterSlow[0]!) - 1)) : ticks),
      problem,
    );
  },

  /** 5. A new tool: the first dig is far from what the block alone predicts, then the tool's own model takes over. */
  async newtool() {
    await start();
    let swapped = 0;
    const ticks = await play(async (bot) => {
      ground("stone");
      put(59);
      await sleep(1500);
      rcon(`give ${BOT} wooden_pickaxe 1`);
      await repeat(bot, "do equip item:wooden_pickaxe", 1, 1.5);
      await digs(bot, "stone", 7, 3);
      rcon(`give ${BOT} iron_pickaxe 1`);
      await repeat(bot, "do equip item:iron_pickaxe", 1, 1.5);
      swapped = Date.now();
      await digs(bot, "stone", 8, 2.2);
    });
    const iron = ticks.filter((t) => t.timestamp >= swapped).flatMap((t) => (traceOf<Own>(t, "cerebellum").runs ?? []).filter((r) => r.movement === "primitive:break_block" && r.key.includes("iron")));
    const [first, last] = [iron[0], iron.at(-1)];
    const problem = !first || !last ? "no dig with the new tool" : !first.mismatch ? "the first dig with the new tool was no mismatch" : last.mismatch ? "the last dig with the new tool was still a mismatch" : seconds(last)?.from !== "stone|iron_pickaxe" ? `the tool's own model was not used by the end (from ${seconds(last)?.from})` : "";
    return row(
      "5 new tool (seven digs of stone with a wooden pickaxe, then eight with an iron one)",
      first ? `first ${n(seconds(first)?.predicted ?? NaN)} s (from ${seconds(first)?.from}); last ${n(seconds(last!)?.predicted ?? NaN)} s (from ${seconds(last!)?.from})` : "-",
      first ? `first ${n(seconds(first)?.actual ?? NaN)} s (mismatch ${n(first.mismatch ?? 0)}); last ${n(seconds(last!)?.actual ?? NaN)} s (mismatch ${n(last!.mismatch ?? 0)})` : "-",
      errors(iron),
      readBy(ticks.filter((t) => t.timestamp >= swapped - 1000)),
      problem,
    );
  },

  /** 7. Learned expectations: an empty list filled in, and a written one replaced only where experience disagrees. */
  async expectations() {
    await start();
    let low = 0;
    const ticks = await play(async (bot) => {
      ground("stone");
      put(59, -90, 20);
      await sleep(1500);
      // A jump has no written expectation. In the open it always moves the body; then under a low roof it cannot.
      await repeat(bot, "do jump", 7, 1.2);
      rcon(`setblock 59 ${Y + 2} ${LANE.z} stone`);
      await sleep(500);
      low = Date.now();
      await repeat(bot, "do jump", 2, 1.2);
      rcon(`setblock 59 ${Y + 2} ${LANE.z} air`);
      // A hit is written to hurt its target. A pig that cannot be hurt, then a cow that can.
      rcon(`summon pig 61 ${Y} ${LANE.z} {NoAI:1b,Silent:1b,Invulnerable:1b}`);
      await sleep(1000);
      await repeat(bot, "do hit nearest:pig", 8, 1.2);
      rcon("kill @e[type=pig,distance=..200]");
      rcon(`tp @e[type=pig] 0 -200 0`);
      rcon(`summon cow 61 ${Y} ${LANE.z} {NoAI:1b,Silent:1b,Health:200f,attributes:[{id:"minecraft:max_health",base:200}]}`);
      await sleep(1000);
      await repeat(bot, "do hit nearest:cow", 3, 1.2);
    });
    const jumps = runsOf(ticks, "primitive:jump");
    const open = jumps.filter((r) => r.today?.used?.expects && r.today.asExpected);
    const underRoof = ticks.filter((t) => t.timestamp >= low).flatMap((t) => (traceOf<Own>(t, "cerebellum").runs ?? []).filter((r) => r.movement === "primitive:jump")).slice(0, 2);
    const hits = runsOf(ticks, "primitive:hit");
    const pig = hits.filter((r) => r.key.startsWith("pig"));
    const cow = hits.filter((r) => r.key.startsWith("cow"));
    const replaced = pig.filter((r) => r.today?.used?.why?.includes("targetHurt"));
    const problem = !open.length
      ? "no jump was checked against a learned expectation"
      : !underRoof.some((r) => r.today?.used && r.today.asExpected === false)
        ? `a jump under a low roof was not marked as not expected (${underRoof.map((r) => `asExpected ${r.today?.asExpected}`).join(", ") || "none ran"})`
        : !replaced.length
          ? "the written expectation of a hit was not replaced for the pig that cannot be hurt"
          : !replaced.at(-1)!.today!.asExpected
            ? "a hit on the pig was still marked not as expected after the list was replaced"
            : cow.some((r) => r.today?.used)
              ? "the written expectation was replaced for the cow too"
              : "";
    return row(
      "7 expectations (jumps in the open then under a low roof; hits on a pig that cannot be hurt, then a cow)",
      `jump: ${open[0]?.today?.used?.expects?.join(", ") ?? "-"} (${open[0]?.today?.used?.why ?? "written list"}); hit on the pig: ${replaced[0]?.today?.used?.expects?.join(", ") || "nothing"} (${replaced[0]?.today?.used?.why ?? "written list"})`,
      `jumps as expected in the open ${open.length} of ${jumps.length - underRoof.length}, under the roof ${underRoof.filter((r) => r.today?.asExpected).length} of ${underRoof.length}; hits on the pig as expected ${pig.filter((r) => r.today?.asExpected).length} of ${pig.length} (${replaced.length} by the learned list), on the cow ${cow.filter((r) => r.today?.asExpected).length} of ${cow.length} by the written list`,
      `pig hits as expected, hit by hit: ${pig.map((r) => (r.today?.asExpected ? "yes" : "no")).join(" ")}`,
      `the primitives' check of what they did; ${readBy(ticks.filter((t) => t.timestamp >= low - 1000))}`,
      problem,
    );
  },
};
export type { Say };
