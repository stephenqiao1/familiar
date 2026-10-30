import { createWriteStream, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { TickLog } from "@familiar/contracts";

export interface Logger {
  log(entry: TickLog): void;
  close(): Promise<void>;
}

/** Appends one JSON line per entry. Writes are buffered by a stream, so `log` never blocks. */
export function createLogger(filePath: string): Logger {
  mkdirSync(dirname(filePath), { recursive: true });
  const stream = createWriteStream(filePath, { flags: "a" });
  let failure: Error | undefined;
  stream.on("error", (err) => {
    failure = err;
  });

  return {
    log(entry) {
      stream.write(JSON.stringify(entry) + "\n");
    },
    close() {
      return new Promise((resolve, reject) => {
        stream.end(() => (failure ? reject(failure) : resolve()));
        stream.once("error", reject);
      });
    },
  };
}
