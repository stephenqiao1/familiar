import { describe, expect, it } from "vitest";
import { createSurfaces, INNATE_LOOSE, setKnownSurfaces, surfaceKind } from "./surfaces.js";

describe("createSurfaces", () => {
  it("is born knowing only what it is told is loose", () => {
    const surfaces = createSurfaces({ innateLoose: INNATE_LOOSE });
    expect(surfaces.kindOf("gravel")).toBe("loose");
    expect(surfaces.kindOf("white_concrete_powder")).toBe("loose");
    expect(surfaces.kindOf("stone")).toBeNull();
    expect(createSurfaces({ innateLoose: [] }).kindOf("sand")).toBeNull();
  });

  it("learns a block is loose from two separate digs where it came down; one is not enough", () => {
    const surfaces = createSurfaces({ innateLoose: [] });
    expect(surfaces.saw("sand", "loose", 0)).toEqual({ block: "sand", kind: "loose", count: 1, learned: false });
    expect(surfaces.kindOf("sand")).toBeNull();
    // The same moment again is the same incident.
    expect(surfaces.saw("sand", "loose", 500)).toBeNull();
    expect(surfaces.saw("sand", "loose", 5000)).toEqual({ block: "sand", kind: "loose", count: 2, learned: true });
    expect(surfaces.kindOf("sand")).toBe("loose");
    expect(surfaces.justLearned()).toEqual([{ block: "sand", kind: "loose", count: 2, learned: true }]);
    expect(surfaces.justLearned()).toEqual([]);
    expect(surfaces.entries().loose).toEqual({ sand: 2 });
  });

  it("learns slippery and slow from several sightings, with no starting list", () => {
    const surfaces = createSurfaces({ innateLoose: INNATE_LOOSE });
    for (const at of [0, 5000]) surfaces.saw("soul_sand", "slow", at);
    expect(surfaces.kindOf("soul_sand")).toBeNull();
    expect(surfaces.saw("soul_sand", "slow", 10_000)?.learned).toBe(true);
    expect(surfaces.kindOf("soul_sand")).toBe("slow");
    for (const at of [0, 5000, 10_000]) surfaces.saw("ice", "slippery", at);
    expect(surfaces.kindOf("ice")).toBe("slippery");
  });

  it("starts from what was saved, never learns air or water, and learns nothing with learning off", () => {
    expect(createSurfaces({ innateLoose: [], learned: { loose: { sand: 2 } } }).kindOf("sand")).toBe("loose");
    const surfaces = createSurfaces({ innateLoose: [] });
    expect(surfaces.saw("air", "loose", 0)).toBeNull();
    const off = createSurfaces({ innateLoose: [], learn: 0 });
    off.saw("sand", "loose", 0);
    off.saw("sand", "loose", 5000);
    expect(off.kindOf("sand")).toBeNull();
  });
});

describe("surfaceKind", () => {
  it("uses a bot's own knowledge once told, and the innate loose blocks before that", () => {
    const bot = {};
    expect(surfaceKind(bot, "gravel")).toBe("loose");
    setKnownSurfaces(bot, (name) => (name === "ice" ? "slippery" : null));
    expect(surfaceKind(bot, "gravel")).toBeNull();
    expect(surfaceKind(bot, "ice")).toBe("slippery");
  });
});
