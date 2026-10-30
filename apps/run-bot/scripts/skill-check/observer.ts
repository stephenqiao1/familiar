// A spectator bot that watches the Miner and timestamps every move and dig it sees.
import { connect } from "@familiar/minecraft";
import { rcon } from "./rcon.ts";

const MOVE_EPSILON = 0.03;

export interface Observer {
  /** Latest time (ms) the watched player moved or dug at or after `since`, or null. */
  lastActivitySince(since: number): number | null;
  /** How many updates (moves or turns) about the watched player arrived in [from, to]. */
  sightingsBetween(from: number, to: number): number;
  /** False once the observer's own connection has dropped. */
  connected(): boolean;
  /** Where the watched player was last seen. */
  lastPosition(): { x: number; y: number; z: number } | null;
  quit(): void;
}

export async function startObserver(watch: string, at: string): Promise<Observer> {
  const bot = await connect({ host: "localhost", port: 25565, username: "Observer" });
  rcon("gamemode spectator Observer");
  rcon(`tp Observer ${at}`);

  let online = true;
  let quitting = false;
  bot.once("end", (reason) => {
    online = false;
    if (!quitting) console.error(`!! Observer disconnected (${reason}); later stop times can't be measured.`);
  });
  const activity: number[] = [];
  const sightings: number[] = [];
  let last: { x: number; y: number; z: number } | null = null;

  bot.on("entityMoved", (entity) => {
    if (entity.username !== watch) return;
    sightings.push(Date.now());
    const p = entity.position;
    if (last && Math.hypot(p.x - last.x, p.y - last.y, p.z - last.z) > MOVE_EPSILON) activity.push(Date.now());
    last = { x: p.x, y: p.y, z: p.z };
  });
  // mineflayer passes the digging entity as a third argument (missing from its types).
  bot.on("blockBreakProgressObserved", (...args: unknown[]) => {
    const entity = args[2] as { username?: string } | undefined;
    if (entity?.username === watch) activity.push(Date.now());
  });

  return {
    lastActivitySince: (since) => activity.filter((t) => t >= since).at(-1) ?? null,
    sightingsBetween: (from, to) => sightings.filter((t) => t >= from && t <= to).length,
    connected: () => online,
    lastPosition: () => last,
    quit: () => {
      quitting = true;
      bot.quit();
    },
  };
}
