import { describe, expect, it } from "vitest";
import { parseCommand } from "./args.js";

const local = { host: "localhost", port: 25565, name: "Miner" };

describe("parseCommand", () => {
  it("runs the loop with no command, reading host, port and name", () => {
    expect(parseCommand(["--", "--host", "example", "--port", "25566", "--name", "Bob"])).toEqual({
      kind: "loop",
      server: { host: "example", port: 25566, name: "Bob" },
      engine: "echo",
    });
  });

  it("defaults to localhost:25565 as Miner", () => {
    expect(parseCommand([])).toEqual({ kind: "loop", server: local, engine: "echo" });
  });

  it("picks the decision engine", () => {
    expect(parseCommand(["--engine", "jev"])).toMatchObject({ kind: "loop", engine: "jev" });
    expect(() => parseCommand(["--engine", "gpt"])).toThrow(/Unknown --engine/);
  });

  it("lists skills", () => {
    expect(parseCommand(["--", "skills"])).toEqual({ kind: "skills" });
  });

  it("runs one skill with a target and an interrupt time", () => {
    expect(parseCommand(["skill", "go_to", "--target", "pos:1,2,3", "--interrupt-after", "2.5"])).toEqual({
      kind: "skill",
      server: local,
      skill: "go_to",
      target: "pos:1,2,3",
      interruptAfterMs: 2500,
    });
  });

  it("reads --linger", () => {
    expect(parseCommand(["skill", "idle", "--linger", "2"])).toMatchObject({ kind: "skill", lingerMs: 2000 });
  });

  it("runs one skill with no options", () => {
    expect(parseCommand(["skill", "idle"])).toEqual({ kind: "skill", server: local, skill: "idle" });
  });

  it.each([[["skill"]], [["skill", "a", "b"]], [["fly"]], [["skills", "x"]]])("rejects %j", (argv) => {
    expect(() => parseCommand(argv)).toThrow(/Unknown command/);
  });

  it("rejects a bad port or interrupt time", () => {
    expect(() => parseCommand(["--port", "abc"])).toThrow(/Invalid --port/);
    expect(() => parseCommand(["skill", "idle", "--interrupt-after", "soon"])).toThrow(/Invalid --interrupt-after/);
  });
});
