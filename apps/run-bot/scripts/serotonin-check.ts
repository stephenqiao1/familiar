// Live check of serotonin (patience) on the test server: what patience follows, and what it then
// does to the choice of action, in situations the unit tests only imagine. Each scene runs the
// real bot and reports what its own tick log says; a scene is marked a PROBLEM when the numbers
// show patience doing the wrong thing, not when the run breaks.
// No Jev and no planner calls: only the reflexes and typed commands act.
// Needs the server container (MC_CONTAINER, default familiar-m6).
//   pnpm serotonin-check [scene ...]
import { rcon, sleep } from "./primitive-check/world.ts";
import { after, between, BOT, freshPlaza, n, play, runScenes, type Row, type Tick } from "./live.ts";

/** Long enough for patience to settle on the outlook of a quiet day (its time constant is a minute). */
const CALM_MS = 45_000;

interface Serotonin {
  patience?: number;
  outlook?: number | null;
  needs?: Record<string, number>;
  persistence?: { skill: string; waitedSeconds: number; giveUpSeconds: number; stayBonus: number; progress?: number } | null;
}
const serotonin = (t: Tick) => (t.regions.find((r) => r.region === "serotonin")?.trace ?? {}) as Serotonin;
const patience = (t: Tick | undefined) => (t ? (serotonin(t).patience ?? NaN) : NaN);
/** A threat that can get to the bot is within 8 blocks. */
const threatened = (t: Tick) => (t.state.data.nearby?.mobs ?? []).some((m) => m.hostile && m.reachable && m.dist < 8);
/** What the arbiter multiplied the winner's score by, from its reason ("scaled ×0.87"); 1 if it says nothing. */
const scaleOf = (t: Tick) => Number(/scaled ×([\d.]+)/.exec(t.winner?.reason ?? "")?.[1] ?? 1);

const scenes: Record<string, () => Promise<Row>> = {
  /** 1. A quiet spell, then a husk walks up: patience should fall while danger presses, not sit where the calm left it. */
  async threat() {
    await freshPlaza();
    let appeared = 0;
    const ticks = await play(async () => {
      await sleep(CALM_MS);
      appeared = Date.now();
      rcon("summon husk 66.5 151 40.5 {IsBaby:0b}");
      await sleep(8000);
    });
    const calm = patience(between(ticks, appeared - 2000, appeared).at(-1));
    const pressed = after(ticks, appeared + 1000).filter(threatened);
    const high = pressed.filter((t) => patience(t) >= 0.5);
    return {
      scene: "threat",
      saw: `after ${CALM_MS / 1000} s of calm patience was ${n(calm)}; a husk then pressed on ${pressed.length} ticks (from 1 s after it appeared): patience ${n(patience(pressed[0]))} → ${n(patience(pressed.at(-1)))}, lowest ${n(Math.min(...pressed.map(patience)))}`,
      problem: pressed.length > 0 && high.length > pressed.length / 2 ? `patience stayed at 0.5 or more on ${high.length} of ${pressed.length} ticks with a threat pressing` : "",
    };
  },

  /** 2. Armed, a husk on it: the defence circuit fights. Patience should not hold a reflex's fight back. */
  async armed() {
    await freshPlaza();
    let appeared = 0;
    const ticks = await play(async () => {
      rcon(`give ${BOT} stone_sword`);
      await sleep(CALM_MS);
      appeared = Date.now();
      rcon("summon husk 62.5 151 40.5 {IsBaby:0b}");
      await sleep(8000);
    });
    const fights = after(ticks, appeared).filter((t) => t.winner?.action.skill === "attack" && t.winner.region === "reflex");
    const held = fights.filter((t) => scaleOf(t) < 1);
    return {
      scene: "armed",
      saw: `patience ${n(patience(between(ticks, appeared - 2000, appeared).at(-1)))} when the husk appeared; the fight reflex won ${fights.length} ticks, scaled down on ${held.length} of them (to ×${n(Math.min(1, ...fights.map(scaleOf)))} at the least)`,
      problem: held.length > 0 ? `patience held back the defence circuit's own fight on ${held.length} ticks` : fights.length === 0 ? "the bot never fought" : "",
    };
  },

  /** 3. Standing idle, then a walk: a skill getting nowhere should lose its protection within seconds; one covering ground should keep it. */
  async nowhere() {
    await freshPlaza();
    let idled = 0;
    let walked = 0;
    const ticks = await play(async ({ say }) => {
      await sleep(3000);
      idled = Date.now();
      say("do idle");
      await sleep(20_000);
      walked = Date.now();
      say("do go_to pos:78,151,40");
      await sleep(5000);
    });
    const status = (t: Tick | undefined, skill: string) => (t && serotonin(t).persistence?.skill === skill ? serotonin(t).persistence! : undefined);
    const idleAt = (s: number) => status(between(ticks, idled, walked).find((t) => t.timestamp >= idled + s * 1000), "idle")?.stayBonus ?? NaN;
    const walking = after(ticks, walked).map((t) => status(t, "go_to")).filter((x) => x !== undefined);
    const least = Math.min(...walking.map((x) => x.stayBonus));
    return {
      scene: "nowhere",
      saw: `idle: stay bonus at 2 s ${n(idleAt(2), 3)}, at 10 s ${n(idleAt(10), 3)}, at 18 s ${n(idleAt(18), 3)} | a walk of 18 blocks: stay bonus never below ${n(least, 3)} over ${walking.length} ticks`,
      problem: [idleAt(18) > 0.02 ? `idling for 18 s still had a stay bonus of ${n(idleAt(18), 3)}` : "", walking.length > 3 && least < 0.1 ? `a walk covering ground had its stay bonus fall to ${n(least, 3)}` : "", walking.length <= 3 ? "the walk never ran" : ""].filter(Boolean).join("; "),
    };
  },

  /** 4. Starving by day with nothing else wrong: the outlook should be bad, not the average of one bad thing and four good ones. */
  async starving() {
    await freshPlaza();
    let hungry = 0;
    const ticks = await play(async () => {
      await sleep(5000);
      rcon(`effect clear ${BOT}`);
      rcon(`effect give ${BOT} hunger 30 255 true`);
      hungry = Date.now();
      await sleep(25_000);
    });
    const empty = after(ticks, hungry).filter((t) => t.state.data.self.food <= 2);
    const last = empty.at(-1);
    const inputs = last ? Object.entries(serotonin(last).needs ?? {}).filter(([, v]) => v > 0).map(([name, v]) => `${name} ${n(v)}`).join(", ") : "";
    return {
      scene: "starving",
      saw: `food bar at 2 or less on ${empty.length} ticks, no food carried: outlook ${n(last ? (serotonin(last).outlook ?? NaN) : NaN)} (${inputs}), patience ${n(patience(last))}`,
      problem: last && (serotonin(last).outlook ?? 0) > 0.5 ? `starving with no food, the outlook still read ${n(serotonin(last).outlook ?? NaN)}` : empty.length === 0 ? "the bot never got hungry" : "",
    };
  },

  /** 5. Idling with nothing to show for it: is it ever given up on, and when? (About three minutes.) */
  async give_up() {
    await freshPlaza();
    let started = 0;
    const ticks = await play(async ({ say }) => {
      await sleep(3000);
      started = Date.now();
      say("do idle");
      await sleep(200_000);
    });
    const ends = after(ticks, started).flatMap((t) => (t.skillEvents ?? []).filter((e) => e.skill === "idle" && e.type !== "started").map((e) => ({ ...e, at: t.timestamp })));
    const end = ends[0];
    return {
      scene: "give up",
      saw: end ? `idle ended as ${end.type} after ${n((end.at - started) / 1000, 0)} s (${end.reason ?? "no reason given"}); patience then ${n(patience(ticks.find((t) => t.timestamp >= end.at)))}` : "idle was still running after 200 s",
      problem: !end ? "a skill with nothing to show for it was never given up on in 200 s" : "",
    };
  },
};

await runScenes(scenes);
