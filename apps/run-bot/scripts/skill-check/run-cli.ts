// Runs `skill <name>` through the real CLI and timestamps its output lines.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export interface CliRun {
  status: "done" | "failed" | "interrupted" | "no result";
  reason?: string;
  startedAt?: number;
  endedAt?: number;
  interruptAt?: number;
  exitedAt: number;
  output: string[];
}

const EVENT = /^\[skill\] \S+(?: \(.*\))? (started|done|failed|interrupted)(?:: (.*))?$/;

export function runCli(args: string[], onStarted?: () => void): Promise<CliRun> {
  const child = spawn("node", ["apps/run-bot/dist/index.js", ...args], { stdio: ["ignore", "pipe", "pipe"] });
  const run: CliRun = { status: "no result", exitedAt: 0, output: [] };

  const onLine = (line: string) => {
    const now = Date.now();
    run.output.push(line);
    if (line.startsWith("Interrupting")) run.interruptAt ??= now;
    const event = EVENT.exec(line);
    if (!event) return;
    if (event[1] === "started") {
      run.startedAt = now;
      onStarted?.();
    } else {
      run.status = event[1] as CliRun["status"];
      if (event[2]) run.reason = event[2];
      run.endedAt = now;
    }
  };
  createInterface({ input: child.stdout }).on("line", onLine);
  createInterface({ input: child.stderr }).on("line", onLine);

  return new Promise((resolve) => {
    child.on("exit", () => {
      run.exitedAt = Date.now();
      resolve(run);
    });
  });
}
