import mineflayer, { type Bot } from "mineflayer";
import { pathfinder } from "mineflayer-pathfinder";
import { createDefaultMovements } from "./movements.js";

export interface ConnectOptions {
  host: string;
  port: number;
  username: string;
}

/** Joins the server and resolves once the bot has spawned. */
export function connect({ host, port, username }: ConnectOptions): Promise<Bot> {
  const where = `${host}:${port} as ${username}`;
  // Errors are reported through the rejection below (and by the app after spawn), not printed by mineflayer.
  const bot = mineflayer.createBot({ host, port, username, hideErrors: true });
  bot.loadPlugin(pathfinder);

  return new Promise((resolve, reject) => {
    const fail = (message: string) => {
      cleanup();
      bot.end();
      reject(new Error(`Could not join ${where}: ${message}`));
    };
    const onSpawn = () => {
      cleanup();
      bot.pathfinder.setMovements(createDefaultMovements(bot));
      resolve(bot);
    };
    const onKicked = (reason: unknown) => fail(`kicked (${formatReason(reason)})`);
    const onError = (err: Error) => fail(err.message);
    const onEnd = (reason: string) => fail(`connection closed (${reason})`);

    function cleanup() {
      bot.off("spawn", onSpawn);
      bot.off("kicked", onKicked);
      bot.off("error", onError);
      bot.off("end", onEnd);
    }

    bot.once("spawn", onSpawn);
    bot.once("kicked", onKicked);
    bot.once("error", onError);
    bot.once("end", onEnd);
  });
}

function formatReason(reason: unknown): string {
  return typeof reason === "string" ? reason : JSON.stringify(reason);
}
