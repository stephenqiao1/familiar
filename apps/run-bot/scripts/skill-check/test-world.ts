// Builds a repeatable test area west of the base and resets the Miner's inventory.
import { connect } from "@familiar/minecraft";
import { rcon, rconOrThrow } from "./rcon.ts";

export const MINER_START = "-28 63 5";
export const OBSERVER_SPOT = "-40 76 5";
/** Tunnel starts here, facing west into the stone block. */
export const TUNNEL_START = "pos:-41,63,5";
export const ATTACK_SPOTS = ["-32 63 4", "-32 63 8"];
/** Flee setup: the Miner stands here with a zombie 4 blocks west, in the open, so it runs east toward base. */
export const FLEE_START = "pos:-31,63,6";
export const FLEE_ZOMBIE = "-35 63 6";

const WORLD = [
  // Flat dirt floor, a cleared approach, and a stone block 23 long to tunnel into.
  "fill -64 62 -2 -28 62 12 dirt",
  "fill -41 63 -2 -28 70 12 air",
  "fill -64 63 1 -42 66 9 stone",
  "fill -64 67 1 -42 70 9 air",
  // Ore in the tunnel walls (tunnel runs along z=5), and two iron targets for mine_block.
  "setblock -47 63 4 coal_ore",
  "setblock -51 64 6 coal_ore",
  "setblock -30 63 0 iron_ore",
  "setblock -35 63 11 iron_ore",
];

const MINER = [
  `tp Miner ${MINER_START}`,
  "gamemode survival Miner",
  "clear Miner",
  "effect clear Miner",
  "effect give Miner instant_health 1 10 true",
  "effect give Miner saturation 1 10 true",
  "give Miner oak_log 10",
  "give Miner cobblestone 16",
  "give Miner coal 3",
  "give Miner cooked_beef 8",
  "give Miner torch 8",
  "give Miner stone_sword 1",
  `tp Miner ${MINER_START}`,
];

const RESET = ["time set 1000", "weather clear", "difficulty easy"];
/** Fine to find nothing. */
const CLEANUP = ["kill @e[type=zombie]", "kill @e[type=item]"];

/** Call with the observer already online near the area, so its chunks are loaded. */
export async function setUpTestWorld(): Promise<void> {
  for (const command of RESET) rconOrThrow(command);
  for (const command of CLEANUP) rcon(command);
  // Player commands need the Miner online; fills need its chunks loaded.
  const bot = await connect({ host: "localhost", port: 25565, username: "Miner" });
  for (const command of MINER) rconOrThrow(command);
  await bot.waitForChunksToLoad();
  await sleep(1000);
  for (const command of WORLD) rconOrThrow(command);
  await sleep(1000);
  bot.quit();
  await sleep(1500);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function summonZombie(at: string): void {
  rconOrThrow(`summon zombie ${at} {NoAI:1b,PersistenceRequired:1b,equipment:{head:{id:"minecraft:leather_helmet",count:1}}}`);
}
