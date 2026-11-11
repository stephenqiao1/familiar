import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { TickLog } from "@familiar/contracts";
import { createLogger } from "./logger.js";

function entry(tick: number): TickLog {
  return {
    tick,
    timestamp: 1000 + tick,
    state: { schemaVersion: 1, tick, timestamp: 1000 + tick, data: {} },
    encodeMs: 0,
    decideMs: 0,
    regions: [],
    winner: null,
    action: { keepGoing: true },
    goal: null,
    signals: {},
  };
}

describe("createLogger", () => {
  let dir: string;
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("writes one JSON line per entry, in order, creating the folder", async () => {
    dir = await mkdtemp(join(tmpdir(), "familiar-"));
    const file = join(dir, "nested", "miner.jsonl");

    const logger = createLogger(file);
    [0, 1, 2].forEach((t) => logger.log(entry(t)));
    await logger.close();

    const lines = (await readFile(file, "utf8")).trimEnd().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines.map((l) => (JSON.parse(l) as TickLog).tick)).toEqual([0, 1, 2]);
    expect(JSON.parse(lines[1]!)).toEqual(entry(1));
  });
});
