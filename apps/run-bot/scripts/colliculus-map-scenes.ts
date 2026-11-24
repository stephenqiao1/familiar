// Live scenes for the colliculus's two-dimensional map: up and down, priority from wants, the
// brake, sky and ground, sight in the dark and the fast "something happened" signal. Run by
// `pnpm colliculus-check` after its own scenes (or by name). Reflexes only, no Jev, except
// `ground`, which asks Jev so as to see the line it is told.
import { rcon, sleep } from "./primitive-check/world.ts";
import { after, between, BOT, freshPlaza, HOME, n, play, type Tick } from "./live.ts";

export interface MapRow {
  scene: string;
  field: string;
  lean: string;
  won: string;
  defence: string;
  problem: string;
}

interface Won {
  id: string;
  kind: string;
  why: string;
  field?: string;
  lean?: string;
  drawnBy?: string;
  jump?: { sideways: number; upDown: number };
  salience: number;
}
interface Top {
  id: string;
  kind: string;
  salience: number;
  light?: number;
  field?: string;
  boostFrom?: string;
  parts: Record<string, number>;
}
interface Colliculus {
  winner?: Won;
  top?: Top[];
  brake?: { stopped: string; kind: string; salience: number; needed: number; heldOn: string };
  released?: { id: string; worth: boolean; why: string };
  orienting?: number;
  lean?: string;
  worstMs?: number;
}
type Seen = Tick & { attended?: { id: string; kind: string; field?: string; lean?: string; since: number } | null };

const ALSO = { also: ["colliculus"] };
const CHEST = "64 151 40";
const CHEST_ID = "pos:64,151,40";
const WANTS_BREAD = { goal: "Carry sixteen bread.", steps: [], reason: "", wants: [{ item: "bread", count: 16 }] };
const PLAN_ARRIVES_MS = 17_000;
const col = (t: Tick) => (t.regions.find((r) => r.region === "colliculus")?.trace ?? {}) as Colliculus;
const data = (t: Tick) => t.state.data as unknown as { self: { position: { x: number; y: number; z: number }; gaze: { pitch?: number } }; defence?: { choice: { mode: string; why: string } }; nearby: { mobs: { id: string; type: string }[] } };
const wins = (ticks: Tick[]) => ticks.flatMap((t) => (col(t).winner ? [{ t, won: col(t).winner! }] : []));
const leans = (ticks: Tick[]) => [...new Set(ticks.flatMap((t) => ((t as Seen).attended?.lean ? [(t as Seen).attended!.lean!] : [])))];
const ended = (ticks: Tick[], skill: string) => ticks.flatMap((t) => t.skillEvents ?? []).filter((e) => e.skill === skill);
const describe = (w: Won | undefined) => (w ? `${w.kind} (${w.why}, salience ${n(w.salience)}${w.drawnBy ? `, drawn by a ${w.drawnBy} kind` : ""})` : "nothing");
const modes = (ticks: Tick[]) => [...new Set(ticks.map((t) => data(t).defence?.choice.mode ?? "?"))].join(" → ");
export const worstMapMs = (ticks: Tick[]) => Math.max(0, ...ticks.map((t) => col(t).worstMs ?? 0));
let worst = 0;
/** Runs a scene. The bot does not glance around (scanning 0), so what is in view is what the scene put there. */
const run = async (act: Parameters<typeof play>[0], options: Parameters<typeof play>[1] = {}) => {
  const given = (options.settings ?? {}) as { colliculus?: object };
  const ticks = await play(act, { ...ALSO, ...options, settings: { ...given, colliculus: { scanning: 0, ...given.colliculus } } });
  worst = Math.max(worst, worstMapMs(ticks));
  return ticks;
};
export const worstSeen = () => worst;

/** Moves the tagged thing along a list of places, one every `everyMs`. */
async function fly(tag: string, places: [number, number, number][], everyMs: number): Promise<void> {
  for (const [x, y, z] of places) {
    rcon(`tp @e[tag=${tag}] ${x.toFixed(2)} ${y.toFixed(2)} ${z.toFixed(2)}`);
    await sleep(everyMs);
  }
}
/** A chest with this many stacks of bread. */
function chest(stacks: number): void {
  rcon(`setblock ${CHEST} air`);
  rcon(`setblock ${CHEST} chest`);
  for (let slot = 0; slot < stacks; slot++) rcon(`item replace block ${CHEST} container.${slot} with bread 64`);
}
/** Two trips to the chest by hand, so the bot knows what it gives. */
async function learnChest(say: (command: string) => void, trips = 2, eachMs = 8000): Promise<void> {
  await sleep(PLAN_ARRIVES_MS);
  for (let i = 0; i < trips; i++) {
    say(`do take_items ${CHEST_ID}`);
    await sleep(eachMs);
    rcon(`tp ${BOT} ${HOME}`);
    rcon(`clear ${BOT} bread`);
    await sleep(1500);
  }
}

export const mapScenes: Record<string, () => Promise<MapRow>> = {
  /** 1. Overhead: something dives at the bot from above. It looks up, the lean is "avoid", and it makes for a roof instead of running in the open. */
  async overhead() {
    const arm = async (lean: number) => {
      await freshPlaza();
      // A roof seven blocks behind the bot.
      rcon("fill 52 154 39 54 154 41 stone");
      let dived = 0;
      const ticks = await run(
        async () => {
          rcon('summon phantom 72.5 164 40.5 {NoAI:1b,Silent:1b,PersistenceRequired:1b,Tags:["diver"],active_effects:[{id:"minecraft:fire_resistance",duration:20000,amplifier:0,show_particles:0b}]}');
          await sleep(4000);
          dived = Date.now();
          await fly("diver", Array.from({ length: 8 }, (_, i) => [72.5 - (i + 1), 164 - (i + 1), 40.5]), 100);
          await sleep(1500);
          rcon("kill @e[tag=diver]");
          await sleep(6000);
        },
        { settings: { defence: { lean } } },
      );
      const since = after(ticks, dived - 300);
      const up = wins(since).find((w) => w.won.field === "upper");
      const end = data(ticks.at(-1)!).self.position;
      return { ticks, since, up, lean: leans(since), cover: ended(since, "take_cover"), flee: ended(since, "flee"), end, underRoof: end.x >= 52 && end.x < 55 && end.z >= 39 && end.z < 42 };
    };
    const on = await arm(1);
    const off = await arm(0);
    const did = (a: Awaited<ReturnType<typeof arm>>) => `${a.cover.length ? "ran for cover" : a.flee.length ? "fled in the open" : "did not move"}; ended at x=${n(a.end.x, 0)}, ${a.underRoof ? "under the roof" : "in the open"}; defence ${modes(a.since)}`;
    return {
      scene: "overhead",
      field: on.up?.won.field ?? "none",
      lean: on.lean.join(", ") || "none",
      won: `${describe(on.up?.won)}; head pitch reached ${Math.max(...on.since.map((t) => data(t).self.gaze.pitch ?? 0))} degrees up`,
      defence: `lean taken: ${did(on)} | lean ignored: ${did(off)}`,
      problem: !on.up ? "it never looked up at the thing diving at it" : !on.lean.includes("avoid") ? "the dive from above gave no lean to avoid" : !on.cover.length ? "it did not make for cover" : !on.underRoof ? "it did not end under the roof" : off.cover.length ? "with the lean ignored it still made for cover" : "",
    };
  },

  /** 2. Circling: something crosses the sky without coming nearer (not a threat by kind). The lean is "freeze": it holds still and watches. */
  async circling() {
    const arm = async (lean: number) => {
      await freshPlaza();
      let began = 0;
      const ticks = await run(
        async () => {
          rcon('summon bat 68.2 165 34.1 {NoAI:1b,Silent:1b,PersistenceRequired:1b,Tags:["flyer"]}');
          await sleep(9000); // it is looked at when it appears; what was just looked at cannot win straight back
          began = Date.now();
          // An arc ten blocks out and fourteen up, always the same distance from the bot, at about five blocks a second.
          const arc = Array.from({ length: 14 }, (_, i) => ((-40 + i * 6) * Math.PI) / 180).map((a): [number, number, number] => [60.5 + 10 * Math.cos(a), 165, 40.5 + 10 * Math.sin(a)]);
          await fly("flyer", arc, 150);
          await fly("flyer", [...arc].reverse(), 150);
          await sleep(3000);
        },
        { settings: { defence: { lean } } },
      );
      const since = after(ticks, began - 300);
      const up = wins(since).find((w) => w.won.field === "upper");
      const start = data(since[0]!).self.position;
      const moved = Math.max(...since.map((t) => Math.hypot(data(t).self.position.x - start.x, data(t).self.position.z - start.z)));
      return { since, up, lean: leans(since), held: ended(since, "hold_still"), moved, pitch: Math.max(...since.map((t) => data(t).self.gaze.pitch ?? 0)) };
    };
    const on = await arm(1);
    const off = await arm(0);
    const did = (a: Awaited<ReturnType<typeof arm>>) => `${a.held.length ? "held still and watched" : "did nothing"} (moved ${n(a.moved, 1)} blocks, head up to ${a.pitch} degrees); defence ${modes(a.since)}`;
    return {
      scene: "circling",
      field: on.up?.won.field ?? "none",
      lean: on.lean.join(", ") || "none",
      won: describe(on.up?.won),
      defence: `lean taken: ${did(on)} | lean ignored: ${did(off)}`,
      problem: !on.up ? "it never looked up at the thing crossing the sky" : !on.lean.includes("freeze") ? "crossing the sky gave no lean to freeze" : !on.held.length ? "it did not hold still" : on.moved > 1 ? "it moved while it should have held still" : off.held.length ? "with the lean ignored it still held still" : "",
    };
  },

  /** 3. Ground: a small animal wandering close by with nothing pressing. The lean is "approach", the look is held longer, and Jev is told. A big one gets neither. */
  async ground() {
    const arm = async (animal: string, whole: boolean) => {
      await freshPlaza();
      let came = 0;
      const ticks = await run(
        async () => {
          rcon(`summon ${animal} 64.5 151 42.5 {NoAI:1b,Silent:1b,PersistenceRequired:1b,Tags:["walker"]}`);
          await sleep(7000); // it is looked at when it appears; then it starts to wander
          came = Date.now();
          // A slow walk across the view, about a block a second.
          await fly("walker", Array.from({ length: 16 }, (_, i) => [64.5, 151, 42.5 - 0.25 * (i + 1)]), 250);
          await sleep(whole ? 6000 : 3000);
        },
        whole ? { whole: true } : {},
      );
      const since = after(ticks, came) as Seen[];
      const look = wins(since).find((w) => w.won.kind === animal);
      // How long it was attended in one stretch, at the longest.
      let longest = 0;
      let from: number | null = null;
      for (const t of since) {
        const on = t.attended?.kind === animal;
        if (on && from === null) from = t.attended!.since;
        if (on && from !== null) longest = Math.max(longest, t.timestamp - from);
        if (!on) from = null;
      }
      const told = since.some((t) => JSON.stringify(t.regions.find((r) => r.region === "instinct")?.trace ?? "").includes("closer look"));
      return { since, look, lean: leans(since.filter((t) => t.attended?.kind === animal)), longest, told };
    };
    const small = await arm("chicken", true);
    const big = await arm("cow", false);
    return {
      scene: "ground",
      field: small.look?.won.field ?? "none",
      lean: `small: ${small.lean.join(", ") || "none"}; big: ${big.lean.join(", ") || "none"}`,
      won: `${describe(small.look?.won)}, held ${n(small.longest / 1000, 1)} s (the big one ${n(big.longest / 1000, 1)} s); Jev told: ${small.told ? "yes" : "no"}`,
      defence: `defence ${modes(small.since)}`,
      problem: !small.look ? "the small animal never drew a look" : !small.lean.includes("approach") ? "a small slow thing on the ground gave no lean to approach" : big.lean.includes("approach") ? "a big animal also gave the lean to approach" : small.longest <= 2100 ? "the look at the small animal was not held longer" : !small.told ? "Jev was not told it was worth a closer look" : "",
    };
  },

  /** 4. Hungry eye: out of bread, with no goal watching for anything, its eye goes first to the chest it learned gives bread. Stocked, it does not. (The pull itself is off, so only the eye moves.) */
  async hungry_eye() {
    await freshPlaza();
    chest(1);
    // Other still things as near: a bell and a cow.
    rcon("setblock 64 151 42 bell");
    rcon("summon cow 64.5 151 38.5 {NoAI:1b,Silent:1b,PersistenceRequired:1b}");
    let [stocked, short] = [0, 0];
    const ticks = await run(
      async ({ say }) => {
        await learnChest(say);
        rcon(`give ${BOT} bread 16`);
        await sleep(15_000); // long enough for what the trips left on the map to fade
        stocked = Date.now();
        await sleep(12_000);
        rcon(`clear ${BOT} bread`);
        short = Date.now();
        await sleep(12_000);
      },
      { plan: WANTS_BREAD, settings: { personality: { wanting: 0 } } },
    );
    const [fed, hungry] = [between(ticks, stocked, short), after(ticks, short)];
    const toChest = (part: Tick[]) => wins(part).filter((w) => w.won.id === CHEST_ID);
    const first = wins(hungry)[0];
    const boosted = (part: Tick[]) => part.filter((t) => (col(t).top ?? []).some((x) => x.id === CHEST_ID && x.boostFrom === "wanted")).length;
    return {
      scene: "hungry eye",
      field: first?.won.field ?? "none",
      lean: leans(hungry).join(", ") || "none",
      won: `out of bread: first look to ${describe(first?.won)}, ${n(((first?.t.timestamp ?? NaN) - short) / 1000, 1)} s after; the chest was boosted as wanted on ${boosted(hungry)} ticks | stocked: ${toChest(fed).length} looks at the chest, boosted on ${boosted(fed)} ticks`,
      defence: `defence ${modes(hungry)}`,
      problem: first?.won.id !== CHEST_ID ? "out of bread, its eye did not go to the chest first" : first.won.drawnBy !== "wanted" ? "the look at the chest was not drawn by a want" : toChest(fed).length > 0 || boosted(fed) > 0 ? "stocked, the chest still drew its eye" : "",
    };
  },

  /** 5. On task: walking to a far spot, a mild thing appearing to the side does not pull its head away; a hit does. With the brake off the mild thing does. */
  async on_task() {
    const arm = async (fixation: number) => {
      await freshPlaza();
      let [mild, hit] = [0, 0];
      const ticks = await run(
        async ({ say }) => {
          rcon(`tp ${BOT} 44.5 151 40.5 -90 0`);
          await sleep(1500);
          say("do go_to pos:78,151,40");
          await sleep(1500);
          mild = Date.now();
          rcon("summon pig 57.5 151 43.5 {NoAI:1b,Silent:1b,PersistenceRequired:1b}");
          await sleep(2500);
          hit = Date.now();
          rcon(`damage ${BOT} 1`);
          await sleep(4000);
        },
        { flags: ["--same-time"], settings: { colliculus: { fixation } } },
      );
      const during = between(ticks, mild, hit);
      const afterHit = after(ticks, hit);
      return { during, lookedAside: wins(during).filter((w) => w.won.kind !== "unknown" || w.won.why.startsWith("sight")), braked: during.flatMap((t) => (col(t).brake ? [col(t).brake!] : [])), touch: wins(afterHit).find((w) => w.won.why.startsWith("touch")) };
    };
    const on = await arm(1);
    const off = await arm(0);
    return {
      scene: "on task",
      field: on.touch?.won.field ?? "none",
      lean: "none",
      won: `brake on: the thing to the side drew ${on.lookedAside.length} looks (stopped by the brake on ${on.braked.length} ticks${on.braked[0] ? `: ${on.braked[0].kind} at ${n(on.braked[0].salience)}, needed ${n(on.braked[0].needed)}` : ""}); the hit drew ${describe(on.touch?.won)} | brake off: the thing to the side drew ${off.lookedAside.length} looks`,
      defence: `defence ${modes(on.during)}`,
      problem: on.lookedAside.length > 0 ? "a mild thing to the side pulled its head off the task" : !on.braked.length ? "the brake never had to stop anything (the scene shows nothing)" : !on.touch ? "a hit did not turn its head" : off.lookedAside.length === 0 ? "with the brake off the mild thing still drew no look (the scene shows nothing)" : "",
    };
  },

  /** 6. Dark: the same still thing four blocks off, by day and at night. Its salience in each. */
  async dark() {
    await freshPlaza();
    let [day, night] = [0, 0];
    const ticks = await run(async () => {
      rcon("summon cow 64.5 151 40.5 {NoAI:1b,Silent:1b,PersistenceRequired:1b}");
      await sleep(4000);
      day = Date.now();
      await sleep(5000);
      rcon("time set 18000");
      await sleep(3000);
      night = Date.now();
      await sleep(5000);
      rcon("time set 1000");
    });
    const cowIn = (part: Tick[]) => part.flatMap((t) => (col(t).top ?? []).filter((x) => x.kind === "cow"));
    const typical = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? NaN;
    const [byDay, byNight] = [cowIn(between(ticks, day, day + 5000)), cowIn(after(ticks, night))];
    const [sDay, sNight] = [typical(byDay.map((x) => x.parts.nearness ?? 0)), typical(byNight.map((x) => x.parts.nearness ?? 0))];
    return {
      scene: "dark",
      field: byDay[0]?.field ?? "none",
      lean: "none",
      won: `a still cow four blocks off: by day (light ${n(typical(byDay.map((x) => x.light ?? NaN)))}) it counts ${n(sDay)}; at night (light ${n(typical(byNight.map((x) => x.light ?? NaN)))}) ${n(sNight)}`,
      defence: `defence ${modes(ticks)}`,
      problem: !byDay.length || !byNight.length ? "the cow was not on the map" : !(sNight < sDay) ? "the still thing stood out no less at night" : "",
    };
  },

  /** 7. Learning: something appears just as a trip to the chest ends. The run is learned from in full; without the reader it is not. */
  async learning() {
    const arm = async (eventLearning: number) => {
      await freshPlaza();
      chest(3);
      let last = 0;
      const ticks = await run(
        async ({ say }) => {
          // A pig stands beside the chest from the start, so that the bot is used to it.
          rcon('summon pig 63.5 151 43.5 {NoAI:1b,Silent:1b,PersistenceRequired:1b,Tags:["mover"]}');
          // Six trips, so that one more goes about as expected and would be learned from only a little.
          // (Short of bread the bot fetches it by itself, at once: the typed trips only start it off.)
          await learnChest(say, 6, 3000);
          await sleep(3000);
          last = Date.now();
          // The pig suddenly moves; a moment later the bot is made short again and makes its trip.
          await fly("mover", [[63.5, 151, 43.0], [63.5, 151, 42.5], [63.5, 151, 42.0]], 150);
          await sleep(300);
          rcon(`tp ${BOT} ${HOME}`);
          rcon(`clear ${BOT} bread`);
          await sleep(5000);
        },
        { plan: WANTS_BREAD, settings: { focus: { eventLearning } } },
      );
      type Episode = { skill: string; outcome: number; surprise: number; attention?: number; noticed?: number; expected: number };
      const episodes = (part: Tick[]) => part.flatMap((t) => ((t.regions.find((r) => r.region === "dopamine")?.trace?.episodes as Episode[] | undefined) ?? []).filter((e) => e.skill === "take_items"));
      const final = episodes(after(ticks, last)).at(-1);
      const orienting = Math.max(0, ...after(ticks, last).map((t) => t.signals.orienting?.value ?? 0));
      return { final, before: episodes(between(ticks, 0, last)).at(-1), orienting };
    };
    const on = await arm(1);
    const off = await arm(0);
    const say = (a: Awaited<ReturnType<typeof arm>>) => (a.final ? `the trip was ${n(a.final.surprise)} off what was expected and was learned from at ${n(a.final.noticed ?? a.final.attention ?? 1)} of the step${a.final.noticed === undefined ? "" : " (because something had just stood out)"}; expected now ${n(a.final.expected)}; orienting peaked at ${n(a.orienting)}` : "the trip did not end");
    return {
      scene: "learning",
      field: "level",
      lean: "none",
      won: `reader on: ${say(on)} | reader off: ${say(off)}`,
      defence: "none",
      problem: !on.final || !off.final ? "a trip did not end" : on.final.noticed === undefined ? ((on.final.attention ?? 1) >= 1 ? "the trip was a full surprise by itself, so the event had nothing to add (the scene shows nothing)" : "something stood out just before the trip ended, and it was not learned from any faster") : off.final.noticed !== undefined ? "with the reader off the event still raised the learning step" : "",
    };
  },
};

/** Prints the table for these scenes. */
export function printMapTable(rows: MapRow[]): void {
  console.log("\nscene | field | lean | what won and why | what the defence circuit did");
  for (const r of rows) console.log(`${r.scene} | ${r.field} | ${r.lean} | ${r.won} | ${r.defence}${r.problem ? ` | PROBLEM: ${r.problem}` : ""}`);
}
