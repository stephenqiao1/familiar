import { createInterface } from "node:readline";
import type { Action, Candidate, NeedReading, SkillEvent, State, TickLog } from "@familiar/contracts";
import { createBrainLoop, createChainSkill, createLogger, createSkillExecutor, createWorkspace, defaultLogPath } from "@familiar/core";
import { feelingNear, type Place } from "@familiar/memory";
import {
  createFirstSeenTracker,
  createGut,
  createLocomotion,
  createPain,
  createRouteChecks,
  createRouteQueries,
  createThreatRecord,
  createThreatSense,
  defenceMoment,
  createSleepClock,
  DEFENCE_REFLEXES,
  driveFrom,
  encodeState,
  isHarmful,
  isSignificantChange,
  minecraftSkills,
  primitives,
  REFLEX_SKILLS,
  setKnownBadFoods,
  setKnownHurts,
  setUpPosture,
  sleepProblem,
  trackGut,
  trackSenses,
  tidyBody,
  posId,
  situationOf,
  madeProgress,
  needsNow,
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
import { COMPETE, DESPERATE_SIGNAL } from "@familiar/region-hypothalamus";
import { REFLEX_SIGNAL, type FiredReflex } from "@familiar/region-reflex";
import type { BrainArgs, ServerArgs } from "./args.js";
import { loadBotConfig } from "./bot-config.js";
import { createArbiter, createBrain, patienceOf } from "./brain.js";
import { createPlayerStriatum } from "./habits.js";
import { createHabits } from "@familiar/basal-ganglia";
import { cutShortReason } from "./cut-short.js";
import { createEngine, createPlanner } from "./create-engine.js";
import {
  chestsFile,
  badFoodsFile,
  bodyFile,
  targetsFile,
  loadTargets,
  saveTargets,
  hurtsFile,
  learnedSkillsFile,
  loadChests,
  loadBody,
  loadHurts,
  loadLearnedSkills,
  loadMemories,
  loadNovelty,
  loadScorebook,
  memoriesFile,
  noveltyFile,
  saveChests,
  saveBody,
  saveHurts,
  saveSurfaces,
  loadSurfaces,
  surfacesFile,
  loadThreats,
  loadHabits,
  saveHabits,
  habitsFile,
  saveThreats,
  threatsFile,
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
/** One in-game day, in ms. */
const GAME_DAY_MS = 1_200_000;

/**
 * The decision loop: each tick encodes the state, runs the brain's regions, and starts the
 * winning proposal's skill through the skill executor if it differs from the one running.
 * Runs until Ctrl+C.
 */
export async function runLoop(server: ServerArgs, brainArgs: BrainArgs): Promise<void> {
  // Read the settings first, so a bad bots.json stops the bot before it joins.
  const { personality, patience, noradrenaline, focus: focusSettings, brainstem, locomotion: locomotionSettings, reflexes, medulla, posture: postureSettings, colliculus, defence, arousal, drives, thalamus, selection, memory: memorySettings } = await loadBotConfig(server.name);
  const { bot, base } = await joinWithBase(server);
  const engine = createEngine(brainArgs.engine);
  const planner = createPlanner(brainArgs.planner, brainArgs.plan);
  const scorebook = await loadScorebook(scorebookFile(server.name));
  const novelty = await loadNovelty(noveltyFile(server.name));
  const targets = await loadTargets(targetsFile(server.name));
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
  /** The budget in force for the state being read (worked out as each state is made, as it always was). */
  let budgetNow = NEUTRAL_BUDGET;
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
  // What the bot knows hurts (born knowing some, learning the rest), and how sore it is. The
  // safety checks, pathing and reflexes all ask it. It never learns the base's own blocks as harmful.
  const pain = createPain({
    innate: reflexes.innateHurts,
    learned: await loadHurts(hurtsFile(server.name)),
    neverLearn: (name) => name === "chest" || name.endsWith("_bed") || name === "crafting_table",
    learnHurts: reflexes.learnHurts,
    sensitise: reflexes.sensitise,
  });
  setKnownHurts(bot, pain.knows);
  // What the bot knows about food (born knowing some of it, learning the rest from falling ill),
  // and how long it has been awake, on the world's own clock.
  const gut = createGut({ innate: medulla.innateBadFoods, learned: await loadHurts(badFoodsFile(server.name)), learnBadFoods: medulla.learnBadFoods });
  setKnownBadFoods(bot, gut.knowsBad);
  trackGut(bot, gut, isHarmful, (msg) => console.log(`    medulla: ${msg}`));
  const sleepClock = createSleepClock(bot, (await loadBody(bodyFile(server.name))).sleptAtAge);
  const bodyEvents = trackBodyEvents(bot, () => locomotion.status().moving);
  // The eyes and ears between states: how things move, what changes, what is heard.
  const senses = trackSenses(bot);
  // Balance and posture: what the bot knows about surfaces (born knowing some loose blocks,
  // learning the rest), the check before acting, and the senses for falling and being moved.
  const posture = setUpPosture(bot, {
    settings: postureSettings,
    learned: await loadSurfaces(surfacesFile(server.name)),
    locomotion,
    lastBang: () => bodyEvents.loud().at(-1)?.at ?? null,
    log: (msg) => console.log(`    ${msg}`),
  });
  // Defence: what the bot has learned about each kind of threat, and the sense that sizes up
  // whatever is near each tick (with real route checks for the nearest two).
  const threatRecord = createThreatRecord(defence, await loadThreats(threatsFile(server.name)));
  const threats = createThreatSense(bot, {
    settings: defence,
    bravery: brainstem.bravery,
    // A desperate need lets a threat a little closer before the body runs (the hard reflexes are not touched).
    flightScale: () => 1 - COMPETE.flightOff * (view.signals[DESPERATE_SIGNAL]?.value ?? 0),
    record: threatRecord,
    ...(defence.reachCheck > 0 ? { routes: createRouteChecks(createRouteQueries(bot)) } : {}),
    locomotion,
    log: (msg) => console.log(`    ${msg}`),
  });
  const ctx: MinecraftCtx = {
    bot,
    base,
    locomotion,
    pain,
    gut,
    threats,
    lastHurt: () => bodyEvents.lastHurt(),
    wants: () => workspace.goal()?.wants ?? [],
    chests: believedChests,
    level: (signal) => view.signals[signal]?.value ?? 0,
    log: (msg) => console.log(`    ${msg}`),
  };
  const storage = { chests: believedChests, baseChest: posId(base.chest) };
  const persistence = createPersistence({
    patience: () => patienceOf(view, patience),
    chanceOf: (skill) => chanceOfPayoff(scorebook.get(situationOf(view.state), skill)),
    strength: patience.persistence,
  });
  // The striatum: the bot's habits, learned from who wins and how it ends.
  const habits = createHabits(await loadHabits(habitsFile(server.name)));
  const striatum = createPlayerStriatum({ habits, selection, skills, log: (msg) => console.log(`    ${msg}`) });
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
      reflexes,
      medulla,
      posture: postureSettings,
      colliculus,
      defence,
      arousal,
      drives,
      targets,
      whyNoSleep: () => sleepProblem(ctx),
      postureNotes: () => posture.notes(),
      justLearnedBadFoods: () => gut.justLearned(),
      sore: () => pain.sore(Date.now()),
      justLearnedHurts: () => pain.justLearned(),
      showPrimitives: brainArgs.primitives ?? false,
      sameTime: brainArgs.sameTime ?? false,
      focusNotes,
      attentionBudget: () => budgetNow,
      thalamus,
      selection,
      striatum,
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
  console.log(`Personality: resting DA ${personality.restingDA}, learning step ${personality.learningRate}, novelty bonus ${personality.noveltyBonus}, wasted effort ${personality.wastedEffort}, situation worth ${personality.situationWorth}, wanting ${personality.wanting}.`);
  console.log(
    `Patience: resting ${patience.resting}, time constant ${patience.timeConstantSeconds}s, effects: persistence ${patience.persistence}, horizon ${patience.horizon}, brake ${patience.brake}.`,
  );
  console.log(
    `Alarm: gain ${noradrenaline.alarmGain}, fades in ${noradrenaline.alarmDecaySeconds}s. Search: resting ${noradrenaline.searchResting}. Memories: ${memory.entries().memories.length} remembered.`,
  );
  console.log(`Focus: resting ${focusSettings.resting}, trust in remembered things halves every ${focusSettings.trustHalfLifeMinutes} min.`);
  console.log(`Colliculus: threshold ${colliculus.threshold}, scanning ${colliculus.scanning}.`);
  console.log(`Thalamus: ${thalamus.gate > 0 ? `gate on (instinct is told up to ${thalamus.limits.instinct ?? "?"} characters, the planner ${thalamus.limits.prefrontal ?? "?"})` : "gate off (the deciding layers are told the nearest few of each kind)"}, field of view ${thalamus.fieldOfView > 0 ? "on (they are told only what is seen or heard)" : "off"}.`);
  console.log(`Defence: innate threats ${defence.innateThreats === "game" ? "the game's hostile flag" : `[${defence.innateThreats.join(", ")}]`}, ${Object.keys(threatRecord.entries()).length} kinds learned about, route checks ${defence.reachCheck > 0 ? "on" : "off"}.`);
  console.log(`Brainstem: bravery ${brainstem.bravery}, reflex gains ${brainstem.gains}, hold-back ${brainstem.holdBack}.`);
  console.log(`Selection: body first ${selection.bodyFirst}, wait ${selection.wait}, channels ${selection.channels > 0 ? "on" : "off"}, habits ${selection.habits} (${Object.values(habits.entries()).reduce((n, skills) => n + Object.keys(skills).length, 0)} known, blind ${selection.habit.blind}).`);
  console.log(`Arousal: resting ${arousal.resting}, bedtime ${arousal.bedtime}, wake threshold ${arousal.wakeThreshold}, gate ${arousal.gate}.`);
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
  const alarm = () => view.signals[ALARM_SIGNAL]?.value ?? 0;
  let lastReward = 0;
  let lastState: State | null = null;
  let lastNeeds: NeedReading[] = [];
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
    // So does a need easing or ground covered: the skill is getting somewhere.
    const needs = needsNow(view, drives);
    if (lastState && madeProgress(lastState, view.state, lastNeeds, needs)) persistence.progress(now);
    lastState = view.state;
    lastNeeds = needs;
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
    // A protective reflex cutting a skill short switches it off as a failure, naming the reflex and
    // the place, so the scorebook learns the skill cost something here (an interruption teaches nothing).
    const cutShort = cutShortReason(action.skill, executor.current()?.skill, REFLEX_SKILLS, bot.entity.position.floored());
    if (cutShort) await executor.abandon(cutShort);
    await executor.start(action.skill, action.target);
  }

  const fileLogger = createLogger(logPath);
  const firstSeen = createFirstSeenTracker();
  const defenceWatch = createDefenceWatch();
  let loggedDeaths = 0;
  let diedDefending: ReturnType<typeof defenceWatch.recent> | null = null;
  /**
   * The cost of tunable defence, made visible: if the bot dies soon after a soft defence reflex
   * was held back or outvoted with a threat close, say so loudly, with the gain and what won.
   */
  const overruledDefence = (entry: TickLog) => {
    const fired = ((entry.regions.find((r) => r.region === "reflex")?.trace?.rules as FiredReflex[] | undefined) ?? []).filter((f) => DEFENCE_REFLEXES.includes(f.rule));
    const winnerSkill = entry.winner && "skill" in entry.winner.action ? entry.winner.action.skill : null;
    const died = deaths > loggedDeaths;
    loggedDeaths = deaths;
    // A death is reported with what the defence circuit was doing in the 5 seconds before it.
    if (died) diedDefending = defenceWatch.recent(entry.timestamp);
    const moment = defenceMoment(entry.state);
    return defenceWatch.observe({
      now: entry.timestamp,
      fired: fired.map((f) => ({ rule: f.rule, skill: f.skill, gain: f.gain, urgency: f.urgency, heldBack: isHeldBack(entry.goal, f.rule, f.skill), won: entry.winner?.region === "reflex" && winnerSkill === f.skill })),
      winner: entry.winner && { region: entry.winner.region, skill: winnerSkill, urgency: entry.winner.urgency, reason: entry.winner.reason },
      threatClose: threatPresent(entry.state),
      died,
      ...(moment ? { defence: { mode: moment.mode, why: moment.why, threat: moment.threat as Record<string, unknown> | null } } : {}),
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
    // The basal ganglia decide what runs alongside too (a contest for each channel of the body).
    arbiter: createArbiter({ scorebook, personality, patience, persistence, skills, selection, sameTime: brainArgs.sameTime ?? false, onChoice: striatum.observe }),
    alongside: { onAction: (action: Action) => ("skill" in action ? executor.startAlongside(action.skill, action.target) : undefined) },
    getState: () => {
      const { x, y, z } = bot.entity.position.floored();
      // The state is no longer cut by the attention budget: the whole brain reads up to the encoder's own cap.
      // The budget is still worked out here, for the thalamus to cut what the deciding layers are told.
      budgetNow = budget();
      const limit = budgetNow.nearby;
      runningAtTick = executor.current()?.skill;
      const state = encodeState(bot, encoded++, {
        base,
        current: executor.current(),
        deaths,
        lastHurt: bodyEvents.lastHurt(),
        sinceSleepMinutes: sleepClock.sinceSleepMinutes(),
        healing: bodyEvents.healing(),
        pushed: bodyEvents.pushed(),
        motion: bodyEvents.motion(),
        fallen: posture.fallen(),
        displaced: posture.displaced(),
        locomotion: (({ moving, pattern, gait, stuck }) => ({ moving, pattern, gait, stuck }))(locomotion.status()),
        senses,
        defence: threats.assess,
        memory: feelingNear(memory, { x, y, z, dimension: bot.game.dimension }, Date.now()),
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
        const before = diedDefending;
        diedDefending = null;
        const full: TickLog = { ...entry, skillEvents: pendingEvents.splice(0), ...(seen.length ? { firstSeen: seen } : {}), ...(overruled ? { defenceOverruledBeforeDeath: overruled } : {}), ...(before ? { defenceBeforeDeath: before } : {}) };
        fileLogger.log(full);
        console.log(formatTick(full));
        if (before) console.error(`!! DIED. Defence in the 5 seconds before: ${before.length ? before.map((m) => `${(m.msAgo / 1000).toFixed(1)}s ago ${m.mode}`).join(", ") : "nothing recorded"}.`);
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
      saveTargets(targets, targetsFile(server.name)),
      saveChests(chests, chestsFile(server.name)),
      saveHurts(pain.entries(), hurtsFile(server.name)),
      saveHurts(gut.entries(), badFoodsFile(server.name)),
      saveSurfaces(posture.surfaces.entries(), surfacesFile(server.name)),
      saveThreats(threatRecord.entries(), threatsFile(server.name)),
      saveHabits(habits.entries(), habitsFile(server.name)),
      saveBody({ sleptAtAge: sleepClock.sleptAtAge() }, bodyFile(server.name)),
      saveMemories(memory, memoriesFile(server.name)),
    ]).catch((error) => console.error(`Could not save what the bot learned: ${error}`));
  };
  const saveTimer = setInterval(() => void saveLearning(), SAVE_LEARNING_MS);

  // --manual: skill commands typed on standard input start that skill at once, as if a region had
  // proposed it. With the deciding regions left out (--regions), only the reflexes can overrule it.
  const typed = brainArgs.manual ? createInterface({ input: process.stdin }) : null;
  if (typed) {
    typed.on("line", (line) => {
      const [verb, skill, target] = line.trim().split(/\s+/);
      if (verb === "do" && skill) void executor.start(skill, target);
      if (verb === "stop") void executor.interrupt();
    });
  }

  let stopping = false;
  async function shutdown(reason: string, exitCode: number): Promise<void> {
    if (stopping) return;
    stopping = true;
    console.log(`Stopping (${reason})...`);
    // Stop listening for typed commands, or the open input would keep the process alive.
    typed?.close();
    process.stdin.unref?.();
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
