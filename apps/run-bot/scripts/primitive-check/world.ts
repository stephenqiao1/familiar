// The test area for the primitives: a walled stone plaza in the sky, away from the base, and
// the console commands and observer bot used to check what really happened there.
import { execFileSync } from "node:child_process";
import { connect } from "@familiar/minecraft";

const CONTAINER = process.env.MC_CONTAINER ?? "familiar-m6";
export const BOT = "Tester";
/** Where the bot stands for every scene, facing north (-z). The block in front of it is FRONT. */
export const HOME = { x: 60, y: 151, z: 40 };
export const FRONT = "60 151 39";
export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function rcon(command: string): string {
  try {
    return execFileSync("docker", ["exec", CONTAINER, "rcon-cli", "--", command], { encoding: "utf8" }).trim();
  } catch (error) {
    return `rcon failed: ${error instanceof Error ? error.message : error}`;
  }
}

const PLAZA = [
  "gamerule spawn_mobs false",
  "difficulty easy",
  "time set 1000",
  "weather clear",
  "forceload add 39 35 81 45",
  "fill 40 149 36 80 150 44 stone",
  "fill 40 151 36 80 158 44 air",
  "fill 39 151 35 81 152 35 glass",
  "fill 39 151 45 81 152 45 glass",
  "fill 39 151 35 39 152 45 glass",
  "fill 81 151 35 81 152 45 glass",
];

export function buildPlaza(): void {
  for (const command of PLAZA) rcon(command);
}

/** Puts the bot back at the start of a scene: at home facing north, healthy, with a clear floor and empty pockets. */
export async function reset(give: string[] = []): Promise<void> {
  for (const command of [
    "kill @e[type=!player,x=60,y=151,z=40,distance=..30]",
    "fill 40 151 36 80 158 44 air",
    "fill 40 147 35 80 150 45 stone",
    "fill 40 153 35 80 158 35 air",
    "fill 40 153 45 80 158 45 air",
    `clear ${BOT}`,
    `effect clear ${BOT}`,
    `effect give ${BOT} instant_health 1 10 true`,
    `effect give ${BOT} saturation 1 10 true`,
    ...give.map((what) => `give ${BOT} ${what}`),
    `tp ${BOT} ${HOME.x + 0.5} ${HOME.y} ${HOME.z + 0.5} 180 0`,
  ]) {
    rcon(command);
  }
  await sleep(700);
}

export function tearDown(): void {
  // Leave the plaza as the other live checks expect it: a two-block floor with nothing under it.
  for (const command of ["kill @e[type=!player,x=60,y=151,z=40,distance=..48]", "fill 40 151 35 80 160 45 air", "fill 40 149 36 80 150 44 stone", "fill 40 147 35 80 148 45 air", "fill 39 151 35 81 152 35 glass", "fill 39 151 45 81 152 45 glass", "gamerule spawn_mobs true", "forceload remove 39 35 81 45", `tp ${BOT} -8 69 14`]) rcon(command);
}

/** How many of an item the bot carries, asked of the server (not of the bot). */
export function carried(itemName: string): number {
  const reply = rcon(`clear ${BOT} ${itemName} 0`);
  return Number(/Found (\d+)/.exec(reply)?.[1] ?? 0);
}

/** A number from the bot's own data on the server (e.g. foodLevel). */
export function playerNumber(path: string): number {
  return Number(/(-?\d+(\.\d+)?)[a-z]?$/i.exec(rcon(`data get entity ${BOT} ${path}`))?.[1] ?? NaN);
}

/** What the server says is in the block at a position (e.g. a chest's Items). */
export function blockData(at: string, path: string): string {
  return rcon(`data get block ${at} ${path}`);
}

/** A second bot that watches from above: what an observer sees, as opposed to what the bot reports. */
export async function startObserver() {
  const bot = await connect({ host: "localhost", port: 25565, username: "Observer" });
  rcon("gamemode spectator Observer");
  rcon(`tp Observer ${HOME.x + 0.5} ${HOME.y + 6} ${HOME.z + 0.5}`);
  await bot.waitForChunksToLoad();
  const hurt: string[] = [];
  bot.on("entityHurt", (entity) => void hurt.push(entity?.name ?? "?"));
  const watched = () => bot.players[BOT]?.entity;
  return {
    /** The block's name and properties at "x y z". */
    block(at: string) {
      const [x, y, z] = at.split(" ").map(Number) as [number, number, number];
      const block = bot.blockAt(bot.entity.position.clone().set(x, y, z));
      return { name: block?.name ?? "unloaded", properties: (block?.getProperties() ?? {}) as Record<string, unknown> };
    },
    position: () => watched()?.position.clone() ?? null,
    yaw: () => watched()?.yaw ?? NaN,
    /** Dropped items lying near home, by item name. */
    drops: () => Object.values(bot.entities).filter((e) => e.name === "item" && e.position.distanceTo(bot.entity.position) < 12).length,
    /** How many times an entity of this name has been seen hurt. */
    hurts: (name: string) => hurt.filter((n) => n === name).length,
    quit: () => bot.quit(),
  };
}

export type Observer = Awaited<ReturnType<typeof startObserver>>;
