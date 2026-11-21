import { describe, expect, it } from "vitest";
import { createReachMemory } from "./reach-memory.js";

const at = (x: number, y = 64, z = 0) => ({ x, y, z });

describe("reach memory", () => {
  it("recalls what was found for a creature and the bot each about where they were", () => {
    const places = createReachMemory();
    expect(places.recall(at(5, 60), at(0))).toBeNull();
    places.note(at(5, 60), at(0), false); // a husk in a pit
    expect(places.recall(at(5, 60), at(0))).toBe(false);
    // Another husk in the same pit, the bot a step to the side: the same answer.
    expect(places.recall(at(6, 60), at(1))).toBe(false);
  });

  it("knows nothing once either has moved somewhere else", () => {
    const places = createReachMemory();
    places.note(at(5, 60), at(0), false);
    expect(places.recall(at(5, 64), at(0))).toBeNull(); // it is out of the pit
    expect(places.recall(at(5, 60), at(9))).toBeNull(); // the bot is elsewhere
  });

  it("a newer answer for the same places replaces the old one, and only so many are kept", () => {
    const places = createReachMemory();
    places.note(at(5), at(0), false);
    places.note(at(5), at(0), true);
    expect(places.recall(at(5), at(0))).toBe(true);
    for (let i = 1; i <= 64; i++) places.note(at(5 + i * 10), at(0), false);
    expect(places.recall(at(5), at(0))).toBeNull();
    expect(places.recall(at(645), at(0))).toBe(false);
  });
});
