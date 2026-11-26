import { describe, expect, it } from "vitest";
import { createMap, type CellNow, type MapStore } from "./map.js";
import { nearestCell, routeThrough } from "./map-route.js";
import { previewRoute, replayBackward, replayInOrder } from "./map-replay.js";
import { createTrail } from "./trail.js";

/** A cell on a line: cell n is at x = 8n. */
const cell = (n: number, over: Partial<CellNow> = {}, z = 0): CellNow => ({ key: `w:${n},${z}`, spot: { x: n * 8, y: 64, z: z * 8 }, setting: "open", seen: {}, ...over });
/** Walks the cells in order, a second apart; returns the time afterwards. */
function walk(map: MapStore, cells: CellNow[], from = 0, barrier: (i: number) => string | null = () => null): number {
  cells.forEach((c, i) => map.at(c, from + i * 1000, barrier(i)));
  return from + cells.length * 1000;
}

describe("the map", () => {
  it("learns cells and the ways between them from a walk, with how long each took", () => {
    const map = createMap();
    walk(map, [cell(0), cell(0), cell(0), cell(1), cell(2)]);
    expect(map.cells().map((c) => c.key)).toEqual(["w:0,0", "w:1,0", "w:2,0"]);
    expect(map.links()).toMatchObject([{ a: "w:0,0", b: "w:1,0", walks: 1, ms: 3000 }, { a: "w:1,0", b: "w:2,0", walks: 1 }]);
  });

  it("does not link two cells the bot did not walk between (a teleport)", () => {
    const map = createMap();
    walk(map, [cell(0), cell(50)]);
    expect(map.links()).toEqual([]);
  });

  it("becomes more familiar with visits and time spent, and faster at a higher rate", () => {
    const [map, slow] = [createMap(), createMap({ rate: 0.25 })];
    expect(map.familiarity("w:0,0")).toBe(0);
    walk(map, [cell(0), cell(1)]);
    const once = map.familiarity("w:0,0");
    walk(map, [cell(0), cell(1), cell(0), cell(1), cell(0)], 10_000);
    expect(map.familiarity("w:0,0")).toBeGreaterThan(once);
    walk(slow, [cell(0), cell(1)]);
    expect(slow.familiarity("w:0,0")).toBeLessThan(once);
    // Standing about counts too.
    const stayed = createMap();
    stayed.at(cell(0), 0);
    stayed.at(cell(0), 120_000);
    expect(stayed.familiarity("w:0,0")).toBeGreaterThan(once);
  });

  it("keeps what was seen in a cell, fading if not seen again", () => {
    const map = createMap();
    map.at(cell(0, { seen: { cow: 3 } }), 0);
    expect(map.seenIn("w:0,0", 0)).toEqual({ cow: 3 });
    expect(map.seenIn("w:0,0", 2_400_000).cow).toBeCloseTo(1.5);
    map.at(cell(0), 20_000_000);
    expect(map.seenIn("w:0,0", 20_000_000)).toEqual({});
  });

  it("is saved and loaded whole", () => {
    const map = createMap();
    walk(map, [cell(0), cell(1)]);
    const again = createMap({ saved: map.entries() });
    expect(again.entries()).toEqual(map.entries());
  });
});

describe("areas", () => {
  it("puts cells that connect plainly in one area", () => {
    const map = createMap();
    walk(map, [cell(0), cell(1), cell(2)]);
    expect(new Set(map.cells().map((c) => c.area)).size).toBe(1);
  });

  it("splits at a door, at a climb and at a change of light", () => {
    const door = createMap();
    walk(door, [cell(0), cell(1), cell(2)], 0, (i) => (i === 2 ? "door" : null));
    expect(door.cell("w:1,0")!.area).toBe(door.cell("w:0,0")!.area);
    expect(door.cell("w:2,0")!.area).not.toBe(door.cell("w:1,0")!.area);
    const light = createMap();
    walk(light, [cell(0), cell(1), cell(2, { setting: "covered" }), cell(3, { setting: "covered" })]);
    expect(light.cell("w:2,0")!.area).not.toBe(light.cell("w:1,0")!.area);
    expect(light.cell("w:3,0")!.area).toBe(light.cell("w:2,0")!.area);
  });

  it("keeps an area's name as the map grows, and joins two areas when a plain way between them is found", () => {
    const map = createMap();
    walk(map, [cell(0), cell(1)]);
    const field = map.cell("w:0,0")!.area;
    walk(map, [cell(2), cell(3)], 10_000, (i) => (i === 0 ? "door" : null));
    expect(map.cell("w:0,0")!.area).toBe(field);
    expect(map.cell("w:3,0")!.area).not.toBe(field);
    // The same way walked with nothing in between: it was not a barrier after all.
    walk(map, [cell(1), cell(2)], 20_000);
    expect(map.cell("w:3,0")!.area).toBe(field);
  });
});

describe("routes", () => {
  /** A square of four cells walked round three sides: 0,0 → 1,0 → 1,1 → 0,1. */
  function square(): MapStore {
    const map = createMap();
    walk(map, [cell(0, {}, 0), cell(1, {}, 0), cell(1, {}, 1), cell(0, {}, 1)]);
    return map;
  }

  it("goes only through known cells along ways walked", () => {
    const map = square();
    expect(routeThrough(map, "w:0,0", "w:0,1")).toEqual(["w:0,0", "w:1,0", "w:1,1", "w:0,1"]);
    expect(routeThrough(map, "w:0,0", "w:9,9")).toBeNull();
    walk(map, [cell(20)], 50_000);
    expect(routeThrough(map, "w:0,0", "w:20,0")).toBeNull();
  });

  it("takes a shortcut once one is known, though no single journey went that way", () => {
    const map = square();
    walk(map, [cell(0, {}, 1), cell(0, {}, 0)], 3000);
    expect(routeThrough(map, "w:0,0", "w:0,1")).toEqual(["w:0,0", "w:0,1"]);
  });

  it("goes round a cell that led to harm when another way exists, and through it when none does", () => {
    const map = square();
    walk(map, [cell(0, {}, 1), cell(0, {}, 0)], 3000);
    map.mark("w:0,1", "harm", 0);
    map.mark("w:1,0", "harm", 1);
    expect(routeThrough(map, "w:0,0", "w:1,1")).toEqual(["w:0,0", "w:0,1", "w:1,1"]);
    const line = createMap();
    walk(line, [cell(0), cell(1), cell(2)]);
    line.mark("w:1,0", "harm", 1);
    expect(routeThrough(line, "w:0,0", "w:2,0")).toEqual(["w:0,0", "w:1,0", "w:2,0"]);
  });

  it("finds the known cell nearest a spot, within a distance", () => {
    const map = square();
    expect(nearestCell(map, { x: 9, y: 64, z: 1 }, 12)).toBe("w:1,0");
    expect(nearestCell(map, { x: 500, y: 64, z: 0 }, 12)).toBeNull();
  });
});

describe("replay", () => {
  it("backward: marks the cells on the way, less the further back, and nothing else", () => {
    const map = createMap();
    const end = walk(map, [cell(0), cell(1), cell(2), cell(3)]);
    const trail = createTrail();
    ["w:0,0", "w:1,0", "w:2,0", "w:3,0"].forEach((key, i) => trail.push(key, i * 1000));
    const marks = replayBackward(map, trail.recent(end), "good", 1);
    expect(marks.map((m) => m.cell)).toEqual(["w:3,0", "w:2,0", "w:1,0", "w:0,0"]);
    const good = ["w:3,0", "w:2,0", "w:1,0", "w:0,0"].map((key) => map.cell(key)!.led!.good);
    expect(good[0]).toBe(1);
    expect(good[1]).toBeLessThan(good[0]!);
    expect(good[3]).toBeLessThan(good[2]!);
    expect(map.cell("w:3,0")!.led!.harm).toBe(0);
    // It is not an experience: no visit is counted.
    expect(map.cell("w:0,0")!.visits).toBe(1);
  });

  it("in order: goes over the ways walked, which makes them count as better worn", () => {
    const map = createMap();
    walk(map, [cell(0), cell(1), cell(2)]);
    expect(replayInOrder(map, ["w:0,0", "w:1,0", "w:2,0"])).toBe(2);
    expect(map.links()[0]).toMatchObject({ walks: 1, rehearsed: 0.5 });
  });

  it("forward: names a feared cell on the route, not the journey's own end", () => {
    const map = createMap();
    walk(map, [cell(0), cell(1), cell(2)]);
    map.mark("w:1,0", "harm", 0.8);
    map.mark("w:2,0", "harm", 0.9);
    const route = routeThrough(map, "w:0,0", "w:2,0")!;
    expect(previewRoute(map, route).feared).toMatchObject([{ cell: "w:1,0", harm: 0.8 }]);
  });

  it("the trail keeps the last ten minutes of cells in order, and the cells since the last rest", () => {
    const trail = createTrail();
    trail.push("a", 0);
    trail.push("a", 1000);
    trail.push("b", 2000);
    trail.push("c", 700_000);
    expect(trail.recent(700_000)).toEqual(["c"]);
    expect(trail.sinceRest()).toEqual(["a", "b", "c"]);
    trail.clearRest();
    expect(trail.sinceRest()).toEqual([]);
  });
});
