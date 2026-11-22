// Live check of acetylcholine (focus) on the test server: what focus follows, and how fast the
// bot then learns, in situations the unit tests only imagine. Each scene runs the real bot and
// reports what its own tick log says; a scene is marked a PROBLEM when the numbers show focus or
// learning going by a label where the evidence says otherwise, not when the run breaks.
// No Jev and no planner calls: only the reflexes, dopamine's wants and typed commands act.
// Needs the server container (MC_CONTAINER, default familiar-m6).
//   pnpm acetylcholine-check [scene ...]
import { rcon, sleep } from "./primitive-check/world.ts";
import { after, between, BOT, freshPlaza, HOME, n, play, runScenes, traceOf, type Row, type Tick } from "./live.ts";

const CHEST = "74 151 40";
const CHEST_ID = `pos:${CHEST.split(" ").join(",")}`;
const WANTS_BREAD = { goal: "Carry sixteen bread.", steps: [], reason: "", wants: [{ item: "bread", count: 16 }] };
const PLAN_ARRIVES_MS = 17_000;

interface Focus {
  focus?: number;
  inputs?: Record<string, number>;
}
interface Episode {
  skill: string;
  ended: string;
  surprise: number;
  expected: number;
  /** The share of the full learning step this run was learned at (absent: in full). */
  attention?: number;
}
interface Dopamine {
  episodes?: Episode[];
  learnedOutsideWindow?: boolean;
}
const focusOf = (t: Tick | undefined) => (t ? (traceOf<Focus>(t, "acetylcholine").focus ?? NaN) : NaN);
const inputsOf = (t: Tick | undefined) => (t ? Object.entries(traceOf<Focus>(t, "acetylcholine").inputs ?? {}).map(([name, v]) => `${name} ${n(v)}`).join(", ") : "");
const chest = (bread: number) => {
  rcon(`setblock ${CHEST} air`);
  rcon(`setblock ${CHEST} chest`);
  if (bread > 0) rcon(`item replace block ${CHEST} container.0 with bread ${bread}`);
};
const shortAgain = async () => {
  rcon(`tp ${BOT} ${HOME}`);
  rcon(`clear ${BOT} bread`);
  await sleep(600);
};
/** The take_items runs that ended in these ticks, each with how it was learned. */
const trips = (ticks: Tick[]) =>
  ticks.flatMap((t) => {
    const trace = traceOf<Dopamine>(t, "dopamine");
    return (trace.episodes ?? []).filter((e) => e.skill === "take_items").map((e) => ({ ...e, slowed: trace.learnedOutsideWindow === true || (e.attention ?? 1) < 1 }));
  });

const scenes: Record<string, () => Promise<Row>> = {
  /** 1. The same quiet place, standing idle by day and then by night: nothing about what the bot knows differs, so focus should not. (The dark is a need; patience and alarm follow it.) */
  async day_or_night() {
    await freshPlaza();
    let dusk = 0;
    const ticks = await play(async ({ say }) => {
      await sleep(3000);
      say("do idle");
      await sleep(40_000);
      dusk = Date.now();
      rcon("time set 18000");
      await sleep(40_000);
    });
    rcon("time set 1000");
    const [day, night] = [between(ticks, 0, dusk).at(-1), ticks.at(-1)];
    return {
      scene: "day or night",
      saw: `after 40 s idle by day: focus ${n(focusOf(day))} (${inputsOf(day)}) | after 40 s more in the dark: focus ${n(focusOf(night))} (${inputsOf(night)})`,
      problem: Math.abs(focusOf(night) - focusOf(day)) > 0.08 ? `focus moved by ${n(Math.abs(focusOf(night) - focusOf(day)))} when night fell, with nothing it knows any different` : "",
    };
  },

  /** 2. A chest the bot has learned is emptied behind its back, twice: its predictions are failing, and focus should say so. */
  async let_down() {
    await freshPlaza();
    chest(64);
    let emptied = 0;
    const ticks = await play(
      async ({ say }) => {
        await sleep(PLAN_ARRIVES_MS);
        // Two trips by hand and one of its own: 48 of the 64 bread taken, so it remembers the chest as still holding some.
        for (let i = 0; i < 2; i++) {
          say(`do take_items ${CHEST_ID}`);
          await sleep(8000);
          await shortAgain();
        }
        await sleep(8000);
        chest(0);
        emptied = Date.now();
        for (let i = 0; i < 2; i++) {
          await shortAgain();
          say(`do take_items ${CHEST_ID}`);
          await sleep(9000);
        }
        await sleep(6000);
      },
      { plan: WANTS_BREAD },
    );
    const [before, end] = [between(ticks, emptied - 2000, emptied).at(-1), ticks.at(-1)];
    const then = trips(after(ticks, emptied));
    const peak = Math.max(...after(ticks, emptied).map(focusOf));
    return {
      scene: "let down",
      saw: `before the chest was emptied: focus ${n(focusOf(before))} (${inputsOf(before)}) | after ${then.length} trips that found nothing (surprises ${then.map((e) => n(e.surprise)).join(", ")}): focus ${n(focusOf(end))}, highest ${n(peak)} (${inputsOf(end)})`,
      problem: then.length === 0 ? "it never went to the emptied chest" : peak - focusOf(before) < 0.05 ? `its predictions failed ${then.length} times and focus rose by only ${n(peak - focusOf(before))}` : "",
    };
  },

  /** 3. Trips cut short one after another, with nothing notable happening: each should be learned from by how surprising it was, not at a flat fifth of the rate. */
  async quiet_learning() {
    await freshPlaza();
    chest(64);
    const start = "42.5 151 40.5 -90 0";
    let from = 0;
    const ticks = await play(
      async ({ say }) => {
        await sleep(PLAN_ARRIVES_MS);
        for (let i = 0; i < 2; i++) {
          say(`do take_items ${CHEST_ID}`);
          await sleep(8000);
          await shortAgain();
        }
        await sleep(8000);
        rcon(`clear ${BOT} bread`);
        rcon(`tp ${BOT} ${start}`);
        await sleep(600);
        from = Date.now();
        for (let i = 0; i < 6; i++) {
          say(`do take_items ${CHEST_ID}`);
          await sleep(1500);
          say("stop");
          await sleep(1200);
          rcon(`tp ${BOT} ${start}`);
          await sleep(600);
        }
      },
      { plan: WANTS_BREAD },
    );
    const cut = trips(after(ticks, from));
    const slowed = cut.filter((e) => e.slowed);
    // A surprise of 0.3 or more is learned from in full; a smaller one in proportion (a fifth at none).
    const big = slowed.filter((e) => Math.abs(e.surprise) >= 0.3 || (e.attention ?? 0.2) < 0.2 + 0.8 * Math.min(1, Math.abs(e.surprise) / 0.3) - 0.05);
    return {
      scene: "quiet learning",
      saw: `${cut.length} trips cut short: surprises ${cut.map((e) => n(e.surprise)).join(", ")}; learned at a reduced rate: ${slowed.length} (${slowed.map((e) => n(e.attention ?? 0.2)).join(", ") || "none"}); expected ${cut.map((e) => n(e.expected)).join(" → ")}`,
      problem: cut.length === 0 ? "no trip was cut short" : big.length > 0 ? `${big.length} runs were learned from more slowly than their own surprise calls for` : "",
    };
  },
};

await runScenes(scenes);
