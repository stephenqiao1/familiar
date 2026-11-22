// Live check of noradrenaline (alarm and search) on the test server: what raises each, how long
// it lasts, and what it costs the bot meanwhile. Each scene runs the real bot and reports what
// its own tick log says; a scene is marked a PROBLEM when the numbers show alarm or search doing
// the wrong thing, not when the run breaks.
// No Jev and no planner calls: only the reflexes, dopamine's wants and typed commands act.
// Needs the server container (MC_CONTAINER, default familiar-m6).
//   pnpm noradrenaline-check [scene ...]
import { rcon, sleep } from "./primitive-check/world.ts";
import { after, between, BOT, freshPlaza, HOME, n, play, runScenes, traceOf, type Row, type Tick } from "./live.ts";

const CHEST = "74 151 40";
/** The echo planner's goal: enough to want bread from the chest. */
const WANTS_BREAD = { goal: "Carry sixteen bread.", steps: [], reason: "", wants: [{ item: "bread", count: 16 }] };
/** The fixed plan arrives with the planner's first run. */
const PLAN_ARRIVES_MS = 17_000;

interface Noradrenaline {
  alarm?: number;
  raisedBy?: Record<string, number>;
  search?: number;
  searchInputs?: Record<string, number>;
  interrupt?: boolean;
  plannerOffline?: boolean;
}
const noradrenaline = (t: Tick) => traceOf<Noradrenaline>(t, "noradrenaline");
const alarm = (t: Tick | undefined) => (t ? (noradrenaline(t).alarm ?? NaN) : NaN);
const hostile = (t: Tick) => (t.state.data.nearby?.mobs ?? []).some((m) => m.hostile);
const chest = (bread: number) => {
  rcon(`setblock ${CHEST} air`);
  rcon(`setblock ${CHEST} chest`);
  if (bread > 0) rcon(`item replace block ${CHEST} container.0 with bread ${bread}`);
};
/** Whether the chest (14 blocks from home, sensed within 16) is among the blocks the bot is told of. */
const seesChest = (t: Tick) => (t.state.data.nearby?.blocks ?? []).some((b) => b.type === "chest");
const chestInRange = (t: Tick) => Math.hypot(t.state.data.self.position.x - 74, t.state.data.self.position.z - 40) <= 15;

const scenes: Record<string, () => Promise<Row>> = {
  /** 1. A husk attacks for a few seconds and is then removed: alarm should go when the danger does, and nothing should be hidden meanwhile. */
  async after_threat() {
    await freshPlaza();
    chest(0);
    let appeared = 0;
    let gone = 0;
    const ticks = await play(async () => {
      await sleep(5000);
      appeared = Date.now();
      rcon("summon husk 64.5 151 40.5 {IsBaby:0b}");
      await sleep(6000);
      rcon("kill @e[type=husk]");
      gone = Date.now();
      await sleep(25_000);
    });
    const safe = after(ticks, gone + 500).filter((t) => !hostile(t));
    const calmAt = safe.find((t) => alarm(t) < 0.3);
    const high = safe.filter((t) => alarm(t) > 0.6);
    const hidden = safe.filter((t) => chestInRange(t) && !seesChest(t));
    const offline = safe.filter((t) => noradrenaline(t).plannerOffline);
    return {
      scene: "after threat",
      saw: `alarm peaked at ${n(Math.max(...between(ticks, appeared, gone).map(alarm)))} with the husk there | husk gone: alarm ${n(alarm(safe[0]))} at once, under 0.3 after ${calmAt ? n((calmAt.timestamp - gone) / 1000, 1) : "more than 25"} s; above 0.6 on ${high.length} of ${safe.length} ticks; the chest in range was hidden from the bot on ${hidden.length}; the planner was offline on ${offline.length}`,
      problem: [!calmAt || calmAt.timestamp - gone > 10_000 ? "alarm was still 0.3 or more ten seconds after the danger had gone" : "", hidden.length > 0 ? `with no threat about, a chest in range was hidden from the bot on ${hidden.length} ticks` : ""].filter(Boolean).join("; "),
    };
  },

  /** 2. The bot has a goal; a husk gives it a fright and is removed: the goal should still be there. */
  async goal_kept() {
    await freshPlaza();
    let appeared = 0;
    let gone = 0;
    const ticks = await play(
      async () => {
        await sleep(PLAN_ARRIVES_MS);
        appeared = Date.now();
        rcon("summon husk 62.5 151 40.5 {IsBaby:0b}");
        await sleep(4000);
        rcon("kill @e[type=husk]");
        gone = Date.now();
        await sleep(12_000);
      },
      { plan: WANTS_BREAD },
    );
    const had = between(ticks, appeared - 2000, appeared).some((t) => t.goal);
    const afterwards = after(ticks, appeared);
    const without = afterwards.filter((t) => !t.goal);
    const interrupts = afterwards.filter((t) => noradrenaline(t).interrupt).length;
    return {
      scene: "goal kept",
      saw: `a goal before the fright: ${had ? "yes" : "NO"}; alarm peaked at ${n(Math.max(...between(ticks, appeared, gone).map(alarm)))}, ${interrupts} interrupt(s); from the fright on, the bot had no goal on ${without.length} of ${afterwards.length} ticks${without.length ? ` (${n((without.at(-1)!.timestamp - without[0]!.timestamp) / 1000, 0)} s)` : ""}`,
      problem: !had ? "the bot had no goal to begin with" : without.length > 2 ? `a fright left the bot with no goal for ${n((without.at(-1)!.timestamp - without[0]!.timestamp) / 1000, 0)} s` : "",
    };
  },

  /** 3. A trip to a chest that has been emptied: a disappointment is a reason to try something else, not to brace. */
  async let_down() {
    await freshPlaza();
    chest(64);
    let emptied = 0;
    const ticks = await play(
      async ({ say }) => {
        await sleep(PLAN_ARRIVES_MS);
        for (let i = 0; i < 2; i++) {
          say(`do take_items pos:${CHEST.split(" ").join(",")}`);
          await sleep(8000);
          rcon(`tp ${BOT} ${HOME}`);
          rcon(`clear ${BOT} bread`);
          await sleep(600);
        }
        await sleep(8000); // short again, it fetches its bread by itself
        chest(0);
        rcon(`tp ${BOT} ${HOME}`);
        rcon(`clear ${BOT} bread`);
        emptied = Date.now();
        await sleep(15_000);
      },
      { plan: WANTS_BREAD },
    );
    // From a moment after the scene took its bread away (that is itself a need suddenly worse, and raises alarm a little).
    const then = after(ticks, emptied + 1500);
    const raised = then.flatMap((t) => Object.entries(noradrenaline(t).raisedBy ?? {}).map(([by, amount]) => `${by} ${n(amount)}`));
    const peak = raised.length ? Math.max(...then.map(alarm)) : 0;
    const search = then.map((t) => noradrenaline(t).search ?? NaN);
    const trips = after(ticks, emptied).flatMap((t) => (t.skillEvents ?? []).filter((e) => e.skill === "take_items" && e.type !== "started").map((e) => `${e.type}${e.reason ? ` (${e.reason})` : ""}`));
    return {
      scene: "let down",
      saw: `the chest emptied behind its back: trips ${trips.join(", ") || "none"}; alarm raised by ${raised.join(", ") || "nothing"} (to ${n(peak)}); search ${n(search[0]!)} → ${n(search.at(-1)!)}, highest ${n(Math.max(...search))}`,
      problem: [trips.length === 0 ? "it never went to the emptied chest" : "", peak > 0.2 ? `a disappointing trip raised alarm to ${n(peak)}` : ""].filter(Boolean).join("; "),
    };
  },

  /** 4. Starving, with no food and nothing it does helping, for a minute and a half: search should rise. */
  async stuck() {
    await freshPlaza();
    let hungry = 0;
    const ticks = await play(async ({ say }) => {
      await sleep(5000);
      rcon(`effect clear ${BOT}`);
      rcon(`effect give ${BOT} hunger 30 255 true`);
      hungry = Date.now();
      say("do idle");
      await sleep(90_000);
    });
    const starving = after(ticks, hungry).filter((t) => t.state.data.self.food <= 6);
    const search = starving.map((t) => noradrenaline(t).search ?? NaN);
    const inputs = Object.entries(noradrenaline(starving.at(-1) ?? ticks.at(-1)!).searchInputs ?? {}).map(([name, v]) => `${name} ${n(v)}`).join(", ");
    return {
      scene: "stuck",
      saw: `starving with nothing to eat for ${n(((starving.at(-1)?.timestamp ?? 0) - (starving[0]?.timestamp ?? 0)) / 1000, 0)} s: search ${n(search[0] ?? NaN)} → ${n(search.at(-1) ?? NaN)}, highest ${n(Math.max(...search))} (inputs at the end: ${inputs})`,
      problem: starving.length === 0 ? "the bot never got hungry" : Math.max(...search) < 0.6 ? `starving and getting nowhere, search never rose above ${n(Math.max(...search))}` : "",
    };
  },
};

await runScenes(scenes);
