import { readFile } from "node:fs/promises";
import {
  DEFAULT_FOCUS,
  DEFAULT_NORADRENALINE,
  DEFAULT_PATIENCE,
  DEFAULT_PERSONALITY,
  focusProblem,
  noradrenalineProblem,
  patienceProblem,
  personalityProblem,
  type DopaminePersonality,
  type FocusSettings,
  type NoradrenalineSettings,
  type PatienceSettings,
} from "@familiar/neuromodulators";
import { brainstemProblem, DEFAULT_BRAINSTEM, type BrainstemSettings } from "@familiar/region-brainstem";

// Every bot's settings live in one file, keyed by bot name. A bot with no entry, or a setting
// left out, gets the default. A bad value stops the bot at startup with a clear error.

const DEFAULT_BOTS_FILE = "bots.json";

export interface BotConfig {
  /** Dopamine temperament. */
  personality: DopaminePersonality;
  /** Serotonin temperament. */
  patience: PatienceSettings;
  /** Noradrenaline temperament: alarm and search. */
  noradrenaline: NoradrenalineSettings;
  /** Acetylcholine temperament: focus. */
  focus: FocusSettings;
  /** Brainstem temperament: bravery, and the strength of each part that tunes the reflexes. */
  brainstem: BrainstemSettings;
  memory: MemorySettings;
}

export interface MemorySettings {
  /** How long a weak memory takes to lose half its strength, in in-game days (20 minutes each). */
  halfLifeDays: number;
}

export const DEFAULT_MEMORY: MemorySettings = { halfLifeDays: 2 };

export async function loadBotConfig(name: string, file = DEFAULT_BOTS_FILE): Promise<BotConfig> {
  const bots = await readBots(file);
  const entry = bots[name] as
    | { personality?: Partial<DopaminePersonality>; patience?: Partial<PatienceSettings>; noradrenaline?: Partial<NoradrenalineSettings>; focus?: Partial<FocusSettings>; brainstem?: Partial<BrainstemSettings>; memory?: Partial<MemorySettings> }
    | undefined;
  const personality = { ...DEFAULT_PERSONALITY, ...entry?.personality };
  const patience = { ...DEFAULT_PATIENCE, ...entry?.patience };
  const noradrenaline = { ...DEFAULT_NORADRENALINE, ...entry?.noradrenaline };
  const focus = { ...DEFAULT_FOCUS, ...entry?.focus };
  const brainstem = { ...DEFAULT_BRAINSTEM, ...entry?.brainstem };
  const memory = { ...DEFAULT_MEMORY, ...entry?.memory };
  const memoryProblem = memory.halfLifeDays > 0 ? null : `memory.halfLifeDays must be above 0, got ${memory.halfLifeDays}`;
  const problem = personalityProblem(personality) ?? patienceProblem(patience) ?? noradrenalineProblem(noradrenaline) ?? focusProblem(focus) ?? brainstemProblem(brainstem) ?? memoryProblem;
  if (problem) throw new Error(`${file}: bot "${name}": ${problem}`);
  return { personality, patience, noradrenaline, focus, brainstem, memory };
}

/** The file's bots by name; none if the file is missing. Throws if it exists but is not valid. */
async function readBots(file: string): Promise<Record<string, unknown>> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return {};
  }
  const bots: unknown = JSON.parse(text);
  if (bots === null || typeof bots !== "object" || Array.isArray(bots)) throw new Error(`${file} must map bot names to settings`);
  return bots as Record<string, unknown>;
}
