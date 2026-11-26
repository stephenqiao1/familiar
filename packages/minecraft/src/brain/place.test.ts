import { createMap } from "@familiar/memory";
import { Vec3 } from "vec3";
import { describe, expect, it } from "vitest";
import { fakeState, type StatePatch } from "../encode/state.test-helper.js";
import { createMapRoutes } from "./map-routes.js";
import { cellKey, createCellReader, dimensionOf } from "./place.js";

const at = (x: number, y = 63, z = 0, self: StatePatch["self"] = {}, nearby: StatePatch["nearby"] = {}) => ({ self: { position: { x, y, z }, ...self }, nearby });

describe("a map cell for a Minecraft player", () => {
  it("is a cube of 8 blocks, per dimension", () => {
    expect(cellKey("overworld", { x: 0, y: 63, z: 7 })).toBe("overworld:0,7,0");
    expect(cellKey("overworld", { x: 8, y: 64, z: -1 })).toBe("overworld:1,8,-1");
    expect(cellKey("the_nether", { x: 0, y: 63, z: 7 })).not.toBe(cellKey("overworld", { x: 0, y: 63, z: 7 }));
    expect(dimensionOf("minecraft:overworld:0,7,0")).toBe("minecraft:overworld");
  });

  it("reads open or covered from the sky light, and counts what is in view", () => {
    const reader = createCellReader();
    const mobs = [{ type: "cow" }, { type: "cow" }, { type: "zombie" }] as never;
    expect(reader.cellOf(fakeState(at(3, 63, 3, { skyLight: 15 }, { mobs })))).toMatchObject({ key: "overworld:0,7,0", setting: "open", seen: { cow: 2, zombie: 1 } });
    expect(reader.cellOf(fakeState(at(3, 63, 3, { skyLight: 2 })))!.setting).toBe("covered");
    // A roof and walls close round the body: covered, whatever the light says.
    expect(reader.cellOf(fakeState(at(3, 63, 3, { skyLight: 15, enclosed: true })))!.setting).toBe("covered");
  });

  it("calls a change of cell a door when a door was heard close by, a climb when it was steep, and nothing on a plain walk", () => {
    const tick = (reader: ReturnType<typeof createCellReader>, seconds: number, a: StatePatch, b: StatePatch) => reader.barrier(fakeState(a, seconds * 1000), fakeState(b, (seconds + 0.25) * 1000));
    expect(tick(createCellReader(), 0, at(7), at(8))).toBeNull();
    expect(tick(createCellReader(), 0, at(7), at(7.5))).toBeNull();
    const heard = [{ type: "door", bearing: "ahead", dist: 1, position: { x: 8, y: 63, z: 0 }, loudness: 1 }] as never;
    expect(tick(createCellReader(), 0, at(7), at(8, 63, 0, {}, { heard }))).toBe("door");
    // Up a ladder: 4 blocks up over a second with no ground covered.
    const ladder = createCellReader();
    for (let i = 0; i < 4; i++) expect(tick(ladder, i * 0.25, at(0, 60 + i), at(0, 61 + i))).toBe(i === 3 ? "climb" : null);
    // Up a gentle slope: the same height over much more ground.
    const slope = createCellReader();
    for (let i = 0; i < 4; i++) expect(tick(slope, i * 0.25, at(i * 3, 60 + i), at(i * 3 + 3, 61 + i))).toBeNull();
  });
});

describe("journeys on the map", () => {
  /** A line of cells walked along x at z = 4 (cells 0 to 5), and a second way round by z = 12 between cells 1 and 4. */
  function known() {
    const map = createMap();
    const reader = createCellReader();
    let t = 0;
    const go = (x: number, z: number) => map.at(reader.cellOf(fakeState(at(x, 63, z)))!, (t += 1000));
    for (let x = 4; x <= 44; x += 8) go(x, 4);
    for (const [x, z] of [[36, 4], [36, 12], [28, 12], [20, 12], [12, 12], [12, 4]]) go(x!, z!);
    return map;
  }
  const routes = (map = known(), over: { waypoints?: number; replay?: number } = {}) => createMapRoutes({ map, dimension: () => "overworld", waypoints: 1, replay: 1, ...over });
  const [from, to] = [new Vec3(4, 63, 4), new Vec3(44, 63, 4)];

  it("gives locomotion the known spots between here and somewhere far, and none for somewhere near or unknown", () => {
    const r = routes();
    expect(r.hint(from, to)!.via.map((v) => v.x)).toEqual([12, 20, 28, 36]);
    expect(r.hint(from, new Vec3(12, 63, 4))).toBeNull();
    expect(r.hint(from, new Vec3(400, 63, 4))).toBeNull();
    expect(r.counts()).toEqual({ journeys: 3, bySpots: 1, wentRound: 0 });
  });

  it("takes the way round a cell that led to harm, tells locomotion to keep clear of it, and tells the planner", () => {
    const map = known();
    map.mark("overworld:3,7,0", "harm", 1);
    const r = createMapRoutes({ map, dimension: () => "overworld", waypoints: 1, replay: 1, whatHappened: () => "Died to a zombie in plains" });
    const hint = r.hint(from, to)!;
    expect(hint.via.some((v) => v.z === 12)).toBe(true);
    expect(hint.via.some((v) => v.x === 28 && v.z === 4)).toBe(false);
    expect(hint.avoid).toEqual([{ name: "map:overworld:3,7,0", centre: { x: 28, y: 60, z: 4 }, radius: 6 }]);
    // With no other way, the planner hears what the way passes.
    const line = createMap();
    const reader = createCellReader();
    for (let x = 4, t = 0; x <= 44; x += 8) line.at(reader.cellOf(fakeState(at(x, 63, 4)))!, (t += 1000));
    line.mark("overworld:3,7,0", "harm", 1);
    const told = createMapRoutes({ map: line, dimension: () => "overworld", waypoints: 1, replay: 1, whatHappened: () => "Died to a zombie in plains" });
    expect(told.wayTo(from, to)).toBe("the way passes where this happened: Died to a zombie in plains");
    expect(routes(known()).wayTo(from, to)).toBeNull();
  });

  it("gives no spots when the known way is a long way round: three sides of a field, when the end is straight across", () => {
    const map = createMap();
    const reader = createCellReader();
    let t = 0;
    for (const [x, z] of [[4, 4], [4, 12], [4, 20], [4, 28], [12, 28], [20, 28], [28, 28], [28, 20], [28, 12], [28, 4]]) map.at(reader.cellOf(fakeState(at(x!, 63, z!)))!, (t += 1000));
    const r = routes(map);
    expect(r.hint(new Vec3(4, 63, 4), new Vec3(28, 63, 4))).toBeNull();
    expect(r.hint(new Vec3(4, 63, 4), new Vec3(4, 63, 28))!.via.map((v) => v.z)).toEqual([12, 20]);
  });

  it("does not ring a feared cell whose circle would shut in the journey's own end", () => {
    const map = known();
    map.mark("overworld:3,7,0", "harm", 1);
    // An end 8 blocks from the feared cell's middle (28, 4) is clear of its circle: the cell is ringed.
    expect(routes(map).hint(from, new Vec3(36, 63, 4))!.avoid).toHaveLength(1);
    // An end in the next cell but 5 blocks from that middle would be shut in: the cell is not ringed.
    expect(routes(map).hint(from, new Vec3(33, 63, 4))?.avoid ?? []).toEqual([]);
  });

  it("with waypoints at 0 gives no spots, and with replay at 0 goes round nothing and says nothing", () => {
    const map = known();
    map.mark("overworld:3,7,0", "harm", 1);
    expect(routes(map, { waypoints: 0 }).hint(from, to)!.via).toEqual([]);
    const plain = routes(map, { replay: 0 });
    expect(plain.hint(from, to)!.avoid).toEqual([]);
    expect(plain.hint(from, to)!.via.map((v) => v.z)).toEqual([4, 4, 4, 4]);
    expect(plain.wayTo(from, to)).toBeNull();
  });
});
