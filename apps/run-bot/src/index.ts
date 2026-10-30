import type { TickLog } from "@familiar/contracts";
import { createLogger, createLoop, defaultLogPath } from "@familiar/core";
import { EchoEngine } from "@familiar/engine-echo";
import { applyAction, connect, encodeState } from "@familiar/minecraft";
import { parseBotArgs } from "./args.js";
import { formatTick } from "./format-tick.js";
import { questions } from "./questions.js";

const ROLE = "miner";

async function main(): Promise<void> {
  const { host, port, name } = parseBotArgs(process.argv.slice(2));
  const bot = await connect({ host, port, username: name });
  const logPath = defaultLogPath(ROLE);
  console.log(`Joined ${host}:${port} as ${name}. Logging to ${logPath}`);

  const fileLogger = createLogger(logPath);
  let tick = 0;
  const loop = createLoop({
    engine: new EchoEngine(),
    questions,
    getState: () => encodeState(bot, tick++),
    onAction: (action) => applyAction(bot, action),
    logger: {
      log(entry: TickLog) {
        fileLogger.log(entry);
        console.log(formatTick(entry));
      },
    },
  });

  let stopping = false;
  async function shutdown(reason: string, exitCode: number): Promise<void> {
    if (stopping) return;
    stopping = true;
    console.log(`Stopping (${reason})...`);
    await loop.stop();
    await fileLogger.close();
    bot.quit();
    process.exitCode = exitCode;
  }

  process.once("SIGINT", () => void shutdown("Ctrl+C", 0));
  bot.once("kicked", (why) => void shutdown(`kicked: ${JSON.stringify(why)}`, 1));
  bot.once("end", (why) => void shutdown(`disconnected: ${why}`, 1));
  bot.on("error", (error) => console.error(`Bot error: ${error.message}`));

  loop.start();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
