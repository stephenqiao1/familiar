import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNoveltyMemory, createScorebook } from "@familiar/neuromodulators";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemory } from "@familiar/memory";
import { createChestMemory } from "@familiar/minecraft";
import { loadChests, loadLearnedSkills, loadMemories, loadNovelty, loadScorebook, saveChests, saveMemories, saveNovelty, saveScorebook } from "./memory-store.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "scorebook-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("memory store", () => {
  it("saves and loads what was learned", async () => {
    const file = join(dir, "nested", "scorebook.json");
    const book = createScorebook();
    book.learn("night", "sleep", 1, 0.1);
    await saveScorebook(book, file);
    expect((await loadScorebook(file)).entries()).toEqual(book.entries());
  });

  it("starts empty when the file is missing or broken, skipping bad entries", async () => {
    expect((await loadScorebook(join(dir, "missing.json"))).entries()).toEqual([]);
    const file = join(dir, "scorebook.json");
    await writeFile(file, "{not json");
    expect((await loadScorebook(file)).entries()).toEqual([]);
    const good = { feature: "eat | day", expected: 0.2, benefit: 1.1, cost: 0.9 };
    // An entry from before the scorebook was kept by feature (one page per situation) is skipped too.
    await writeFile(file, JSON.stringify([good, { feature: "eat" }, { situation: "day", skill: "eat", expected: 0.2, benefit: 1.1, cost: 0.9 }]));
    expect((await loadScorebook(file)).entries()).toEqual([{ ...good, runs: 0, successes: 0 }]);
  });

  it("saves and loads novelty counts, skipping bad ones", async () => {
    const file = join(dir, "novelty.json");
    const memory = createNoveltyMemory();
    memory.meet("cow");
    memory.meet("cow");
    await saveNovelty(memory, file);
    expect((await loadNovelty(file)).entries()).toEqual({ cow: 2 });
    await writeFile(file, JSON.stringify({ cow: 1, bad: -1, worse: "x" }));
    expect((await loadNovelty(file)).entries()).toEqual({ cow: 1 });
    expect((await loadNovelty(join(dir, "missing.json"))).entries()).toEqual({});
  });

  it("saves and loads chest memory, skipping bad entries", async () => {
    const file = join(dir, "chests.json");
    const chests = createChestMemory();
    chests.remember("pos:1,2,3", { bread: 8 }, 10);
    await saveChests(chests, file);
    expect((await loadChests(file)).entries()).toEqual({ "pos:1,2,3": { contents: { bread: 8 }, seenAt: 10 } });
    await writeFile(file, JSON.stringify({ "pos:1,2,3": { contents: { bread: 8 }, seenAt: 10 }, bad: { contents: { bread: "x" }, seenAt: 1 } }));
    expect(Object.keys((await loadChests(file)).entries())).toEqual(["pos:1,2,3"]);
  });

  it("saves and loads the same memories and known places, skipping bad entries", async () => {
    const file = join(dir, "memories.json");
    const place = { x: 1, y: 64, z: 2, dimension: "overworld" };
    const memory = createMemory();
    memory.namePlace("bed", place);
    memory.record({ kind: "danger", place, summary: "Took heavy damage from a zombie in plains", involved: ["zombie"], outcome: { feeling: "bad", value: -0.3 } }, 1000);
    await saveMemories(memory, file);
    const loaded = await loadMemories(file);
    expect(loaded.entries()).toEqual(memory.entries());
    expect(loaded.recall({ place, limit: 1, touch: false }, 1000)[0]!.summary).toBe("Took heavy damage from a zombie in plains");

    const saved = memory.entries();
    await writeFile(file, JSON.stringify({ memories: [...saved.memories, { id: "x" }], places: [...saved.places, { name: "nowhere" }], facts: [{ text: "no id" }] }));
    expect((await loadMemories(file)).entries()).toEqual(saved);
    expect((await loadMemories(join(dir, "missing.json"))).entries()).toEqual({ memories: [], places: [], facts: [] });
  });

  it("loads learned skills from a JSON file; a missing file means none", async () => {
    const file = join(dir, "learned-skills.json");
    expect(await loadLearnedSkills(file, ["turn", "step"], ["go_to"])).toEqual({ skills: [], problems: [] });
    await writeFile(file, JSON.stringify([{ name: "peek", description: "Turn and step.", steps: [{ primitive: "turn", target: "dir:left" }, { primitive: "step" }] }, { name: "go_to", steps: [{ primitive: "turn" }] }]));
    const { skills, problems } = await loadLearnedSkills(file, ["turn", "step"], ["go_to"]);
    expect(skills).toEqual([{ name: "peek", description: "Turn and step.", steps: [{ primitive: "turn", target: "dir:left" }, { primitive: "step" }] }]);
    expect(problems).toEqual(['"go_to": the name is already taken']);
  });
});
