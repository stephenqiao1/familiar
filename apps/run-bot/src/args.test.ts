import { describe, expect, it } from "vitest";
import { parseBotArgs } from "./args.js";

describe("parseBotArgs", () => {
  it("reads host, port and name", () => {
    expect(parseBotArgs(["--", "--host", "example", "--port", "25566", "--name", "Bob"])).toEqual({
      host: "example",
      port: 25566,
      name: "Bob",
    });
  });

  it("defaults to localhost:25565 as Miner", () => {
    expect(parseBotArgs([])).toEqual({ host: "localhost", port: 25565, name: "Miner" });
  });

  it("rejects a bad port", () => {
    expect(() => parseBotArgs(["--port", "abc"])).toThrow(/Invalid --port/);
  });
});
