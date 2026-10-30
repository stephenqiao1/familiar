// Runs a command on the test server's console (itzg/minecraft-server image).
import { execFileSync } from "node:child_process";

const CONTAINER = process.env.MC_CONTAINER ?? "familiar-mc";

const REJECTED = /not loaded|unknown|incorrect|invalid|expected|no entity was found|too many blocks/i;

export function rcon(command: string): string {
  return execFileSync("docker", ["exec", CONTAINER, "rcon-cli", "--", command], { encoding: "utf8" }).trim();
}

/** Like rcon, but throws if the server rejected the command. */
export function rconOrThrow(command: string): string {
  const reply = rcon(command);
  if (REJECTED.test(reply)) throw new Error(`Server rejected "${command}": ${reply}`);
  return reply;
}
