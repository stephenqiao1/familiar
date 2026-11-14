// Builds a repeatable test area west of the base and resets the Player's inventory.
import { connect } from "@familiar/minecraft";
import { rcon, rconOrThrow } from "./rcon.ts";

const PLAYER_START = "-28 63 5";
export const OBSERVER_SPOT = "-40 76 5";
export const ATTACK_SPOTS = ["-32 63 4", "-32 63 8"];
/** Flee setup: the Player stands here with a zombie 4 blocks west, in the open, so it runs east toward base. */
export const FLEE_START = "pos:-31,63,6";
export const FLEE_ZOMBIE = "-35 63 6";

const WORLD = [
  // Flat dirt floor and a cleared area.
  "fill -64 62 -2 -28 62 12 dirt",
  "fill -64 63 -2 -28 70 12 air",
];

const PLAYER = [
  `tp Player ${PLAYER_START}`,
  "gamemode survival Player",
  "clear Player",
  "effect clear Player",
  "effect give Player instant_health 1 10 true",
  "effect give Player saturation 1 10 true",
  "give Player cooked_beef 8",
  "give Player stone_sword 1",
  `tp Player ${PLAYER_START}`,
];

const RESET = ["time set 1000", "weather clear", "difficulty easy"];
/** Fine to find nothing. */
const CLEANUP = ["kill @e[type=zombie]", "kill @e[type=item]"];

/** Call with the observer already online near the area, so its chunks are loaded. */
export async function setUpTestWorld(): Promise<void> {
  for (const command of RESET) rconOrThrow(command);
  for (const command of CLEANUP) rcon(command);
  // Player commands need the Player online; fills need its chunks loaded.
  const bot = await connect({ host: "localhost", port: 25565, username: "Player" });
  for (const command of PLAYER) rconOrThrow(command);
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
