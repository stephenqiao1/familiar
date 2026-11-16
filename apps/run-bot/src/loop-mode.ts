import type { Action, Candidate, SkillEvent, TickLog } from "@familiar/contracts";
import { createBrainLoop, createChainSkill, createLogger, createSkillExecutor, createWorkspace, defaultLogPath } from "@familiar/core";
import { feelingNear, type Place } from "@familiar/memory";
import {
  createFirstSeenTracker,
  createLocomotion,
  DEFENCE_REFLEXES,
  driveFrom,
  encodeState,
  headFree,
  isSignificantChange,
  minecraftSkills,
  primitives,
  tidyBody,
  posId,
  situationOf,
  threatPresent,
  trackBodyEvents,
  withTrust,
  type MinecraftCtx,
  type MinecraftStateData,
  type RememberedLookup,
} from "@familiar/minecraft";
import {
  ALARM_SIGNAL,
  chanceOfPayoff,
  createAttention,
  createPersistence,
  FOCUS_SIGNAL,
  INTERRUPT_SIGNAL,
  NEUTRAL_BUDGET,
  REWARD_SIGNAL,
  trustOf,
} from "@familiar/neuromodulators";
import { createDefenceWatch, isHeldBack, UPPER_PAUSED_SIGNAL } from "@familiar/region-brainstem";
import { REFLEX_SIGNAL, type FiredReflex } from "@familiar/region-reflex";
import type { BrainArgs, ServerArgs } from "./args.js";
import { loadBotConfig } from "./bot-config.js";
import { createArbiter, createBrain, patienceOf } from "./brain.js";
import { createEngine, createPlanner } from "./create-engine.js";
import {
  chestsFile,
  learnedSkillsFile,
  loadChests,
  loadLearnedSkills,
  loadMemories,
  loadNovelty,
  loadScorebook,
  memoriesFile,
  noveltyFile,
  saveChests,
  saveMemories,
  saveNovelty,
  saveScorebook,
  scorebookFile,
} from "./memory-store.js";
import { formatChanges, formatSkillEvent } from "./format-skill-event.js";
import { formatTick } from "./format-tick.js";
import { joinWithBase } from "./join.js";

const ROLE = "player";
/** How often to save what the bot has learned and remembers, so a crash loses at most this much. */
const SAVE_LEARNING_MS = 30_000;
/** The regular time between ticks, and the shortest it gets at full alarm. */
const TICK_MS = 500;
const FASTEST_TICK_MS = 150;
/** Above this alarm the bot attends only to threats. */
const NARROW_ABOVE = 0.6;
/** One in-game day, in ms. */
const GAME_DAY_MS = 1_200_000;

/**
 * The decision loop: each tick encodes the state, runs the brain's regions, and starts the
 * winning proposal's skill through the skill executor if it differs from the one running.
 * Runs until Ctrl+C.
 */
export async function runLoop(server: ServerArgs, brainArgs: BrainArgs): Promise<void> {
  // Read the settings first, so a bad bots.json stops the bot before it joins.
  const { personality, patience, noradrenaline, focus: focusSettings, brainstem, locomotion: locomotionSettings, memory: memorySettings } = await loadBotConfig(server.name);
  const { bot, base } = await joinWithBase(server);
  const engine = createEngine(brainArgs.engine);
  const planner = createPlanner(brainArgs.planner, brainArgs.plan);
  const scorebook = await loadScorebook(scorebookFile(server.name));
  const novelty = await loadNovelty(noveltyFile(server.name));
  const chests = await loadChests(chestsFile(server.name));
  const memory = await loadMemories(memoriesFile(server.name), { halfLifeMs: memorySettings.halfLifeDays * GAME_DAY_MS });
  /** Keeps the fixed known places up to date: base chest, bed, and every chest the bot has opened. */
  const namePlaces = () => {
    const at = (p: { x: number; y: number; z: number }): Place => ({ x: p.x, y: p.y, z: p.z, dimension: bot.game.dimension });
    memory.namePlace("base chest", at(base.chest));
    memory.namePlace("bed", at(base.bed));
    for (const id of Object.keys(chests.entries())) {
      const [x, y, z] = id.replace("pos:", "").split(",").map(Number) as [number, number, number];
      if (id !== posId(base.chest)) memory.namePlace(`chest ${id}`, at({ x, y, z }));
    }
  };
  namePlaces();
  // Learned skills are chains of primitives kept as data; none ship with the bot.
  const learned = await loadLearnedSkills(learnedSkillsFile(server.name), primitives.map((s) => s.name), minecraftSkills.map((s) => s.name));
  for (const problem of learned.problems) console.error(`Learned skill left out: ${problem}`);
  const skills = [...minecraftSkills, ...learned.skills.map((s) => createChainSkill(s, primitives, tidyBody))];
  const workspace = createWorkspace();
  const view = workspace.viewFor("run-bot");
  const focus = () => view.signals[FOCUS_SIGNAL]?.value ?? focusSettings.resting;

  // Focus, effect a: a remembered chest is believed only while trust in it (fading with age) is
  // above focus. Otherwise it reads as unknown, so the bot goes and checks. Every lookup is logged.
  const lookups: RememberedLookup[] = [];
  const trustHalfLifeMs = focusSettings.trustHalfLifeMinutes * 60_000;
  const believedChests =
    focusSettings.sensesVsMemory > 0 ? withTrust(chests, (seenAt) => trustOf(Date.now() - seenAt, trustHalfLifeMs) > focus(), (lookup) => lookups.push(lookup)) : chests;
  // Focus, effect b: how much nearby detail and how many memories are taken in.
  const attention = createAttention();
  const budget = () => (focusSettings.attention > 0 ? attention.budget(focus(), Date.now()) : NEUTRAL_BUDGET);
  let swamped: string | null = null;
  /** What the focus region logs each tick: remembered values used or rejected, and attention warnings. */
  const focusNotes = () => {
    const remembered = lookups.splice(0);
    const warning = swamped;
    swamped = null;
    return { ...(remembered.length ? { remembered } : {}), ...(warning ? { attention: warning } : {}) };
  };

  // The one thing that travels. Careful (no digging) near home; its notes go to the console.
  const locomotion = createLocomotion(bot, { home: base.chest, log: (msg) => console.log(`    ${msg}`) });
  const ctx: MinecraftCtx = {
    bot,
    base,
    locomotion,
    wants: () => workspace.goal()?.wants ?? [],
    chests: believedChests,
    log: (msg) => console.log(`    ${msg}`),
  };
  const storage = { chests: believedChests, baseChest: posId(base.chest) };
  const persistence = createPersistence({
    patience: () => patienceOf(view, patience),
    chanceOf: (skill) => chanceOfPayoff(scorebook.get(situationOf(view.state), skill)),
    strength: patience.persistence,
  });
  const regions = createBrain(
    {
      engine,
      planner,
      scorebook,
      novelty,
      personality,
      patience,
      noradrenaline,
      focus: focusSettings,
      brainstem,
      showPrimitives: brainArgs.primitives ?? false,
      sameTime: brainArgs.sameTime ?? false,
      focusNotes,
      memoriesForPlanner: () => budget().remembered,
      memory,
      persistence,
      storage,
      skills,
      ctx,
    },
    brainArgs.regions,
  );
  const logPath = defaultLogPath(ROLE);
  console.log(`Regions: ${regions.map((r) => r.name).join(", ")}. Engine: ${engine.name}. Planner: ${planner.name}.`);
  console.log(`Personality: resting DA ${personality.restingDA}, learning step ${personality.learningRate}, novelty bonus ${personality.noveltyBonus}.`);
  console.log(
    `Patience: resting ${patience.resting}, time constant ${patience.timeConstantSeconds}s, effects: persistence ${patience.persistence}, horizon ${patience.horizon}, brake ${patience.brake}.`,
  );
  console.log(
    `Alarm: gain ${noradrenaline.alarmGain}, fades in ${noradrenaline.alarmDecaySeconds}s. Search: resting ${noradrenaline.searchResting}. Memories: ${memory.entries().memories.length} remembered.`,
  );
  console.log(`Focus: resting ${focusSettings.resting}, trust in remembered things halves every ${focusSettings.trustHalfLifeMinutes} min.`);
  console.log(`Brainstem: bravery ${brainstem.bravery}, reflex gains ${brainstem.gains}, hold-back ${brainstem.holdBack}, arousal gate ${brainstem.arousalGate}.`);
  if (learned.skills.length) console.log(`Learned skills: ${learned.skills.map((s) => s.name).join(", ")}.`);
  console.log(`Logging to ${logPath}`);

  const pendingEvents: SkillEvent[] = [];
  const onEvent = (event: SkillEvent) => {
    pendingEvents.push(event);
    workspace.addEvent(event);
    persistence.observe(event);
    logEvent(event);
  };
  const logEvent = (event: SkillEvent) => {
    const changes = formatChanges(event);
    console.log(`  ${formatSkillEvent(event)}${changes ? `  [${changes}]` : ""}`);
  };
  // A movement run alongside the main skill is logged, but it is not the bot's "current skill":
  // the brain's regions (rewards, persistence) never see it.
  const onSideEvent = (event: SkillEvent) => {
    pendingEvents.push(event);
    logEvent(event);
  };
  const executor = createSkillExecutor({ skills, ctx, onEvent, onSideEvent, defaultTimeoutMs: persistence.backstopMs() });
  /** With --same-time: a head-only movement runs alongside a running skill that leaves the head free. */
  const skillNamed = (name: string | undefined) => skills.find((s) => s.name === name);
  const runsAlongside = (c: Candidate) => {
    if (!("skill" in c.action)) return false;
    const parts = skillNamed(c.action.skill)?.parts;
    return parts?.length === 1 && parts[0] === "head" && headFree(skillNamed(executor.current()?.skill));
  };

  const alarm = () => view.signals[ALARM_SIGNAL]?.value ?? 0;
  let lastReward = 0;
  let lastInterrupt = 0;
  /** The skill that was running when this tick's state was read. */
  let runningAtTick: string | undefined;
  /**
   * Every tick: gives up on the running skill if its time is up (a reward restarts its clock);
   * otherwise starts the chosen skill unless it is the one already running. An alarm interrupt
   * stops the running skill when nothing new takes its place.
   */
  async function act(action: Action): Promise<void> {
    const now = Date.now();
    // The command from above, once per tick: how fast and how carefully to travel.
    locomotion.setDrive(driveFrom(view.signals, locomotionSettings, { dopamine: personality.restingDA, focus: focusSettings.resting }));
    const reward = view.signals[REWARD_SIGNAL];
    if (reward && reward.at !== lastReward && reward.value > 0) persistence.progress(now);
    lastReward = reward?.at ?? lastReward;
    // Asleep and undisturbed is the skill working, however long the night: its clock restarts.
    if ((view.signals[UPPER_PAUSED_SIGNAL]?.value ?? 0) > 0) persistence.progress(now);
    const gaveUp = persistence.giveUpReason(now);
    if (gaveUp) return executor.abandon(gaveUp);
    const interrupt = view.signals[INTERRUPT_SIGNAL];
    const interrupted = interrupt !== undefined && interrupt.at !== lastInterrupt && interrupt.value > 0;
    lastInterrupt = interrupt?.at ?? lastInterrupt;
    // A hard reflex keeping its own skill going is never stopped by the fright that came with it.
    const savingItself = (view.signals[REFLEX_SIGNAL]?.value ?? 0) >= 1 && "skill" in action;
    if (!("skill" in action) || action.skill === executor.current()?.skill) return interrupted && !savingItself ? executor.interrupt() : undefined;
    // The choice was to keep going with a skill that has finished since the tick began: it is done, not due again.
    if (action.skill === runningAtTick && executor.current() === null) return;
    await executor.start(action.skill, action.target);
  }

  const fileLogger = createLogger(logPath);
  const firstSeen = createFirstSeenTracker();
  const bodyEvents = trackBodyEvents(bot);
  const defenceWatch = createDefenceWatch();
  let loggedDeaths = 0;
  /**
   * The cost of tunable defence, made visible: if the bot dies soon after a soft defence reflex
   * was held back or outvoted with a threat close, say so loudly, with the gain and what won.
   */
  const overruledDefence = (entry: TickLog) => {
    const fired = ((entry.regions.find((r) => r.region === "reflex")?.trace?.rules as FiredReflex[] | undefined) ?? []).filter((f) => DEFENCE_REFLEXES.includes(f.rule));
    const winnerSkill = entry.winner && "skill" in entry.winner.action ? entry.winner.action.skill : null;
    const died = deaths > loggedDeaths;
    loggedDeaths = deaths;
    return defenceWatch.observe({
      now: entry.timestamp,
      fired: fired.map((f) => ({ rule: f.rule, skill: f.skill, gain: f.gain, urgency: f.urgency, heldBack: isHeldBack(entry.goal, f.rule, f.skill), won: entry.winner?.region === "reflex" && winnerSkill === f.skill })),
      winner: entry.winner && { region: entry.winner.region, skill: winnerSkill, urgency: entry.winner.urgency, reason: entry.winner.reason },
      threatClose: threatPresent(entry.state),
      died,
    });
  };
  let encoded = 0;
  let deaths = 0;
  bot.on("death", () => {
    deaths++;
  });
  const loop = createBrainLoop({
    regions,
    workspace,
    arbiter: createArbiter({ scorebook, personality, patience, persistence, skills }),
    ...(brainArgs.sameTime
      ? { alongside: { isSide: runsAlongside, onAction: (action: Action) => ("skill" in action ? executor.startAlongside(action.skill, action.target) : undefined) } }
      : {}),
    getState: () => {
      const { x, y, z } = bot.entity.position.floored();
      const limit = budget().nearby;
      runningAtTick = executor.current()?.skill;
      const state = encodeState(bot, encoded++, {
        base,
        current: executor.current(),
        deaths,
        lastHurt: bodyEvents.lastHurt(),
        locomotion: (({ moving, pattern, gait, stuck }) => ({ moving, pattern, gait, stuck }))(locomotion.status()),
        loud: bodyEvents.loud(),
        memory: feelingNear(memory, { x, y, z, dimension: bot.game.dimension }, Date.now()),
        narrow: noradrenaline.focus > 0 && alarm() > NARROW_ABOVE,
        limit,
      });
      if (focusSettings.attention > 0) {
        const { nearby } = state.data as unknown as MinecraftStateData;
        const hitLimit = [nearby.hazards, nearby.mobs, nearby.blocks, nearby.players].some((list) => list.length >= limit);
        swamped = attention.report(hitLimit, Date.now()) ?? swamped;
      }
      return state;
    },
    // Alarm shortens the time between ticks, down to the fastest the loop allows.
    intervalMs: () => TICK_MS - (noradrenaline.focus > 0 ? alarm() : 0) * (TICK_MS - FASTEST_TICK_MS),
    current: () => executor.current(),
    onAction: act,
    isSignificantChange,
    logger: {
      log(entry: TickLog) {
        const seen = firstSeen(entry.state);
        const overruled = overruledDefence(entry);
        const full: TickLog = { ...entry, skillEvents: pendingEvents.splice(0), ...(seen.length ? { firstSeen: seen } : {}), ...(overruled ? { defenceOverruledBeforeDeath: overruled } : {}) };
        fileLogger.log(full);
        console.log(formatTick(full));
        if (overruled) {
          const how = overruled.heldBack ? "held back by the goal" : "outvoted";
          const winner = overruled.winner ? `${overruled.winner.region} → ${overruled.winner.skill ?? "keep going"} (urgency ${overruled.winner.urgency.toFixed(2)}: ${overruled.winner.reason})` : "nothing";
          console.error(`!! DIED WITH DEFENCE OVERRULED: ${overruled.rule} (${overruled.skill}) was ${how}, gain ${overruled.gain.toFixed(2)}, urgency ${overruled.urgency.toFixed(2)}. Won instead: ${winner}.`);
        }
      },
    },
  });

  const saveLearning = () => {
    namePlaces();
    return Promise.all([
      saveScorebook(scorebook, scorebookFile(server.name)),
      saveNovelty(novelty, noveltyFile(server.name)),
      saveChests(chests, chestsFile(server.name)),
      saveMemories(memory, memoriesFile(server.name)),
    ]).catch((error) => console.error(`Could not save what the bot learned: ${error}`));
  };
  const saveTimer = setInterval(() => void saveLearning(), SAVE_LEARNING_MS);

  let stopping = false;
  async function shutdown(reason: string, exitCode: number): Promise<void> {
    if (stopping) return;
    stopping = true;
    console.log(`Stopping (${reason})...`);
    await loop.stop();
    await executor.interrupt();
    clearInterval(saveTimer);
    await saveLearning();
    await fileLogger.close();
    bot.quit();
    process.exitCode = exitCode;
  }

  process.once("SIGINT", () => void shutdown("Ctrl+C", 0));
  bot.once("kicked", (why) => void shutdown(`kicked: ${JSON.stringify(why)}`, 1));
  bot.once("end", (why) => void shutdown(`disconnected: ${why}`, 1));
  bot.on("error", (error) => console.error(`Bot error: ${error.message}`));

  loop.start();
}
