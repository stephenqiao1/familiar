// Live check of the hippocampus's map: the real bot wanders a test ground with a house (a door)
// and a tunnel (no sky), then is sent to a chest it cannot see. Prints the map it built, the
// areas, a route through known cells, and whether the journey went by known spots.
//   pnpm map-check [--minutes 10] [scene ...]
import { readFileSync } from "node:fs";
import { routeThrough, createMap, nearestCell, type SavedMap } from "@familiar/memory";
import { BOT, play, runScenes, traceOf, type Row, type Tick } from "./live.ts";
import { rcon, sleep } from "./primitive-check/world.ts";

const arg = (name: string, otherwise: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv.splice(i, 2)[1]) : otherwise;
};
const MINUTES = arg("minutes", 10);
/** The ground: a floor in the sky south of the plaza, 65 by 49 blocks, walled. */
const G = { x0: 40, x1: 104, z0: 60, z1: 108, y: 151 };
const CHEST = { x: 88, y: 151, z: 70 };
const START = "44.5 151 62.5 0 0";

function buildGround(): void {
  for (const command of [
    // The ground is away from where any player stands, so its chunks are kept loaded while it is built and used.
    `forceload add ${G.x0 - 1} ${G.z0 - 1} ${G.x1 + 1} ${G.z1 + 1}`,
    "gamerule spawn_mobs false",
    "weather clear",
    "time set 1000",
    "gamerule advance_time false",
    `kill @e[type=!player,x=72,y=151,z=84,distance=..60]`,
    `fill ${G.x0} 151 ${G.z0} ${G.x1} 157 ${G.z1} air`,
    `fill ${G.x0} 150 ${G.z0} ${G.x1} 150 ${G.z1} stone`,
    `fill ${G.x0 - 1} 151 ${G.z0 - 1} ${G.x1 + 1} 153 ${G.z0 - 1} glass`,
    `fill ${G.x0 - 1} 151 ${G.z1 + 1} ${G.x1 + 1} 153 ${G.z1 + 1} glass`,
    `fill ${G.x0 - 1} 151 ${G.z0 - 1} ${G.x0 - 1} 153 ${G.z1 + 1} glass`,
    `fill ${G.x1 + 1} 151 ${G.z0 - 1} ${G.x1 + 1} 153 ${G.z1 + 1} glass`,
    // A house with a roof and a door in its south wall, and a chest inside.
    "fill 84 150 68 92 155 76 oak_planks hollow",
    "setblock 88 151 76 oak_door[half=lower,facing=south]",
    "setblock 88 152 76 oak_door[half=upper,facing=south]",
    `setblock ${CHEST.x} ${CHEST.y} ${CHEST.z} chest`,
    `item replace block ${CHEST.x} ${CHEST.y} ${CHEST.z} container.0 with bread 8`,
    // A tunnel with no sky, open at both ends.
    "fill 56 150 92 76 154 100 stone hollow",
    "fill 56 151 95 56 152 97 air",
    "fill 76 151 95 76 152 97 air",
  ]) rcon(command);
}

/** The same wandering every run. */
function wanderer(seed = 7) {
  let s = seed;
  const next = () => ((s = (s * 1103515245 + 12345) % 2147483648), s / 2147483648);
  const fixed = [`88,151,72`, `66,151,96`, `60,151,96`, `72,151,96`, `88,151,80`];
  let n = 0;
  return () => (++n % 4 === 0 ? fixed[Math.floor(next() * fixed.length)]! : `${Math.round(G.x0 + 2 + next() * (G.x1 - G.x0 - 4))},151,${Math.round(G.z0 + 2 + next() * (G.z1 - G.z0 - 4))}`);
}

const savedMap = () => JSON.parse(readFileSync(`data/${BOT}/map.json`, "utf8")) as SavedMap;
const placeOf = (t: Tick) => traceOf<{ place?: { cell: string; area: string; familiarity: number; cells: number; worstMs: number; used?: { journeys: number; bySpots: number; wentRound: number } } }>(t, "hippocampus").place;

/** The map drawn from above, one letter per cell (its area), `.` for never visited. */
function draw(saved: SavedMap): string[] {
  const at = (key: string) => key.slice(key.lastIndexOf(":") + 1).split(",").map(Number) as [number, number, number];
  const names = [...new Set(saved.cells.map((c) => c.area))];
  const letter = (area: string) => String.fromCharCode(65 + (names.indexOf(area) % 26));
  const [xs, zs] = [saved.cells.map((c) => at(c.key)[0]), saved.cells.map((c) => at(c.key)[2])];
  const rows: string[] = [];
  for (let z = Math.min(...zs); z <= Math.max(...zs); z++) {
    let row = "";
    for (let x = Math.min(...xs); x <= Math.max(...xs); x++) {
      const cell = saved.cells.find((c) => at(c.key)[0] === x && at(c.key)[2] === z);
      row += cell ? letter(cell.area) : ".";
    }
    rows.push(`    ${row}`);
  }
  return rows;
}

const scenes: Record<string, () => Promise<Row>> = {
  /** Wander for ten minutes (go_to commands to scattered spots: there is no wandering skill), then go to the chest in the house from the far corner. */
  async wander() {
    buildGround();
    await sleep(1000);
    const target = wanderer();
    let sentAt = 0;
    const ticks = await play(
      async ({ say }) => {
        const until = Date.now() + MINUTES * 60_000;
        while (Date.now() < until) {
          say(`do go_to pos:${target()}`);
          await sleep(11_000);
        }
        say("do go_to pos:44,151,62");
        await sleep(25_000);
        sentAt = Date.now();
        say(`do go_to pos:${CHEST.x},${CHEST.y},${CHEST.z + 1}`);
        await sleep(30_000);
      },
      { start: START },
    ).finally(() => rcon("gamerule advance_time true"));
    const saved = savedMap();
    const map = createMap({ saved });
    const areas = new Map<string, { cells: number; setting: string }>();
    for (const c of saved.cells) {
      const setting = Object.entries(c.settings).sort((a, b) => b[1] - a[1])[0]![0];
      areas.set(c.area, { cells: (areas.get(c.area)?.cells ?? 0) + 1, setting });
    }
    const familiar = saved.cells.map((c) => map.familiarity(c.key)).sort((a, b) => a - b);
    const places = ticks.map(placeOf).filter((p) => p !== undefined);
    const unfamiliar = ticks.map((t) => t.signals.unfamiliar?.value).filter((v) => v !== undefined);
    console.log(`    the map after ${MINUTES} minutes: ${saved.cells.length} cells, ${saved.links.length} ways between them (${saved.links.filter((l) => l.barrier).map((l) => l.barrier).join(", ") || "no barriers"}), ${areas.size} areas`);
    for (const [name, a] of areas) console.log(`      area ${name}: ${a.cells} cells, ${a.setting}`);
    for (const row of draw(saved)) console.log(row);
    console.log(`    familiarity: least ${familiar[0]!.toFixed(2)}, middle ${familiar[familiar.length >> 1]!.toFixed(2)}, most ${familiar.at(-1)!.toFixed(2)}; unfamiliar signal ${unfamiliar[0]?.toFixed(2)} at the start, ${unfamiliar.at(-1)?.toFixed(2)} at the end`);
    // The journey to the chest: the route the map gives, and what locomotion was told.
    const [from, to] = [nearestCell(map, { x: 44, y: 151, z: 62 }, 12), nearestCell(map, { ...CHEST, z: CHEST.z + 1 }, 12)];
    const route = from && to ? routeThrough(map, from, to) : null;
    const before = places.filter((_, i) => ticks[i]!.timestamp < sentAt).at(-1)?.used;
    const used = places.at(-1)?.used;
    const end = ticks.at(-1)!.state.data.self.position;
    const arrived = Math.hypot(end.x - CHEST.x, end.z - (CHEST.z + 1)) <= 3;
    const journey = ticks.filter((t) => t.timestamp >= sentAt).flatMap((t) => t.skillEvents ?? []).find((e) => e.skill === "go_to" && e.type !== "started");
    console.log(`    route from the corner to the chest in the house: ${route ? `${route.length} cells: ${route.map((k) => k.slice(k.lastIndexOf(":") + 1)).join(" → ")}` : "none on the map"}`);
    const bySpots = (used?.bySpots ?? 0) - (before?.bySpots ?? 0);
    const worst = Math.max(...places.map((p) => p.worstMs));
    const took = places.map((p) => (p as unknown as { ms: number }).ms).sort((x, y) => x - y);
    console.log(`    a map tick took ${took[took.length >> 1]} ms (middle), ${took[Math.floor(took.length * 0.99)]} ms (99 in 100), ${worst} ms (slowest), over 2 ms on ${took.filter((ms) => ms > 2).length} of ${took.length} ticks`);
    const ok = saved.cells.length >= 20 && areas.size >= 3 && route !== null && bySpots > 0 && arrived && took[Math.floor(took.length * 0.99)]! < 2;
    return {
      scene: `wander ${MINUTES} minutes, then to a chest out of sight`,
      saw: `${saved.cells.length} cells, ${saved.links.length} ways, ${areas.size} areas; route of ${route?.length ?? 0} cells; journeys by known spots in all ${used?.bySpots ?? 0} of ${used?.journeys ?? 0}, the last one ${bySpots > 0 ? "by known spots" : "NOT by known spots"}; go_to ${journey?.type ?? "did not end"}${journey?.reason ? ` (${journey.reason})` : ""}, ${arrived ? "at the chest" : `ended at ${end.x.toFixed(0)},${end.z.toFixed(0)}`}; slowest map tick ${worst} ms`,
      problem: ok ? "" : "see above",
    };
  },

  /**
   * The bot learns two ways between two corners (round by the south first, then straight along
   * the north side), dies half way along the north side, and is then sent between the corners
   * again: the way it is given is the other one, clear of the cell where it died. (The second
   * way is far enough from the first that the map does not pull the bot back onto the one it knows.)
   */
  async route() {
    buildGround();
    await sleep(1000);
    const DIED_AT = { x: 76, z: 62 };
    let sentAt = 0;
    const ticks = await play(
      async ({ say }) => {
        const walk = async (to: string, ms: number) => (say(`do go_to pos:${to}`), sleep(ms));
        for (const [to, ms] of [["44,151,84", 9000], ["100,151,84", 19_000], ["100,151,62", 9000], ["44,151,62", 19_000], ["76,151,62", 13_000]] as const) await walk(to, ms);
        rcon(`kill ${BOT}`);
        await sleep(4000);
        rcon(`tp ${BOT} ${START}`);
        // Back from the dead and moved a long way: the ground round it takes a few seconds to load.
        await sleep(16_000);
        sentAt = Date.now();
        await walk("100,151,62", 40_000);
      },
      { start: START },
    ).finally(() => rcon("gamerule advance_time true"));
    const saved = savedMap();
    const map = createMap({ saved });
    const feared = saved.cells.filter((c) => (c.led?.harm ?? 0) >= 0.5);
    const [from, to] = [nearestCell(map, { x: 44, y: 151, z: 62 }, 12), nearestCell(map, { x: 100, y: 151, z: 62 }, 12)];
    const [round, straight] = [from && to ? routeThrough(map, from, to) : null, from && to ? routeThrough(map, from, to, 0) : null];
    const journey = ticks.filter((t) => t.timestamp >= sentAt);
    const nearest = Math.min(...journey.map((t) => Math.hypot(t.state.data.self.position.x - DIED_AT.x, t.state.data.self.position.z - DIED_AT.z)));
    // The cell it died in (8 blocks square): did the journey set foot in it?
    const inCell = (p: { x: number; z: number }) => Math.floor(p.x / 8) === Math.floor(DIED_AT.x / 8) && Math.floor(p.z / 8) === Math.floor(DIED_AT.z / 8);
    const crossed = journey.some((t) => inCell(t.state.data.self.position));
    const end = ticks.at(-1)!.state.data.self.position;
    const arrived = Math.hypot(end.x - 100, end.z - 62) <= 4;
    const used = (t: Tick | undefined) => t && placeOf(t)?.used;
    const wentRound = (used(ticks.at(-1))?.wentRound ?? 0) - (used(ticks.filter((t) => t.timestamp < sentAt).at(-1))?.wentRound ?? 0);
    const short = (keys: string[] | null) => keys?.map((k) => k.slice(k.lastIndexOf(":") + 1)).join(" → ") ?? "none";
    const passes = (keys: string[] | null) => keys?.some((k) => feared.some((c) => c.key === k)) ?? false;
    const ok = feared.length > 0 && round !== null && !passes(round) && passes(straight) && wentRound > 0 && !crossed && arrived;
    return {
      scene: "route: the way avoids the cell where it died",
      saw: `led to harm (0.5 or more): ${feared.map((c) => `${c.key.slice(c.key.lastIndexOf(":") + 1)} ${c.led!.harm.toFixed(2)}`).join(", ") || "no cell"} | the shortest known way: ${short(straight)} | the way given: ${short(round)} | on the journey the bot ${crossed ? "crossed" : "kept out of"} the cell where it died (no nearer than ${nearest.toFixed(1)} blocks to the spot); told to go round ${wentRound} time(s); ${arrived ? "arrived" : `did not arrive (ended at ${end.x.toFixed(0)}, ${end.z.toFixed(0)})`}`,
      problem: ok ? "" : "the way was not turned round the cell where it died",
    };
  },

  /** A trip that ends in something good (a hungry bot is fed as it arrives): the cells on the way show "led to good", less the further back. */
  async replay() {
    buildGround();
    await sleep(1000);
    let fedAt = 0;
    const ticks = await play(
      async ({ say }) => {
        await sleep(3000);
        // Hungry, but not starving (which would hurt on the way).
        rcon(`effect give ${BOT} hunger 60 255 true`);
        for (let i = 0; i < 150 && !(Number(/(\d+)\s*$/.exec(rcon(`data get entity ${BOT} foodLevel`))?.[1] ?? 20) <= 3); i++) await sleep(200);
        rcon(`effect clear ${BOT}`);
        await sleep(2000);
        say("do go_to pos:100,151,62");
        await sleep(40_000);
        fedAt = Date.now();
        rcon(`effect give ${BOT} saturation 1 20 true`);
        await sleep(6000);
      },
      { start: START },
    ).finally(() => rcon("gamerule advance_time true"));
    const saved = savedMap();
    const replays = ticks.filter((t) => t.timestamp >= fedAt).flatMap((t) => traceOf<{ replays?: { sign: string; cells: { cell: string; amount: number }[] }[] }>(t, "hippocampus").replays ?? []).filter((r) => r.sign === "good");
    const cells = replays[0]?.cells ?? [];
    const marked = saved.cells.filter((c) => (c.led?.good ?? 0) > 0);
    const paid = ticks.filter((t) => t.timestamp >= fedAt).map((t) => t.signals.reward?.value ?? 0);
    const shrinking = cells.every((c, i) => i === 0 || c.amount <= cells[i - 1]!.amount);
    const ok = cells.length >= 3 && shrinking && marked.length >= 3;
    return {
      scene: "replay: a reward at the end of a trip",
      saw: `the reward for being fed: ${Math.max(0, ...paid).toFixed(2)} (paid once, by dopamine) | played backward over ${cells.length} cells: ${cells.map((c) => `${c.cell.slice(c.cell.lastIndexOf(":") + 1)} ${c.amount.toFixed(2)}`).join(", ") || "none"} | cells on the map marked "led to good": ${marked.length}`,
      problem: ok ? "" : "the way there was not marked as leading to good",
    };
  },
};

await runScenes(scenes);
