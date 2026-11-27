// Live check of the cerebellum on the test server. `practice` (in shadow: every reader at 0) has
// the real bot make each kind of movement many times on its own ground (walks over ordinary and
// slippery ground and through water; digs with three tools; hits; a meal; steps, jumps, a lever)
// and prints the shadow report. The other scenes have the readers on (cerebellum-check-readers.ts).
//   pnpm cerebellum-check [scene ...]
import { playerNumber, rcon, sleep } from "./primitive-check/world.ts";
import { BOT, freshPlaza, play, runScenes, type Row, type Tick } from "./live.ts";
import { digs, ground, laps, LANE, put, repeat, Y } from "./cerebellum-check-ground.ts";
import { readerScenes } from "./cerebellum-check-readers.ts";
import { cerebellumReport } from "./cerebellum-shadow-report.ts";

export async function practice(): Promise<Tick[]> {
  await freshPlaza();
  // No random ticks: the pool must not freeze over (the test ground is in a cold biome).
  // Not peaceful: on peaceful nobody gets hungry, so nothing can be eaten.
  for (const command of ["difficulty easy", "time set 1000", "weather clear", "gamerule random_tick_speed 0"]) rcon(command);
  return play(async (bot) => {
    // Walking: ordinary ground, slippery ground, water, and ordinary ground with a slowed body.
    // (Soul sand and honey do not slow this client; the slowness effect is tried in their place.)
    for (const [block, seconds, slowed] of [["stone", 8, false], ["packed_ice", 9, false], ["water", 18, false], ["stone", 14, true]] as const) {
      ground(block);
      put(LANE.from);
      if (slowed) rcon(`effect give ${BOT} slowness 120 2 true`);
      await sleep(1500);
      await laps(bot, 7, seconds);
    }
    rcon(`effect clear ${BOT} slowness`);
    ground("stone");
    put(59);
    await sleep(1500);
    // Digging: dirt by hand, stone with a wooden pickaxe, then with an iron one.
    await digs(bot, "dirt", 6, 2.5);
    rcon(`give ${BOT} wooden_pickaxe 1`);
    await repeat(bot, "do equip item:wooden_pickaxe", 1, 1.5);
    await digs(bot, "stone", 6, 3);
    rcon(`give ${BOT} iron_pickaxe 1`);
    await repeat(bot, "do equip item:iron_pickaxe", 1, 1.5);
    await digs(bot, "stone", 6, 2);
    // Hitting something that can be hurt.
    rcon(`summon cow 61 ${Y} ${LANE.z} {NoAI:1b,Silent:1b,Health:200f,attributes:[{id:"minecraft:max_health",base:200}]}`);
    put(59, -90, 20);
    await sleep(1000);
    await repeat(bot, "do hit nearest:cow", 8, 1.2);
    rcon("kill @e[type=cow,distance=..200]");
    // The primitives with no written expectation: a meal, a jump, a brace, a lever, a step.
    rcon(`give ${BOT} bread 16`);
    await repeat(bot, "do equip item:bread", 1, 1.5);
    // Hungry enough to eat seven times: the game lets nobody eat on a full stomach.
    rcon(`effect give ${BOT} hunger 120 255 true`);
    for (let waited = 0; waited < 60 && !(playerNumber("foodLevel") <= 4); waited++) await sleep(1000);
    await repeat(bot, "do use_item", 6, 3.5);
    rcon(`effect clear ${BOT} hunger`);
    await repeat(bot, "do jump", 6, 1.2);
    await repeat(bot, "do brace", 6, 1.5);
    rcon(`setblock 61 ${Y} ${LANE.z} lever[face=floor]`);
    await repeat(bot, `do use_on pos:61,${Y},${LANE.z}`, 6, 1.2);
    rcon(`setblock 61 ${Y} ${LANE.z} air`);
    await repeat(bot, "do step dir:back", 6, 1.2, () => put(59));
    await repeat(bot, "do sneak", 6, 1);
  }, { settings: { cerebellum: { estimates: 0, late: 0, pace: 0, giveUp: 0, mismatch: 0, expectations: 0, timing: 0 } } });
}

const scenes: Record<string, () => Promise<Row>> = {
  async practice() {
    const ticks = await practice();
    const report = cerebellumReport(ticks);
    console.log(report.join("\n"));
    const signals = new Set(ticks.flatMap((t) => Object.keys(t.signals)));
    return { scene: "practice", saw: report[0]!, problem: signals.has("mismatch") ? "a signal was shared in shadow" : "" };
  },
  ...readerScenes,
};
await runScenes(scenes);
for (const command of ["difficulty easy", "gamerule random_tick_speed 3"]) rcon(command);
