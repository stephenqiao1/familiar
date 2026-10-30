import { parseArgs } from "node:util";

export interface BotArgs {
  host: string;
  port: number;
  name: string;
}

/** Reads --host, --port and --name, with defaults for a local server. */
export function parseBotArgs(argv: string[]): BotArgs {
  const { values } = parseArgs({
    args: argv.filter((a) => a !== "--"),
    options: {
      host: { type: "string", default: "localhost" },
      port: { type: "string", default: "25565" },
      name: { type: "string", default: "Miner" },
    },
  });
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid --port "${values.port}"`);
  }
  return { host: values.host, port, name: values.name };
}
