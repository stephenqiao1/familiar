import { bodyFirst, CONFLICT_SIGNAL, createBasalGanglia, DEFAULT_SELECTION, desperateEasesRestraint, HABIT_SIGNAL, share, type SelectionSettings, type Striatum, givenUp, holdForWant, learnedValue, restraint, standingChoice, stay, switching, urgeLoosensStay } from "@familiar/basal-ganglia";
import { patienceOf, selectionInputs, type SelectionParts } from "./selection-inputs.js";
import { bodyOf, partsOf } from "./body-channels.js";
export { patienceOf } from "./selection-inputs.js";
export { createOldArbiter } from "./old-arbiter.js";
import { BURST_SIGNAL, createThalamusRegion, DEFAULT_THALAMUS, type ThalamusSettings } from "@familiar/region-thalamus";
import { createWantsInView } from "./wants.js";
import { COMPETE, createHypothalamusRegion, DEFAULT_DRIVES, describeDrives, DESPERATE_SIGNAL, pressing, STRESS_SIGNAL, UNMET_SIGNAL, type DriveSettings, type Need, type TargetMemory } from "@familiar/region-hypothalamus";
import { createDriveWatch, createReliefIndex, stressOnOutlook } from "./drives.js";
import type { Arbiter, Candidate, DecisionEngine, NeedReading, Planner, Region, Skill, State, Workspace } from "@familiar/contracts";
import { createCerebellumRegion, LARGE_MISMATCH, MISMATCH_SIGNAL, type CerebellumOptions } from "@familiar/region-cerebellum";
import { APPEAL_SIGNAL, createAmygdalaRegion, FEAR_SIGNAL, MATTERS_SIGNAL, NO_READERS, type AmygdalaOptions } from "@familiar/region-amygdala";
import { createMemoryRegion, memoryNotes, type MemoryStore, type Place, type PlaceKeeper } from "@familiar/memory";
import {
  approachableThings,
  rememberedThings,
  asleep,
  curiosity,
  effortSpent,
  describeSituation,
  leaningOf,
  menuSkills,
  moved,
  placeOf,
  startleOf,
  playerBrainstem,
  playerFocus,
  playerInstinct,
  playerMemories,
  createPlayerReflexes,
  DEFAULT_MEDULLA,
  medullaUrges,
  DEFAULT_DEFENCE,
  threatLevel,
  type DefenceSettings,
  playerColliculus,
  playerThalamus,
  DEFAULT_POSTURE,
  wasDisplaced,
  type PostureNotes,
  type PostureSettings,
  playerVitals,
  type MedullaSettings,
  type ReflexSettings,
  bodyNeeds,
  livesOf,
  needsNow,
  newLife,
  playerDayTime,
  playerNeeds,
  TARGET_ADJUSTMENTS,
  playerRewards,
  sleptThroughNight,
  sayNeed,
  playerReticular,
  REFLEX_NOTE,
  situationOf,
  skillsToward,
  thingsInView,
  watchedThings,
  type Storage,
} from "@familiar/minecraft";
import {
  ALARM_JUMP_SIGNAL,
  ALARM_SIGNAL,
  aimAt,
  brakeFactor,
  holdNow,
  reliefOf,
  WANT_SIGNAL,
  createDopamineRegion,
  createFocusRegion,
  justNoticed,
  type Cue,
  createNoradrenalineRegion,
  gettingNowhere,
  CUE_SIGNAL,
  createPatienceRegion,
  DOPAMINE_SIGNAL,
  FOCUS_SIGNAL,
  LOW_FOCUS,
  NEUTRAL_BUDGET,
  type AttentionBudget,
  NEUTRAL_SEARCH,
  INTERRUPT_SIGNAL,
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
  type RewardRule,
  type FocusSettings,
  type NoradrenalineSettings,
  type NoveltyMemory,
  type RewardMoment,
  type PatienceSettings,
  type Persistence,
  type Scorebook,
  type Thing,
} from "@familiar/neuromodulators";
import {
  ANALGESIA_SIGNAL,
  THREAT_SIGNAL,
  AROUSAL_SIGNAL,
  ORIENTING_SIGNAL,
  WARY_SIGNAL,
  createBrainstemRegion,
  createColliculusRegion,
  createMedullaRegion,
  createRateGate,
  createReflexGain,
  createReticularRegion,
  DEFAULT_AROUSAL,
  FRAZZLED_SIGNAL,
  QUIET_SIGNAL,
  UPPER_RATE_SIGNAL,
  type ArousalSettings,
  DEFAULT_COLLICULUS,
  FULL,
  PAIN_SIGNAL,
  TIRED_SIGNAL,
  VITALS_SIGNAL,
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

/** Alarm below this counts as calm enough to consolidate memories. */
const CALM_ALARM = 0.2;
/** The alarm level at which a reflex's gain is exactly 1 (0.6 + 0.8 × 0.5). */
const NEUTRAL_ALARM = 0.5;
/** How often each deciding layer is normally called: the gate stretches these when arousal is low. */
const USUAL_MS = { instinct: 500, planner: 15_000 };
/** The line the planner is given while the bot is over-aroused. */
const FRAZZLED_NOTE = "You are badly rattled right now: keep the plan short and simple, and put safety first.";
/** Fear at its strongest raises alarm to this, before any harm has come. */
const FEAR_ALARM = 0.5;
/** A full mismatch (a movement that went badly wrong) raises alarm to this: a small start, not a fright. */
const MISMATCH_ALARM = 0.2;
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
  /** This bot's arousal: how it sleeps and wakes, and how far arousal reaches (from bots.json). Default: the usual. */
  arousal?: ArousalSettings;
  /** Why the bed skill cannot be started right now, in words (no bed in reach, it is day). Default: no reason given. */
  whyNoSleep?: () => string | null;
  /** This bot's drives: how its needs are read, look ahead, compete and wear it down (from bots.json). Default: all on. */
  drives?: DriveSettings;
  /** This bot's thalamus: what the deciding layers are told of the state (from bots.json). Default: everything in the budget, field of view off. */
  thalamus?: ThalamusSettings;
  /** What the bot has learned about how much is enough. Default: it learns nothing. */
  targets?: TargetMemory;
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
  /** The hippocampus's map and sense of place. Default: none. */
  place?: PlaceKeeper;
  /** Above 0, the hippocampus keeps the order of events and builds "leads to" facts. Default: 0. */
  order?: number;
  /** The amygdala: what it is offered and what it has learned; its settings say how far each reader takes its word. Default: none. */
  amygdala?: AmygdalaOptions;
  /** The cerebellum: the movements it is told of and the models it has learned. Default: none. */
  cerebellum?: CerebellumOptions;
  /** How feared a thing in the state is, 0 to 1, as the amygdala has learned (for the thalamus). Default: nothing is. */
  fearOfThing?: (kind: string, id: string) => number;
  /** For the planner: what lies on the known way from here to a place, in a few words. Default: nothing said. */
  wayTo?: (to: Place) => string | null;
  /** Offer the primitives (look_at, step_toward, ...) on the decision menu. Default: false. */
  showPrimitives?: boolean;
  /** A look may run alongside a skill that leaves the head free. Default: false. */
  sameTime?: boolean;
  /** This bot's basal ganglia settings (from bots.json). Default: all on. */
  selection?: SelectionSettings;
  /** The striatum, whose habits stand in for instinct. Default: none (no habits). */
  striatum?: Striatum;
  /** Extra notes for the focus log: remembered values used or rejected, attention warnings. Default: none. */
  focusNotes?: () => Record<string, unknown>;
  /** The attention budget for this tick: how many of each kind of nearby thing the deciding layers are told of, and how many memories the planner gets. Default: the neutral budget. */
  attentionBudget?: () => AttentionBudget;
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
  const arousal = parts.arousal ?? DEFAULT_AROUSAL;
  const drives = parts.drives ?? DEFAULT_DRIVES;
  const thalamus = parts.thalamus ?? DEFAULT_THALAMUS;
  const selection = parts.selection ?? DEFAULT_SELECTION;
  // How far each reader takes the amygdala's word (all 0 with no amygdala: every reader on its old source).
  const fears = parts.amygdala?.settings?.readers ?? NO_READERS;
  // How far a movement that went wrong reaches focus, alarm and habits (0 with no cerebellum).
  const mismatch = parts.cerebellum?.settings?.mismatch ?? 0;
  // With channels the basal ganglia let a look run beside whatever leaves the head free, so a look need not take over.
  const channels = selection.channels > 0;
  // The needs as the hypothalamus read them; with it left out, the plain reading from the state.
  const needs = (ws: Workspace) => needsNow(ws, drives);
  // Boredom lives in dopamine's novelty memory; the hypothalamus tunes it like any need that can wait.
  const boredom = curiosity(novelty, personality.noveltyBonus);
  const bored: Need = { name: boredom.name, kind: boredom.need, level: (state) => boredom.level?.(state) ?? null, by: "day", spare: true };
  const driveWatch = createDriveWatch();
  const relieves = createReliefIndex(scorebook);
  // With rest read as a need, a night's sleep pays by how tired the bot was: the flat reward for one is not needed.
  const restIsNeed = drives.body > 0 && (!only || (only.includes("hypothalamus") && only.includes("medulla"))) && medulla.vitals > 0;
  // The brainstem sets how strongly each soft reflex and each upkeep urge fires (alarm, bravery, the goal's hold-backs).
  // The upkeep urges take a goal's hold-backs, but not alarm or bravery: needing air is no weaker for being calm.
  const upkeepGain = hasBrainstem && brainstem.holdBack > 0 ? createReflexGain({ settings: brainstem, alarmOf: () => NEUTRAL_ALARM, leaningOf: () => null }) : undefined;
  const gainOf = hasBrainstem && (brainstem.gains > 0 || brainstem.holdBack > 0) ? createReflexGain({ settings: brainstem, alarmOf, leaningOf, threatOf: (ws) => threatLevel(ws.state) }) : undefined;
  const level = (ws: Workspace, signal: string, otherwise = 0) => ws.signals[signal]?.value ?? otherwise;
  const up = (ws: Workspace, signal: string) => (ws.signals[signal]?.value ?? 0) > 0;
  // Over-aroused, instinct is offered fewer options (the far side of the inverted U).
  const wants = createWantsInView();
  /** What the colliculus has got used to, and how much of its salience each thing keeps. */
  let damped: Record<string, number> = {};
  const instinct = playerInstinct(skills, ctx, (ws) => noradrenaline.widerOptions > 0 && (ws.signals[SEARCH_SIGNAL]?.value ?? 0) > WIDER_OPTIONS_ABOVE, parts.showPrimitives, (ws) => up(ws, FRAZZLED_SIGNAL));
  // The graded gate: with arousal low the deciding layers are called less often (never while asleep).
  // A call a signal has asked for at once (an alarm interrupt, a plan that just failed) is never held.
  const gates = { instinct: createRateGate(USUAL_MS.instinct), planner: createRateGate(USUAL_MS.planner) };
  // A near tie the basal ganglia are waiting on sets them to full rate too: what they say next may settle it.
  const held = (gate: keyof typeof gates, ws: Workspace, urgent: boolean) => gates[gate].hold(level(ws, UPPER_RATE_SIGNAL, 1), ws.state.timestamp, urgent || up(ws, CONFLICT_SIGNAL));
  const all: Region[] = [
    createReflexRegion({
      // The lean is the colliculus's to give: with its sky and ground off (or the colliculus left out) the defence takes none.
      rules: createPlayerReflexes(parts.reflexes, posture.righting, { ...defence, lean: hasColliculus && colliculus.fields > 0 && colliculus.elevation > 0 ? defence.lean : 0 }),
      ...(gainOf ? { gainOf } : {}),
    }), //                                                                                  layer 0, every tick
    // The cerebellum: learns what each of the body's movements comes to (how long, how far, which changes) from
    // the error between what it predicted and what happened, and shares `mismatch` when a movement comes out far
    // from its prediction. Straight after the reflexes, so focus, alarm and the striatum read this tick's.
    // Its numbers (pace, each skill's usual time, expectations, timing) go to their readers outside this list.
    ...(parts.cerebellum ? [createCerebellumRegion(parts.cerebellum)] : []), //            layer 0, every tick
    // The medulla: vital signs, and the graded urges of upkeep. Left out (--regions), the hard reflexes above still fire.
    createMedullaRegion({ vitals: playerVitals, share: medulla.vitals, urges: medullaUrges(medulla), asleep, analgesiaOf: (ws) => level(ws, ANALGESIA_SIGNAL), ...(upkeepGain ? { gainOf: upkeepGain } : {}) }), // layer 0, every tick
    // The hypothalamus: reads every need once and shares the reading. Straight after the medulla, so everything
    // after it uses this tick's needs. Left out (--regions), each reader works the same reading out from the state.
    createHypothalamusRegion({
      needs: [...playerNeeds, ...bodyNeeds(drives.body)],
      inner: [bored],
      settings: drives,
      // What wears the body down besides its needs. Alarm is last tick's (noradrenaline runs later).
      // Fear (the amygdala's, last tick's too) wears it down while it lasts, harm or no harm.
      load: (ws) => ({ alarm: alarmOf(ws), pain: level(ws, PAIN_SIGNAL), poorVitals: 1 - level(ws, VITALS_SIGNAL, 1), fear: fears.stress * level(ws, FEAR_SIGNAL) }),
      dayTime: playerDayTime,
      adjustments: TARGET_ADJUSTMENTS,
      ...(parts.targets ? { targets: parts.targets } : {}),
      // A skill that has been learned to relieve a need eases it while it runs.
      relieving: (ws, need) => ws.current !== null && scorebook.get(situationOf(ws.state), reliefOf(ws.current.skill, need)).expected > 0,
      // Unmet: nothing it has learned relieves the need.
      relief: (_ws, need) => relieves.has(need),
      life: livesOf,
    }), //                                                                                  layer 0, every tick
    createBrainstemRegion({
      ...playerBrainstem(skills, ctx, parts.sore, { unsteady: posture.unsteady, ...(parts.postureNotes ? { notes: parts.postureNotes } : {}) }),
      settings: brainstem,
      defenceStrengths: defence,
      alarmOf,
      arousalOf: (ws) => level(ws, AROUSAL_SIGNAL, arousal.resting),
      hardReflex: (ws) => level(ws, REFLEX_SIGNAL) >= 1,
    }), //                                                                                  layer 0, every tick
    // The reticular formation: how awake the bot is, when it sleeps and wakes, and how often the deciding
    // layers are called. After the brainstem, so it hears this tick's threat and startle. Left out (--regions),
    // arousal reads as 0.5 and nothing is ever paused.
    createReticularRegion({
      ...playerReticular(skills, ctx, parts.whyNoSleep),
      settings: arousal,
      alarmOf,
      hardReflex: (ws) => level(ws, REFLEX_SIGNAL) >= 1,
      // Stress keeps the body up only by what is not tiredness itself (being tired is one of the things that wears it down).
      stressOf: (ws) => Math.max(0, level(ws, STRESS_SIGNAL) - level(ws, TIRED_SIGNAL)),
      // (How far that reaches is the bot's arousal.stress.)
    }), //                                                                                  layer 0, every tick
    // The colliculus: the fast map of where things are and how sudden. It turns the head; left out (--regions), nothing does.
    createColliculusRegion({
      ...playerColliculus(skills, channels || parts.sameTime, colliculus.elevation, !channels),
      settings: colliculus,
      // What dopamine wants in view right now draws the eye too (worked out there, last tick).
      wantOf: (kind) => wants.of(kind),
      // What it has got used to, for the thalamus (which tells the deciding layers less of it).
      onDamped: (now) => (damped = now),
      alarmOf,
      arousalOf: (ws) => level(ws, AROUSAL_SIGNAL, 0.5),
      waryOf: (ws) => level(ws, WARY_SIGNAL),
      // A flinch does not count: it runs beside whatever is under way, so a look may still take over.
      spoken: (ws) => up(ws, REFLEX_SIGNAL) || level(ws, STARTLE_SIGNAL) > FULL || up(ws, LOADED_SIGNAL),
    }), //                                                                                  layer 0, every tick
    createFocusRegion({
      // A thing that stood out strongly raises focus for a moment.
      // So does a near tie the basal ganglia are waiting on: look closely while the choice hangs.
      inputs: [...playerFocus(memory), ...(focus.orienting > 0 ? [justNoticed((ws) => focus.orienting * level(ws, ORIENTING_SIGNAL))] : []), ...(selection.wait > 0 ? [{ name: "near_tie", read: (ws: Workspace) => level(ws, CONFLICT_SIGNAL) }] : []), ...(fears.focus > 0 ? [{ name: "promising", read: (ws: Workspace) => fears.focus * level(ws, APPEAL_SIGNAL) }] : []), ...(mismatch > 0 ? [{ name: "mismatch", read: (ws: Workspace) => level(ws, MISMATCH_SIGNAL) }] : [])],
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
      boredom,
      rules: restIsNeed ? playerRewards.filter((rule) => rule !== sleptThroughNight) : playerRewards,
      skillsToward: skillsToward(skills, ctx),
      asleep,
      // A skill that lists no body parts (idle) is rest; one that does not say uses the whole body.
      usesBody: (name) => skills.find((s) => s.name === name)?.parts?.length !== 0,
      // How fast a run is learned from goes by its surprise; one that ends just after something stood out is learned from in full.
      surpriseLearning: focus.surpriseLearning,
      noticed: (ws) => focus.eventLearning * level(ws, ORIENTING_SIGNAL),
      onCues: wants.set,
    }), //                                                                                  layer 0, every tick
    createNoradrenalineRegion({
      // Alarm is read from the same needs; search from whether a pressing one is being answered.
      // Fear counts beside the vital needs: what is around predicts harm, so alarm rises before any has come.
      // A movement that went badly wrong is a small start: only a large mismatch counts.
      needs: (ws) => [...needs(ws), ...(fears.alarm > 0 ? [{ name: "fear", level: fears.alarm * FEAR_ALARM * level(ws, FEAR_SIGNAL), rank: 1, weight: 1 }] : []), ...(level(ws, MISMATCH_SIGNAL) >= LARGE_MISMATCH ? [{ name: "mismatch", level: MISMATCH_ALARM * level(ws, MISMATCH_SIGNAL), rank: 1, weight: 1 }] : [])],
      startle: startleOf,
      // Search rises while a pressing need is not being answered, and while the top need has not eased for minutes whatever the skill reports.
      searchInputs: [gettingNowhere((ws) => unanswered(needs(ws)), (_ws, now) => persistence.status(now)?.progress ?? 0), { name: "unmet", read: (ws) => level(ws, UNMET_SIGNAL) }],
      settings: noradrenaline,
      // Moved somewhere else all at once, or the body now wants something of another kind: the planner should look again.
      replanWhen: (ws: Workspace) => (posture.displaced > 0 && wasDisplaced(ws.state)) || (drives.tellPlanner > 0 && driveWatch.changed(ws)),
    }), //                                                                                  layer 0, every tick
    createMemoryRegion({
      memory,
      triggers: playerMemories(parts.justLearnedHurts, parts.justLearnedBadFoods),
      placeOf,
      factSupport: focus.factSupport,
      // The map: where the bot is (`ws.place`), how unfamiliar that is, and replay.
      ...(parts.place ? { place: parts.place } : {}),
      order: parts.order ?? 0,
      // A fresh memory is stamped by alarm, and by how much the moment matters to the amygdala (good or bad).
      ...(noradrenaline.memoryTag > 0 || fears.memory > 0 ? { alarmOf: (ws: Workspace) => Math.max(noradrenaline.memoryTag > 0 ? level(ws, ALARM_SIGNAL) : 0, fears.memory * level(ws, MATTERS_SIGNAL)) } : {}),
      ...(focus.memoryWrite > 0 ? { focusOf: (ws: Workspace) => level(ws, FOCUS_SIGNAL, focus.resting) } : {}),
      // Consolidate only while resting safely: focus and alarm both very low (in practice, asleep), or a long quiet spell awake.
      ...(focus.consolidation > 0 ? { resting: (ws: Workspace) => level(ws, ALARM_SIGNAL) < CALM_ALARM && (level(ws, FOCUS_SIGNAL, focus.resting) < LOW_FOCUS || up(ws, QUIET_SIGNAL)) } : {}),
    }), //                                                                                  layer 0, every tick
    // The amygdala: learns what predicts harm and good. After the hippocampus, so it knows where the bot is.
    // It shares `fear`, `appeal` and `matters`; each reader takes them by its own strength (amygdala.readers).
    // Left out (--regions), fear reads as 0 and the readers outside this list keep the last thing it learned.
    ...(parts.amygdala ? [createAmygdalaRegion(parts.amygdala)] : []), //                  layer 0, every tick
    // The thalamus: the gateway to the deciding layers. It builds what instinct and the planner are told from
    // the full state: the nearest few of each kind (the attention budget), and only what is in view if that is on.
    // Listed just before instinct, so that instinct reads this tick's view. Left out (--regions), they read the full state.
    createThalamusRegion({
      ...playerThalamus(),
      readers: DECIDERS,
      settings: thalamus,
      nearby: () => (parts.attentionBudget?.() ?? NEUTRAL_BUDGET).nearby,
      // The modulators: what dopamine wants, what the colliculus has got used to, focus, arousal, and how strongly something just stood out.
      wantOf: (kind) => wants.of(kind),
      usedTo: (item) => 1 - Math.min(damped[`thing ${item.id}`] ?? 1, item.place ? (damped[`${item.kind} at ${item.place}`] ?? 1) : 1),
      focusOf: (ws) => level(ws, FOCUS_SIGNAL, focus.resting),
      arousalOf: (ws) => level(ws, AROUSAL_SIGNAL, 0.5),
      orientingOf: (ws) => level(ws, ORIENTING_SIGNAL),
      // What the amygdala has learned to fear is passed on in full.
      ...(parts.fearOfThing ? { fearOf: (item) => parts.fearOfThing!(item.kind, item.id) } : {}),
      // Asleep (or the planner offline), nobody reads a view: none is built.
      paused: (reader, ws) => up(ws, UPPER_PAUSED_SIGNAL) || (reader === PLANNER && up(ws, PLANNER_OFFLINE_SIGNAL)),
      lookSkill: LOOK_SKILL,
    }), //                                                                                  layer 0, every tick
    // The striatum: well-worn choices become habits. Listed before instinct, which is not asked while a habit is acted on.
    ...(parts.striatum && selection.habits > 0 ? [parts.striatum.region] : []), //          layer 0, every tick
    createInstinctRegion({
      // Jev is asked about, and shown, only what the thalamus passes on (`ws.view("instinct")`).
      engine,
      questions: (ws) => instinct.questions(ws),
      toProposals: instinct.toProposals,
      // Asleep and undisturbed: the brainstem pauses the deciding layers, so no engine calls are made.
      // Asleep: no engine calls. Drowsy: fewer. Anything urgent, or an alarm interrupt, goes straight through.
      // Acting on a habit: Jev is not asked (the striatum lets a call through every few seconds).
      paused: (ws) => up(ws, UPPER_PAUSED_SIGNAL) || up(ws, HABIT_SIGNAL) || held("instinct", ws, up(ws, INTERRUPT_SIGNAL) || up(ws, BURST_SIGNAL)),
    }), //                                                                                  layer 1, every tick
    createPatienceRegion({
      // The outlook is worked out from the same needs dopamine is paid for, and from the stress they do not already account for.
      needs: (ws) => [...needs(ws), ...stressOnOutlook(needs(ws), ws.signals[STRESS_SIGNAL]?.value, patience.stress)],
      settings: patience,
      effects: () => ({ persistence: persistence.status(Date.now()) }),
    }), //                                                                                  layer 0, every tick
    createPrefrontalRegion({
      planner,
      describe: (ws) =>
        describeSituation(ws, menu, storage, [
          ...memoryNotes(memory, placeOf(ws.state), ws.state.timestamp, (parts.attentionBudget?.() ?? NEUTRAL_BUDGET).remembered, parts.wayTo),
          ...(hasBrainstem && brainstem.holdBack > 0 ? [REFLEX_NOTE] : []),
          ...(drives.tellPlanner > 0 ? [describeDrives(ws.needs)].filter((line) => line !== null) : []),
        ]),
      guidance: (ws) => {
        const horizon = planningHorizon(patienceOf(ws, patience), patience.horizon);
        const notes = [...(up(ws, RETHINK_SIGNAL) ? [RETHINK_INSTRUCTION] : []), ...(up(ws, FRAZZLED_SIGNAL) ? [FRAZZLED_NOTE] : []), ...(horizon.instruction ? [horizon.instruction] : [])];
        return notes.length ? { ...horizon, instruction: notes.join(" ") } : horizon;
      },
      paused: (ws) => up(ws, PLANNER_OFFLINE_SIGNAL) || up(ws, UPPER_PAUSED_SIGNAL) || held("planner", ws, up(ws, REPLAN_SIGNAL) || up(ws, BURST_SIGNAL)),
      wake: (ws) => up(ws, REPLAN_SIGNAL),
    }), //                                                                                  layer 2, every 15 s
  ];
  if (!only) return all;
  const unknown = only.filter((name) => !all.some((r) => r.name === name));
  if (unknown.length) throw new Error(`Unknown region(s): ${unknown.join(", ")}. Use: ${all.map((r) => r.name).join(", ")}`);
  return all.filter((r) => only.includes(r.name));
}

/**
 * How hard the worst unanswered need presses (0 to 1), for search: the ordinary needs as they
 * press right now (silent while danger does: that is alarm's business), each by its weight.
 */
function unanswered(needs: readonly NeedReading[]): number {
  return Math.min(1, Math.max(0, ...needs.filter((n) => n.rank === 0).map((n) => n.weight * n.pressing)));
}

/** The player's dopamine region: every reward rule, the situation labels and cues, tuned by personality. */
/** The deciding layers: the only regions that read a view of the state. */
const PLANNER = "prefrontal";
export const DECIDERS = ["instinct", PLANNER];
/** The skill that turns the head: its target is not a task. */
const LOOK_SKILL = "look_at";

export function createPlayerDopamine(parts: {
  scorebook: Scorebook;
  novelty: NoveltyMemory;
  personality: DopaminePersonality;
  /** The reward rules for things that happen. Default: every one the player has. */
  rules?: RewardRule[];
  /** Boredom, if something else reads it too (the rule keeps its own level, so there must be only one). Default: made here. */
  boredom?: RewardRule;
  /** The skills that would head toward a thing right now. */
  skillsToward(thing: Thing): string[];
  /** How far the size of a surprise sets how fast it is learned from (0 to 1). Default: 0 (always in full). */
  surpriseLearning?: number;
  /** Asleep: cues propose nothing. Default: never. */
  asleep?(ws: Workspace): boolean;
  /** Something notable just happened, 0 to 1: runs that end just after are learned from in full. Default: never. */
  noticed?(ws: Workspace): number;
  /** Told each tick what is wanted in view. Default: nobody. */
  onCues?(cues: Cue[]): void;
  /** Whether a skill uses any part of the body: time on one that does not is rest, not effort. Default: every skill does. */
  usesBody?(skill: string): boolean;
}): Region {
  const { scorebook, novelty, personality } = parts;
  // Memory of places: what it has learned about and cannot sense now, costed by the walk there.
  const remembered = rememberedThings(() => scorebook.things(), personality.wastedEffort);
  // Boredom is a need too, but it lives in dopamine's own novelty memory, so it is read here beside the body's.
  const boredom = parts.boredom ?? curiosity(novelty, personality.noveltyBonus);
  const bored = (state: State) => {
    const level = boredom.level?.(state);
    return typeof level === "number" && Number.isFinite(level) ? [{ name: boredom.name, kind: boredom.need, level: Math.min(1, Math.max(0, level)), rank: 0, weight: 1 }] : [];
  };
  return createDopamineRegion({
    rules: [...(parts.rules ?? playerRewards), boredom],
    // The needs as the hypothalamus read them (or, with it left out, the same reading from the state).
    // Boredom's level is read here, at dopamine's turn (its rule moves it); how far the time of day
    // and stress quieten it comes from the hypothalamus, when it is there.
    needs: { now: (ws) => pressing([...needsNow(ws), ...bored(ws.state).map((b) => ({ ...b, pressing: b.level * quietened(ws.needs?.inner?.find((n) => n.name === b.name)) }))]), fresh: newLife, say: (name, moment) => sayNeed(name, moment.before, moment.after) },
    situationOf,
    scorebook,
    // Effort that comes to nothing costs something; the personality says how much (0: never).
    ...(personality.wastedEffort > 0 ? { effortOf: (moment: RewardMoment) => personality.wastedEffort * effortSpent(moment, parts.usesBody) } : {}),
    situationWorth: personality.situationWorth,
    wanting: personality.wanting,
    learningRate: personality.learningRate,
    restingDA: personality.restingDA,
    thingsOf: (state) => [...thingsInView(state), ...remembered(state)],
    cueThingsOf: (state) => [...approachableThings(state), ...remembered(state)],
    skillsToward: parts.skillsToward,
    ...(parts.asleep ? { asleep: parts.asleep } : {}),
    ...(parts.surpriseLearning === undefined ? {} : { surpriseLearning: parts.surpriseLearning }),
    ...(parts.noticed ? { noticed: parts.noticed } : {}),
    ...(parts.onCues ? { onCues: parts.onCues } : {}),
  });
}

/** How much of its level a need read by the hypothalamus presses at, before the more vital ones have their say (1 with nothing known). */
function quietened(reading: NeedReading | undefined): number {
  return reading && reading.level > 0 && reading.tuned !== undefined ? reading.tuned / reading.level : 1;
}

/** The striatum's own region: its proposal is a decider's choice made without asking, not a request of the body. */
const STRIATUM = "striatum";
/** Whether a decider's option is a rival to what the body asks: it would use the same body parts, or it is to do nothing with the body at all (idling instead). */
const rivals = (asked: readonly string[] | undefined, option: readonly string[] | undefined) => asked?.length !== 0 && (option?.length === 0 || share(asked, option));
/** A threat this pressing is on the bot: nothing waits. */
const ON_IT = 1;

/**
 * THE BASAL GANGLIA: the one place that decides which proposal goes ahead. Every rule about who
 * wins is a named term in this list (packages/basal-ganglia/src/terms), in order:
 * score = (urgency + the go terms) × the no-go terms; a gate removes a candidate; a term marked
 * "works on" another scales that one's strength. A full-urgency candidate always wins at once.
 * There is one contest for each channel of the body (body-channels.ts), and a near tie is waited
 * on for a moment. To add a rule about who wins, add a term here.
 */
export function createArbiter<Ctx>(parts: SelectionParts<Ctx>): Arbiter {
  const read = selectionInputs(parts);
  const selection = parts.selection ?? DEFAULT_SELECTION;
  const uses = partsOf(parts.skills);
  return createBasalGanglia({
    terms: [
      givenUp({ heldBack: read.heldBack }), //                                       gate: a skill just given up on waits (deciders only)
      standingChoice(), //                                                           the running skill's choice stands while its layer is silent
      learnedValue({ valueOf: read.valueOf }), //                                    go: what dopamine has learned the skill is worth here
      stay({ bonusOf: read.stayOf }), //                                             go: the running skill, while it is getting somewhere
      switching({ factorOf: read.switchingOf }), //                                    on stay: searching makes switching easier
      urgeLoosensStay({ urgeOf: read.urgeOf }), //                                     on stay: a bodily urge loosens it
      holdForWant({ holdOf: read.holdOf }), //                                       no-go: while something is wanted (deciders only)
      restraint({ strengthOf: read.brakeStrengthOf, brake: read.brake }), //         no-go: the patience brake on what has cost the bot (deciders only)
      desperateEasesRestraint({ desperateOf: read.desperateOf, most: read.desperateEases }), // on restraint: a desperate need loosens it
      // no-go: a request of the body holds back the deciders' rivals for the same body parts
      bodyFirst({ strength: selection.bodyFirst, body: (c) => c.layer === 0 && c.region !== STRIATUM, clash: (asks, option, ws) => rivals(uses(asks.action, ws), uses(option.action, ws)) }),
    ],
    body: bodyOf(parts.skills, { channels: selection.channels, ...(parts.sameTime === undefined ? {} : { sameTime: parts.sameTime }) }),
    wait: { strength: selection.wait, pressing: (ws) => (ws.signals[THREAT_SIGNAL]?.value ?? 0) >= ON_IT },
    ...(parts.onChoice ? { onChoice: parts.onChoice } : {}),
  });
}
