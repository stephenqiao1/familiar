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
import {
  DEFAULT_DEFENCE,
  defenceProblem,
  type DefenceSettings,
  DEFAULT_LOCOMOTION,
  DEFAULT_MEDULLA,
  DEFAULT_REFLEXES,
  locomotionProblem,
  medullaProblem,
  DEFAULT_POSTURE,
  postureProblem,
  type PostureSettings,
  reflexesProblem,
  type LocomotionSettings,
  type MedullaSettings,
  type ReflexSettings,
} from "@familiar/minecraft";
import { arousalProblem, brainstemProblem, colliculusProblem, DEFAULT_AROUSAL, DEFAULT_BRAINSTEM, DEFAULT_COLLICULUS, type ArousalSettings, type BrainstemSettings, type ColliculusSettings } from "@familiar/region-brainstem";

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
  /** How strongly the brain's dials set how fast and how carefully the bot travels. */
  locomotion: LocomotionSettings;
  /** The protective reflexes: what the bot is born knowing hurts, and which reflexes are on. */
  reflexes: ReflexSettings;
  /** The medulla: what the bot is born knowing about food, and the strength of each upkeep urge. */
  medulla: MedullaSettings;
  /** Posture: what the bot is born knowing about loose blocks, and the strength of each part that keeps it steady. */
  posture: PostureSettings;
  /** The colliculus: what makes something striking, how easily the bot turns its head, and whether it knows only what it sees. */
  colliculus: ColliculusSettings;
  /** Arousal: how awake the bot rests, how it sleeps and wakes, and how far arousal reaches. */
  arousal: ArousalSettings;
  /** Defence: what the bot is born knowing about threats, and the strength of each part of the defence circuit. */
  defence: DefenceSettings;
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
    | { personality?: Partial<DopaminePersonality>; patience?: Partial<PatienceSettings>; noradrenaline?: Partial<NoradrenalineSettings>; focus?: Partial<FocusSettings>; brainstem?: Partial<BrainstemSettings> & { arousalGate?: number }; locomotion?: Partial<LocomotionSettings>; reflexes?: Partial<ReflexSettings>; medulla?: Partial<MedullaSettings>; colliculus?: Partial<ColliculusSettings>; posture?: Partial<PostureSettings>; defence?: Partial<DefenceSettings>; arousal?: Partial<ArousalSettings>; memory?: Partial<MemorySettings> }
    | undefined;
  const personality = { ...DEFAULT_PERSONALITY, ...entry?.personality };
  const patience = { ...DEFAULT_PATIENCE, ...entry?.patience };
  const noradrenaline = { ...DEFAULT_NORADRENALINE, ...entry?.noradrenaline };
  const focus = { ...DEFAULT_FOCUS, ...entry?.focus };
  // The arousal gate used to be brainstem.arousalGate; it is arousal.gate now. The old name still loads.
  const { arousalGate: oldGate, ...brainstemEntry } = entry?.brainstem ?? {};
  if (oldGate !== undefined) console.warn(`${file}: bot "${name}": brainstem.arousalGate is now arousal.gate; the old name still works${entry?.arousal?.gate !== undefined ? ", but arousal.gate is set too and wins" : ""}.`);
  const brainstem = { ...DEFAULT_BRAINSTEM, ...brainstemEntry };
  const arousal = { ...DEFAULT_AROUSAL, ...(oldGate === undefined ? {} : { gate: oldGate }), ...entry?.arousal };
  const locomotion = { ...DEFAULT_LOCOMOTION, ...entry?.locomotion };
  const reflexes = { ...DEFAULT_REFLEXES, ...entry?.reflexes };
  const medulla = { ...DEFAULT_MEDULLA, ...entry?.medulla };
  const posture = { ...DEFAULT_POSTURE, ...entry?.posture };
  // A bot may give only some of the weights; the rest keep their defaults.
  const colliculus = { ...DEFAULT_COLLICULUS, ...entry?.colliculus, weights: { ...DEFAULT_COLLICULUS.weights, ...entry?.colliculus?.weights } };
  const defence = { ...DEFAULT_DEFENCE, ...entry?.defence };
  const memory = { ...DEFAULT_MEMORY, ...entry?.memory };
  const memoryProblem = memory.halfLifeDays > 0 ? null : `memory.halfLifeDays must be above 0, got ${memory.halfLifeDays}`;
  const problem = personalityProblem(personality) ?? patienceProblem(patience) ?? noradrenalineProblem(noradrenaline) ?? focusProblem(focus) ?? brainstemProblem(brainstem) ?? locomotionProblem(locomotion) ?? reflexesProblem(reflexes) ?? medullaProblem(medulla) ?? postureProblem(posture) ?? colliculusProblem(colliculus) ?? defenceProblem(defence) ?? arousalProblem(arousal) ?? memoryProblem;
  if (problem) throw new Error(`${file}: bot "${name}": ${problem}`);
  return { personality, patience, noradrenaline, focus, brainstem, locomotion, reflexes, medulla, posture, colliculus, defence, arousal, memory };
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
