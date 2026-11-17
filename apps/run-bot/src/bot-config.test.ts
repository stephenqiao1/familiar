import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_FOCUS, DEFAULT_NORADRENALINE, DEFAULT_PATIENCE, DEFAULT_PERSONALITY } from "@familiar/neuromodulators";
import { DEFAULT_LOCOMOTION, DEFAULT_MEDULLA, DEFAULT_POSTURE, DEFAULT_REFLEXES } from "@familiar/minecraft";
import { DEFAULT_BRAINSTEM } from "@familiar/region-brainstem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_MEMORY, loadBotConfig } from "./bot-config.js";

const REST = { noradrenaline: DEFAULT_NORADRENALINE, focus: DEFAULT_FOCUS, brainstem: DEFAULT_BRAINSTEM, locomotion: DEFAULT_LOCOMOTION, reflexes: DEFAULT_REFLEXES, medulla: DEFAULT_MEDULLA, posture: DEFAULT_POSTURE, memory: DEFAULT_MEMORY };

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

  it("reads the reflexes block: what the bot is born knowing, and which reflexes are on", async () => {
    await writeFile(file, JSON.stringify({ Naive: { reflexes: { innateHurts: ["lava", "fire"], edgeGuard: 0.5 } }, Half: { reflexes: { painWithdrawal: 0.5 } }, List: { reflexes: { innateHurts: "lava" } } }));
    expect((await loadBotConfig("Naive", file)).reflexes).toEqual({ ...DEFAULT_REFLEXES, innateHurts: ["lava", "fire"], edgeGuard: 0.5 });
    // A hard reflex is on or off: nothing in between.
    await expect(loadBotConfig("Half", file)).rejects.toThrow(/reflexes.painWithdrawal must be 0 or 1/);
    await expect(loadBotConfig("List", file)).rejects.toThrow(/reflexes.innateHurts must be a list/);
  });

  it("reads the posture block: what the bot is born knowing is loose, and each part's strength", async () => {
    await writeFile(file, JSON.stringify({ Newborn: { posture: { innateLoose: [], stance: 0.5 } }, Bad: { posture: { righting: 2 } }, Half: { posture: { check: 0.5 } }, List: { posture: { innateLoose: "sand" } } }));
    expect((await loadBotConfig("Newborn", file)).posture).toEqual({ ...DEFAULT_POSTURE, innateLoose: [], stance: 0.5 });
    await expect(loadBotConfig("Bad", file)).rejects.toThrow(/posture.righting must be 0 to 1/);
    await expect(loadBotConfig("Half", file)).rejects.toThrow(/posture.check must be 0 or 1/);
    await expect(loadBotConfig("List", file)).rejects.toThrow(/posture.innateLoose must be a list/);
  });

  it("reads the medulla block: what the bot is born knowing about food, and each urge's strength", async () => {
    await writeFile(file, JSON.stringify({ Newborn: { medulla: { innateBadFoods: [], needAir: 0.5 } }, Bad: { medulla: { cure: 2 } }, List: { medulla: { innateBadFoods: "rotten_flesh" } } }));
    expect((await loadBotConfig("Newborn", file)).medulla).toEqual({ ...DEFAULT_MEDULLA, innateBadFoods: [], needAir: 0.5 });
    await expect(loadBotConfig("Bad", file)).rejects.toThrow(/medulla.cure must be 0 to 1/);
    await expect(loadBotConfig("List", file)).rejects.toThrow(/medulla.innateBadFoods must be a list/);
  });

  it("reads locomotion strengths and rejects a bad one", async () => {
    await writeFile(file, JSON.stringify({ Steady: { locomotion: { speedFromAlarm: 0 } }, Bad: { locomotion: { cautionFromFocus: 2 } } }));
    expect((await loadBotConfig("Steady", file)).locomotion).toEqual({ ...DEFAULT_LOCOMOTION, speedFromAlarm: 0 });
    await expect(loadBotConfig("Bad", file)).rejects.toThrow(/locomotion.cautionFromFocus must be 0 to 1/);
  });

  it("reads brainstem settings and rejects a bad one", async () => {
    await writeFile(file, JSON.stringify({ Brave: { brainstem: { bravery: 0.8, startle: 0 } }, Bad: { brainstem: { bravery: 1.2 } } }));
    expect((await loadBotConfig("Brave", file)).brainstem).toEqual({ ...DEFAULT_BRAINSTEM, bravery: 0.8, startle: 0 });
    await expect(loadBotConfig("Bad", file)).rejects.toThrow(/brainstem.bravery must be 0 to 1/);
  });
});
