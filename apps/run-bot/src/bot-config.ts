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
import { DEFAULT_SELECTION, selectionProblem, type SelectionSettings } from "@familiar/basal-ganglia";
import { DEFAULT_DRIVES, drivesProblem, type DriveSettings } from "@familiar/region-hypothalamus";
import { DEFAULT_THALAMUS, thalamusProblem, type ThalamusSettings } from "@familiar/region-thalamus";
import { cingulateProblem, DEFAULT_CINGULATE, type CingulateReaders, type CingulateSettings } from "@familiar/region-cingulate";
import { DEFAULT_INSULA, insulaProblem, type InsulaSettings } from "@familiar/region-insula";
import { cortexProblem, DEFAULT_CORTEX, type CortexSettings } from "@familiar/neocortex";
import { cerebellumProblem, DEFAULT_CEREBELLUM, type CerebellumSettings } from "@familiar/region-cerebellum";
import { amygdalaProblem, DEFAULT_AMYGDALA, type AmygdalaReaders, type AmygdalaSettings } from "@familiar/region-amygdala";
import { arousalProblem, brainstemProblem, colliculusProblem, DEFAULT_AROUSAL, DEFAULT_BRAINSTEM, DEFAULT_COLLICULUS, type ArousalSettings, type BrainstemSettings, type ColliculusSettings } from "@familiar/region-brainstem";

// Every bot's settings live in one file, keyed by bot name. A bot with no entry, or a setting
// left out, gets the default. A bad value stops the bot at startup with a clear error.

// FAMILIAR_BOTS_FILE names another file (the live checks use it to run one bot with other settings).
const DEFAULT_BOTS_FILE = process.env.FAMILIAR_BOTS_FILE || "bots.json";

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
  /** Drives: how the needs are read, look ahead, compete and wear the bot down, and how much each weighs. */
  drives: DriveSettings;
  /** The thalamus: what the deciding layers are told of the state. */
  thalamus: ThalamusSettings;
  /** The basal ganglia: how strongly the body's requests hold back the deciders, waiting on a near tie, channels, and habits. */
  selection: SelectionSettings;
  memory: MemorySettings;
  /** The amygdala: how it learns what predicts harm and good, and how far each reader takes its word. */
  amygdala: AmygdalaSettings;
  /** The cerebellum: how it learns what each movement comes to, and how far each reader goes by it (0 = the fixed rule). */
  cerebellum: CerebellumSettings;
  /** The cortex: the motor area, conditions, graded hold-backs and the goal channel (0 = two areas that only pass the goal down). */
  cortex: CortexSettings;
  /** The insula: how the bot feels, and whether the deciding layers are told the feeling line, the numbers or both. */
  insula: InsulaSettings;
  /** The cingulate: how trouble is gathered and weighed, and the budget for thinking. */
  cingulate: CingulateSettings;
}

export interface MemorySettings {
  /** How long a weak memory takes to lose half its strength, in in-game days (20 minutes each). */
  halfLifeDays: number;
  /** The hippocampus's map: how fast a place becomes familiar, 0 to 1. 0: no map is kept. */
  map: number;
  /** The order of events: memories link to the one before, good and bad are kept apart, "leads to" facts are built. 0: off. */
  order: number;
  /** Replay on the map: how strongly "led to good" and "led to harm" are marked, 0 to 1. 0: no replay. */
  replay: number;
  /** Locomotion is given known spots to pass on the way to somewhere out of sight. 0: off. */
  waypoints: number;
}

export const DEFAULT_MEMORY: MemorySettings = { halfLifeDays: 2, map: 1, order: 1, replay: 1, waypoints: 1 };
/** Every hippocampus addition off: memory as it was before the map. */
export const NO_MAP = { map: 0, order: 0, replay: 0, waypoints: 0 };

function memoryProblem(memory: MemorySettings): string | null {
  if (!(memory.halfLifeDays > 0)) return `memory.halfLifeDays must be above 0, got ${memory.halfLifeDays}`;
  for (const key of ["map", "order", "replay", "waypoints"] as const) {
    const n = memory[key];
    if (typeof n !== "number" || !(n >= 0 && n <= 1)) return `memory.${key} must be between 0 and 1, got ${n}`;
  }
  return null;
}

export async function loadBotConfig(name: string, file = DEFAULT_BOTS_FILE): Promise<BotConfig> {
  const bots = await readBots(file);
  const entry = bots[name] as
    | { personality?: Partial<DopaminePersonality>; patience?: Partial<PatienceSettings>; noradrenaline?: Partial<NoradrenalineSettings>; focus?: Partial<FocusSettings>; brainstem?: Partial<BrainstemSettings> & { arousalGate?: number }; locomotion?: Partial<LocomotionSettings>; reflexes?: Partial<ReflexSettings>; medulla?: Partial<MedullaSettings>; colliculus?: Partial<ColliculusSettings> & { fieldOfView?: number }; thalamus?: Partial<ThalamusSettings>; posture?: Partial<PostureSettings>; defence?: Partial<DefenceSettings>; arousal?: Partial<ArousalSettings>; drives?: Partial<DriveSettings>; selection?: Partial<SelectionSettings>; memory?: Partial<MemorySettings>; amygdala?: Partial<Omit<AmygdalaSettings, "readers">> & { readers?: Partial<AmygdalaReaders> }; cerebellum?: Partial<Omit<CerebellumSettings, "bounds">>; cortex?: Partial<CortexSettings>; insula?: Partial<InsulaSettings>; cingulate?: Partial<Omit<CingulateSettings, "readers">> & { readers?: Partial<CingulateReaders> } }
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
  // The field of view moved to the thalamus; the old place still works.
  const { fieldOfView: oldFieldOfView, ...colliculusEntry } = entry?.colliculus ?? {};
  if (oldFieldOfView !== undefined) console.warn(`${file}: bot "${name}": colliculus.fieldOfView is now thalamus.fieldOfView; the old name still works${entry?.thalamus?.fieldOfView !== undefined ? ", but thalamus.fieldOfView is set too and wins" : ""}.`);
  const colliculus = { ...DEFAULT_COLLICULUS, ...colliculusEntry, weights: { ...DEFAULT_COLLICULUS.weights, ...entry?.colliculus?.weights } };
  const thalamus = { ...DEFAULT_THALAMUS, ...(oldFieldOfView === undefined ? {} : { fieldOfView: oldFieldOfView }), ...entry?.thalamus, limits: { ...DEFAULT_THALAMUS.limits, ...entry?.thalamus?.limits } };
  const defence = { ...DEFAULT_DEFENCE, ...entry?.defence };
  // A bot may give only some of the weights; the rest keep their defaults.
  const drives = { ...DEFAULT_DRIVES, ...entry?.drives, weights: { ...DEFAULT_DRIVES.weights, ...entry?.drives?.weights } };
  const selection = { ...DEFAULT_SELECTION, ...entry?.selection, habit: { ...DEFAULT_SELECTION.habit, ...entry?.selection?.habit } };
  const memory = { ...DEFAULT_MEMORY, ...entry?.memory };
  const memoryIssue = memoryProblem(memory);
  // A bot may give only some of the readers; the rest keep their defaults.
  const amygdala = { ...DEFAULT_AMYGDALA, ...entry?.amygdala, readers: { ...DEFAULT_AMYGDALA.readers, ...entry?.amygdala?.readers } };
  const cerebellum = { ...DEFAULT_CEREBELLUM, ...entry?.cerebellum, bounds: DEFAULT_CEREBELLUM.bounds };
  const cortex = { ...DEFAULT_CORTEX, ...entry?.cortex };
  const insula = { ...DEFAULT_INSULA, ...entry?.insula };
  // A bot may give only some of the readers; the rest keep their defaults.
  const cingulate = { ...DEFAULT_CINGULATE, ...entry?.cingulate, readers: { ...DEFAULT_CINGULATE.readers, ...entry?.cingulate?.readers } };
  const problem = personalityProblem(personality) ?? patienceProblem(patience) ?? noradrenalineProblem(noradrenaline) ?? focusProblem(focus) ?? brainstemProblem(brainstem) ?? locomotionProblem(locomotion) ?? reflexesProblem(reflexes) ?? medullaProblem(medulla) ?? postureProblem(posture) ?? colliculusProblem(colliculus) ?? defenceProblem(defence) ?? arousalProblem(arousal) ?? drivesProblem(drives) ?? thalamusProblem(thalamus) ?? selectionProblem(selection) ?? memoryIssue ?? amygdalaProblem(amygdala) ?? cerebellumProblem(cerebellum) ?? cortexProblem(cortex) ?? insulaProblem(insula) ?? cingulateProblem(cingulate);
  if (problem) throw new Error(`${file}: bot "${name}": ${problem}`);
  return { personality, patience, noradrenaline, focus, brainstem, locomotion, reflexes, medulla, posture, colliculus, defence, arousal, drives, thalamus, selection, memory, amygdala, cerebellum, cortex, insula, cingulate };
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
