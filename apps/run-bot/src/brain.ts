import { createValueWeightedArbiter } from "@familiar/arbiter";
import type { Arbiter, DecisionEngine, Planner, Region, Skill, Workspace } from "@familiar/contracts";
import { createMemoryRegion, memoryNotes, type MemoryStore } from "@familiar/memory";
import {
  approachableThings,
  asleep,
  curiosity,
  describeSituation,
  isShock,
  leaningOf,
  menuSkills,
  moved,
  placeOf,
  playerAlarms,
  playerBrainstem,
  playerFocus,
  playerInstinct,
  playerMemories,
  playerOutlook,
  createPlayerReflexes,
  DEFAULT_MEDULLA,
  medullaUrges,
  createFieldOfView,
  DEFAULT_DEFENCE,
  threatLevel,
  type DefenceSettings,
  playerColliculus,
  toldView,
  DEFAULT_POSTURE,
  wasDisplaced,
  type PostureNotes,
  type PostureSettings,
  playerVitals,
  type MedullaSettings,
  type ReflexSettings,
  playerRewards,
  REFLEX_NOTE,
  situationOf,
  skillsToward,
  thingsInView,
  threatPresent,
  watchedThings,
  type Storage,
} from "@familiar/minecraft";
import {
  ALARM_JUMP_SIGNAL,
  ALARM_SIGNAL,
  brakeFactor,
  createDopamineRegion,
  createFocusRegion,
  createNoradrenalineRegion,
  CUE_SIGNAL,
  createPatienceRegion,
  DOPAMINE_SIGNAL,
  FOCUS_SIGNAL,
  LOW_FOCUS,
  NEUTRAL_BUDGET,
  NEUTRAL_SEARCH,
  PATIENCE_SIGNAL,
  PLANNER_OFFLINE_SIGNAL,
  planningHorizon,
  REPLAN_SIGNAL,
  RETHINK_INSTRUCTION,
  RETHINK_SIGNAL,
  SEARCH_SIGNAL,
  skillValue,
  switchMarginFactor,
  SWITCHING_SIGNAL,
  type DopaminePersonality,
  type FocusSettings,
  type NoradrenalineSettings,
  type NoveltyMemory,
  type PatienceSettings,
  type Persistence,
  type Scorebook,
  type Thing,
} from "@familiar/neuromodulators";
import {
  ANALGESIA_SIGNAL,
  AROUSAL_SIGNAL,
  WARY_SIGNAL,
  createBrainstemRegion,
  createColliculusRegion,
  createMedullaRegion,
  createReflexGain,
  DEFAULT_COLLICULUS,
  FULL,
  LOADED_SIGNAL,
  STARTLE_SIGNAL,
  UPPER_PAUSED_SIGNAL,
  URGE_SIGNAL,
  type BrainstemSettings,
  type ColliculusSettings,
} from "@familiar/region-brainstem";
import { createInstinctRegion } from "@familiar/region-instinct";
import { createPrefrontalRegion } from "@familiar/region-prefrontal";
import { createReflexRegion, REFLEX_SIGNAL } from "@familiar/region-reflex";

/** How long a learning window stays open after a notable event. */
const LEARNING_WINDOW_MS = 2000;
/** Alarm below this counts as calm enough to consolidate memories. */
const CALM_ALARM = 0.2;
/** The alarm level at which a reflex's gain is exactly 1 (0.6 + 0.8 × 0.5). */
const NEUTRAL_ALARM = 0.5;
/** Above this search level, more of the engine's options are offered. */
const WIDER_OPTIONS_ABOVE = 0.6;

/** What the regions are built from. */
export interface BrainParts<Ctx> {
  /** Answers the instinct region's questions. */
  engine: DecisionEngine;
  /** Makes the prefrontal region's plans. */
  planner: Planner;
  /** What dopamine has learned about each skill in each situation. */
  scorebook: Scorebook;
  /** How many times the bot has met each kind of thing. */
  novelty: NoveltyMemory;
  /** This bot's dopamine temperament (from bots.json). */
  personality: DopaminePersonality;
  /** This bot's patience temperament (from bots.json). */
  patience: PatienceSettings;
  /** This bot's alarm and search temperament (from bots.json). */
  noradrenaline: NoradrenalineSettings;
  /** This bot's focus temperament (from bots.json). */
  focus: FocusSettings;
  /** This bot's brainstem temperament: bravery, and how strong each reflex-tuning part is (from bots.json). */
  brainstem: BrainstemSettings;
  /** This bot's protective reflexes (from bots.json). Default: all on, born knowing the usual five. */
  reflexes?: ReflexSettings;
  /** This bot's medulla: its upkeep urges and vital signs (from bots.json). Default: all on. */
  medulla?: MedullaSettings;
  /** This bot's posture: its balance, righting reflex and reaction to being moved (from bots.json). Default: all on. */
  posture?: PostureSettings;
  /** This bot's defence: what it is born knowing about threats, and the strength of each part of the defence circuit (from bots.json). Default: all on. */
  defence?: DefenceSettings;
  /** What the posture system did since last asked (refusals, stance holds, falls, things learned), for the trace. Default: nothing. */
  postureNotes?: () => PostureNotes;
  /** This bot's colliculus: what makes something striking, and how easily it turns its head (from bots.json). Default: the usual weights, field of view off. */
  colliculus?: ColliculusSettings;
  /** The foods the bot has just learned are bad, for remembering. Default: it learns none. */
  justLearnedBadFoods?: () => string[];
  /** How sore the bot is right now (1 just after pulling away from pain, fading to 0). Default: never. */
  sore?: () => number;
  /** The block types the bot has just learned hurt, for remembering. Default: it learns none. */
  justLearnedHurts?: () => string[];
  /** Offer the primitives (look_at, step_toward, ...) on the decision menu. Default: false. */
  showPrimitives?: boolean;
  /** A look may run alongside a skill that leaves the head free. Default: false. */
  sameTime?: boolean;
  /** Extra notes for the focus log: remembered values used or rejected, attention warnings. Default: none. */
  focusNotes?: () => Record<string, unknown>;
  /** How many memories to give the planner right now (the attention budget). Default: 5. */
  memoriesForPlanner?: () => number;
  /** What the bot remembers of events and places. */
  memory: MemoryStore;
  /** The "should I quit?" step for the running skill; its status is logged with patience. */
  persistence: Persistence;
  /** What the bot remembers about its chests, for the planner. */
  storage: Storage;
  skills: Skill<Ctx>[];
  ctx: Ctx;
}

/**
 * THE BRAIN: every region, in one list. Regions never call each other; they share the workspace,
 * and the arbiter picks among their proposals (urgency plus learned value; ties go to the faster layer).
 *
 * To add a region: write it (its own package, or a file), then add one line here.
 * To run without some regions (a lesion experiment): --regions reflex,instinct
 */
export function createBrain<Ctx>(parts: BrainParts<Ctx>, only?: string[]): Region[] {
  const { engine, planner, scorebook, novelty, personality, patience, noradrenaline, focus, brainstem, memory, persistence, storage, skills, ctx } = parts;
  const menu = menuSkills(skills, parts.showPrimitives);
  // With the brainstem lesioned (--regions), reflex gains stay at 1 and nothing is ever paused.
  const hasBrainstem = !only || only.includes("brainstem");
  const hasColliculus = !only || only.includes("colliculus");
  const alarmOf = (ws: Workspace) => ws.signals[ALARM_SIGNAL]?.value ?? 0;
  const medulla = parts.medulla ?? DEFAULT_MEDULLA;
  const posture = parts.posture ?? DEFAULT_POSTURE;
  const colliculus = parts.colliculus ?? DEFAULT_COLLICULUS;
  const defence = parts.defence ?? DEFAULT_DEFENCE;
  // With the field of view on, the deciding layers are told only what the bot sees, hears or just saw.
  const view = colliculus.fieldOfView > 0 ? createFieldOfView() : null;
  const told = (ws: Workspace) => (view ? toldView(ws, view.tell(ws.state)) : ws);
  // The brainstem sets how strongly each soft reflex and each upkeep urge fires (alarm, bravery, the goal's hold-backs).
  // The upkeep urges take a goal's hold-backs, but not alarm or bravery: needing air is no weaker for being calm.
  const upkeepGain = hasBrainstem && brainstem.holdBack > 0 ? createReflexGain({ settings: brainstem, alarmOf: () => NEUTRAL_ALARM, leaningOf: () => null }) : undefined;
  const gainOf = hasBrainstem && (brainstem.gains > 0 || brainstem.holdBack > 0) ? createReflexGain({ settings: brainstem, alarmOf, leaningOf, threatOf: (ws) => threatLevel(ws.state) }) : undefined;
  const level = (ws: Workspace, signal: string, otherwise = 0) => ws.signals[signal]?.value ?? otherwise;
  const up = (ws: Workspace, signal: string) => (ws.signals[signal]?.value ?? 0) > 0;
  const instinct = playerInstinct(skills, ctx, (ws) => noradrenaline.widerOptions > 0 && (ws.signals[SEARCH_SIGNAL]?.value ?? 0) > WIDER_OPTIONS_ABOVE, parts.showPrimitives);
  const all: Region[] = [
    createReflexRegion({
      rules: createPlayerReflexes(parts.reflexes, posture.righting, defence),
      ...(gainOf ? { gainOf } : {}),
    }), //                                                                                  layer 0, every tick
    // The medulla: vital signs, and the graded urges of upkeep. Left out (--regions), the hard reflexes above still fire.
    createMedullaRegion({ vitals: playerVitals, share: medulla.vitals, urges: medullaUrges(medulla), asleep, analgesiaOf: (ws) => level(ws, ANALGESIA_SIGNAL), ...(upkeepGain ? { gainOf: upkeepGain } : {}) }), // layer 0, every tick
    createBrainstemRegion({
      ...playerBrainstem(skills, ctx, parts.sore, { unsteady: posture.unsteady, ...(parts.postureNotes ? { notes: parts.postureNotes } : {}) }),
      settings: brainstem,
      defenceStrengths: defence,
      alarmOf,
      hardReflex: (ws) => level(ws, REFLEX_SIGNAL) >= 1,
    }), //                                                                                  layer 0, every tick
    // The colliculus: the fast map of where things are and how sudden. It turns the head; left out (--regions), nothing does.
    createColliculusRegion({
      ...playerColliculus(skills, parts.sameTime),
      settings: colliculus,
      alarmOf,
      arousalOf: (ws) => level(ws, AROUSAL_SIGNAL, 0.5),
      waryOf: (ws) => level(ws, WARY_SIGNAL),
      // A flinch does not count: it runs beside whatever is under way, so a look may still take over.
      spoken: (ws) => up(ws, REFLEX_SIGNAL) || level(ws, STARTLE_SIGNAL) > FULL || up(ws, LOADED_SIGNAL),
    }), //                                                                                  layer 0, every tick
    createFocusRegion({
      inputs: playerFocus(memory, skills),
      settings: focus,
      asleep,
      moved,
      ...(focus.cuePulse > 0 ? { watched: watchedThings, skillsToward: skillsToward(skills, ctx) } : {}),
      ...(parts.focusNotes ? { notes: parts.focusNotes } : {}),
    }), //                                                                                  layer 0, every tick
    createPlayerDopamine({
      scorebook,
      novelty,
      personality,
      skillsToward: skillsToward(skills, ctx),
      // A learning window opens on a notable reward, an alarm jump or a cue.
      ...(focus.learningWindow > 0 ? { learningWindow: { ms: LEARNING_WINDOW_MS, notable: (ws: Workspace) => up(ws, ALARM_JUMP_SIGNAL) || up(ws, CUE_SIGNAL) } } : {}),
    }), //                                                                                  layer 0, every tick
    createNoradrenalineRegion({
      triggers: playerAlarms(focus.noisyOrChanged > 0),
      threatPresent,
      settings: noradrenaline,
      // Moved somewhere else all at once: whatever the plan was, the planner should look again.
      ...(posture.displaced > 0 ? { replanWhen: (ws: Workspace) => wasDisplaced(ws.state) } : {}),
    }), //                                                                                  layer 0, every tick
    createMemoryRegion({
      memory,
      triggers: playerMemories(parts.justLearnedHurts, parts.justLearnedBadFoods),
      placeOf,
      factSupport: focus.factSupport,
      ...(noradrenaline.memoryTag > 0 ? { alarmOf: (ws: Workspace) => level(ws, ALARM_SIGNAL) } : {}),
      ...(focus.memoryWrite > 0 ? { focusOf: (ws: Workspace) => level(ws, FOCUS_SIGNAL, focus.resting) } : {}),
      // Consolidate only while resting safely: focus and alarm both very low (in practice, asleep).
      ...(focus.consolidation > 0 ? { resting: (ws: Workspace) => level(ws, FOCUS_SIGNAL, focus.resting) < LOW_FOCUS && level(ws, ALARM_SIGNAL) < CALM_ALARM } : {}),
    }), //                                                                                  layer 0, every tick
    createInstinctRegion({
      // Jev is asked about, and shown, only what the bot is told (everything, unless the field of view is on).
      engine: view ? { ...engine, decide: (state, questions) => engine.decide(view.tell(state), questions) } : engine,
      questions: (ws) => instinct.questions(told(ws)),
      toProposals: instinct.toProposals,
      // Asleep and undisturbed: the brainstem pauses the deciding layers, so no engine calls are made.
      paused: (ws) => up(ws, UPPER_PAUSED_SIGNAL),
    }), //                                                                                  layer 1, every tick
    createPatienceRegion({
      inputs: playerOutlook,
      settings: patience,
      // Sudden danger cuts patience: an alarm jump, or patience's own check when that link is off.
      isShock: noradrenaline.patienceLink > 0 ? (_before, _after, ws) => up(ws, ALARM_JUMP_SIGNAL) : isShock,
      effects: () => ({ persistence: persistence.status(Date.now()) }),
    }), //                                                                                  layer 0, every tick
    createPrefrontalRegion({
      planner,
      describe: (ws) =>
        describeSituation(told(ws), menu, storage, [
          ...memoryNotes(memory, placeOf(ws.state), ws.state.timestamp, parts.memoriesForPlanner?.() ?? NEUTRAL_BUDGET.remembered),
          ...(hasBrainstem && brainstem.holdBack > 0 ? [REFLEX_NOTE] : []),
        ]),
      guidance: (ws) => {
        const horizon = planningHorizon(patienceOf(ws, patience), patience.horizon);
        if (!up(ws, RETHINK_SIGNAL)) return horizon;
        return { ...horizon, instruction: [RETHINK_INSTRUCTION, ...(horizon.instruction ? [horizon.instruction] : [])].join(" ") };
      },
      paused: (ws) => up(ws, PLANNER_OFFLINE_SIGNAL) || up(ws, UPPER_PAUSED_SIGNAL),
      wake: (ws) => up(ws, REPLAN_SIGNAL),
    }), //                                                                                  layer 2, every 15 s
  ];
  if (!only) return all;
  const unknown = only.filter((name) => !all.some((r) => r.name === name));
  if (unknown.length) throw new Error(`Unknown region(s): ${unknown.join(", ")}. Use: ${all.map((r) => r.name).join(", ")}`);
  return all.filter((r) => only.includes(r.name));
}

/** The player's dopamine region: every reward rule, the situation labels and cues, tuned by personality. */
export function createPlayerDopamine(parts: {
  scorebook: Scorebook;
  novelty: NoveltyMemory;
  personality: DopaminePersonality;
  /** The skills that would head toward a thing right now. */
  skillsToward(thing: Thing): string[];
  /** Learn in full only for `ms` after a notable event. Default: always learn in full. */
  learningWindow?: { ms: number; notable(ws: Workspace): boolean };
}): Region {
  const { scorebook, novelty, personality, learningWindow } = parts;
  return createDopamineRegion({
    rules: [...playerRewards, curiosity(novelty, personality.noveltyBonus)],
    situationOf,
    scorebook,
    learningRate: personality.learningRate,
    restingDA: personality.restingDA,
    thingsOf: thingsInView,
    cueThingsOf: approachableThings,
    skillsToward: parts.skillsToward,
    ...(learningWindow ? { learningWindowMs: learningWindow.ms, notable: learningWindow.notable } : {}),
  });
}

/** The current patience, or the bot's resting level when the serotonin region is off. */
export function patienceOf(ws: Pick<Workspace, "signals">, patience: PatienceSettings): number {
  return ws.signals[PATIENCE_SIGNAL]?.value ?? patience.resting;
}

/**
 * THE ARBITER: picks by urgency, nudged by what dopamine has learned about each skill in the
 * current situation (weighed by the current DA level). Patience adds a bonus for staying with the
 * running skill (smaller when search is high or the body has an urge, so switching gets easier)
 * and brakes risky skills.
 * A full-urgency reflex always wins.
 */
export function createArbiter<Ctx>(parts: {
  scorebook: Scorebook;
  personality: DopaminePersonality;
  patience: PatienceSettings;
  /** Default: no bonus for the running skill. */
  persistence?: Persistence;
  skills: Skill<Ctx>[];
}): Arbiter {
  const { scorebook, personality, patience, persistence } = parts;
  const risky = new Set(parts.skills.filter((s) => s.risky).map((s) => s.name));
  return createValueWeightedArbiter({
    valueOf: (skill, ws) =>
      skillValue(scorebook.get(situationOf(ws.state), skill), ws.signals[DOPAMINE_SIGNAL]?.value ?? personality.restingDA),
    // A body that is asking for something loosens the hold of whatever is running: the stay bonus
    // shrinks as the medulla's urge grows, so a pressing need is not outvoted by habit alone.
    bonusOf: (skill, ws) =>
      (persistence?.stayBonus(skill, Date.now()) ?? 0) *
      switchMarginFactor(ws.signals[SWITCHING_SIGNAL]?.value ?? NEUTRAL_SEARCH) *
      (1 - (ws.signals[URGE_SIGNAL]?.value ?? 0)),
    scaleOf: (skill, ws) => (risky.has(skill) ? brakeFactor(patienceOf(ws, patience), patience.brake) : 1),
  });
}
