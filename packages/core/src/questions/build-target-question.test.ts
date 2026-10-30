import { describe, expect, it } from "vitest";
import { buildTargetQuestion } from "./build-target-question.js";

describe("buildTargetQuestion", () => {
  it("lists targets in order, then none", () => {
    expect(buildTargetQuestion(["entity:5", "pos:1,2,3"])).toMatchObject({
      kind: "choice",
      id: "target",
      options: ["entity:5", "pos:1,2,3", "none"],
    });
  });

  it("caps at 255 options, keeping the nearest, and always includes none", () => {
    const targets = Array.from({ length: 300 }, (_, i) => `pos:${i},0,0`);
    const { options } = buildTargetQuestion(targets);
    expect(options).toHaveLength(255);
    expect(options.slice(0, 2)).toEqual(["pos:0,0,0", "pos:1,0,0"]);
    expect(options.at(-2)).toBe("pos:253,0,0");
    expect(options.at(-1)).toBe("none");
  });

  it("is just none with no targets, and drops duplicates", () => {
    expect(buildTargetQuestion([]).options).toEqual(["none"]);
    expect(buildTargetQuestion(["entity:1", "entity:1", "none"]).options).toEqual(["entity:1", "none"]);
  });
});
