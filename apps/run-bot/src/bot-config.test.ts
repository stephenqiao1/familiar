import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_FOCUS, DEFAULT_NORADRENALINE, DEFAULT_PATIENCE, DEFAULT_PERSONALITY } from "@familiar/neuromodulators";
import { DEFAULT_BRAINSTEM } from "@familiar/region-brainstem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_MEMORY, loadBotConfig } from "./bot-config.js";

const REST = { noradrenaline: DEFAULT_NORADRENALINE, focus: DEFAULT_FOCUS, brainstem: DEFAULT_BRAINSTEM, memory: DEFAULT_MEMORY };

let dir: string;
let file: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "bots-"));
  file = join(dir, "bots.json");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("loadBotConfig", () => {
  it("reads one bot's personality, filling in what is left out", async () => {
    await writeFile(file, JSON.stringify({ Scout: { personality: { restingDA: 0.65, noveltyBonus: 1 } }, Other: {} }));
    expect(await loadBotConfig("Scout", file)).toEqual({ personality: { restingDA: 0.65, learningRate: 0.1, noveltyBonus: 1 }, patience: DEFAULT_PATIENCE, ...REST });
  });

  it("uses the defaults for a bot with no entry, or no file", async () => {
    await writeFile(file, JSON.stringify({ Scout: {} }));
    expect(await loadBotConfig("Player", file)).toEqual({ personality: DEFAULT_PERSONALITY, patience: DEFAULT_PATIENCE, ...REST });
    expect(await loadBotConfig("Player", join(dir, "missing.json"))).toEqual({ personality: DEFAULT_PERSONALITY, patience: DEFAULT_PATIENCE, ...REST });
  });

  it("reads patience settings, filling in what is left out", async () => {
    await writeFile(file, JSON.stringify({ Calm: { patience: { resting: 0.8, brake: 0 } } }));
    expect((await loadBotConfig("Calm", file)).patience).toEqual({ ...DEFAULT_PATIENCE, resting: 0.8, brake: 0 });
    await writeFile(file, JSON.stringify({ Calm: { patience: { resting: 2 } } }));
    await expect(loadBotConfig("Calm", file)).rejects.toThrow(/bot "Calm": patience.resting/);
  });

  it("reads alarm, search and memory settings", async () => {
    await writeFile(file, JSON.stringify({ Jumpy: { noradrenaline: { alarmGain: 2, interrupt: 0 }, memory: { halfLifeDays: 5 } } }));
    const config = await loadBotConfig("Jumpy", file);
    expect(config.noradrenaline).toEqual({ ...DEFAULT_NORADRENALINE, alarmGain: 2, interrupt: 0 });
    expect(config.memory).toEqual({ halfLifeDays: 5 });
    await writeFile(file, JSON.stringify({ Jumpy: { noradrenaline: { searchResting: 2 } } }));
    await expect(loadBotConfig("Jumpy", file)).rejects.toThrow(/noradrenaline.searchResting/);
    await writeFile(file, JSON.stringify({ Jumpy: { memory: { halfLifeDays: 0 } } }));
    await expect(loadBotConfig("Jumpy", file)).rejects.toThrow(/memory.halfLifeDays/);
  });

  it("reads focus settings", async () => {
    await writeFile(file, JSON.stringify({ Watchful: { focus: { resting: 0.7, trustHalfLifeMinutes: 3, cuePulse: 0 } } }));
    expect((await loadBotConfig("Watchful", file)).focus).toEqual({ ...DEFAULT_FOCUS, resting: 0.7, trustHalfLifeMinutes: 3, cuePulse: 0 });
    await writeFile(file, JSON.stringify({ Watchful: { focus: { factSupport: 1 } } }));
    await expect(loadBotConfig("Watchful", file)).rejects.toThrow(/focus.factSupport/);
  });

  it("stops on a bad value or a broken file", async () => {
    await writeFile(file, JSON.stringify({ Scout: { personality: { learningRate: 5 } } }));
    await expect(loadBotConfig("Scout", file)).rejects.toThrow(/bot "Scout": learningRate/);
    await writeFile(file, "[]");
    await expect(loadBotConfig("Scout", file)).rejects.toThrow(/must map bot names/);
    await writeFile(file, "{oops");
    await expect(loadBotConfig("Scout", file)).rejects.toThrow();
  });

  it("reads brainstem settings and rejects a bad one", async () => {
    await writeFile(file, JSON.stringify({ Brave: { brainstem: { bravery: 0.8, startle: 0 } }, Bad: { brainstem: { bravery: 1.2 } } }));
    expect((await loadBotConfig("Brave", file)).brainstem).toEqual({ ...DEFAULT_BRAINSTEM, bravery: 0.8, startle: 0 });
    await expect(loadBotConfig("Bad", file)).rejects.toThrow(/brainstem.bravery must be 0 to 1/);
  });
});
