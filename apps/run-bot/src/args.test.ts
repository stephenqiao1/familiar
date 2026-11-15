import { describe, expect, it } from "vitest";
import { parseCommand } from "./args.js";

const local = { host: "localhost", port: 25565, name: "Player" };

describe("parseCommand", () => {
  it("runs the loop with no command, reading host, port and name", () => {
    expect(parseCommand(["--", "--host", "example", "--port", "25566", "--name", "Bob"])).toEqual({
      kind: "loop",
      server: { host: "example", port: 25566, name: "Bob" },
      brain: { engine: "echo", planner: "echo" },
    });
  });

  it("defaults to localhost:25565 as Player", () => {
    expect(parseCommand([])).toEqual({ kind: "loop", server: local, brain: { engine: "echo", planner: "echo" } });
  });

  it("picks the decision engine and planner", () => {
    expect(parseCommand(["--engine", "jev", "--planner", "claude"])).toMatchObject({ kind: "loop", brain: { engine: "jev", planner: "claude" } });
    expect(() => parseCommand(["--engine", "gpt"])).toThrow(/Unknown --engine/);
    expect(() => parseCommand(["--planner", "gpt"])).toThrow(/Unknown --planner/);
  });

  it("reads --regions as a comma-separated list", () => {
    expect(parseCommand(["--regions", "reflex, instinct"])).toMatchObject({ brain: { regions: ["reflex", "instinct"] } });
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

  it("runs one skill with what to carry", () => {
    expect(parseCommand(["skill", "take_items", "--wants", "bread:8, torch:16"])).toMatchObject({
      wants: [
        { item: "bread", count: 8 },
        { item: "torch", count: 16 },
      ],
    });
    expect(() => parseCommand(["skill", "take_items", "--wants", "bread"])).toThrow(/Invalid --wants "bread"/);
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

  it("reads --primitives and a fixed --plan for the echo planner", () => {
    expect(parseCommand(["--same-time"])).toMatchObject({ brain: { sameTime: true } });
    const command = parseCommand(["--primitives", "--plan", '{"goal":"Explore","ifThen":[{"when":"creeper","skill":"flee"}],"holdBack":["flee"]}']);
    expect(command).toMatchObject({
      kind: "loop",
      brain: { primitives: true, plan: { goal: "Explore", steps: [], ifThen: [{ when: "creeper", skill: "flee" }], holdBack: ["flee"] } },
    });
    expect(() => parseCommand(["--plan", "not json"])).toThrow(/Invalid --plan/);
    expect(() => parseCommand(["--plan", '{"steps":[]}'])).toThrow(/needs a "goal"/);
  });
});
