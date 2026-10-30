import type { Action, SkillEvent, TickLog } from "@familiar/contracts";
import {
  answersToAction,
  buildActionQuestion,
  buildTargetQuestion,
  createLogger,
  createLoop,
  createSkillExecutor,
  defaultLogPath,
} from "@familiar/core";
import {
  createFirstSeenTracker,
  encodeState,
  isSignificantChange,
  listTargets,
  MINER_CONTEXT,
  minecraftSkills,
  minerQuestions,
  type MinecraftCtx,
} from "@familiar/minecraft";
import type { EngineName, ServerArgs } from "./args.js";
import { createEngine } from "./create-engine.js";
import { formatSkillEvent } from "./format-skill-event.js";
import { formatTick } from "./format-tick.js";
import { joinWithBase } from "./join.js";

const ROLE = "miner";

/**
 * The decision loop: each tick encodes the state, asks the engine the Miner's questions in one
 * request, and starts the chosen skill (with the chosen target, if the skill accepts it) through
 * the skill executor if it differs from the one running. The other answers are only logged for now.
 * Runs until Ctrl+C.
 */
export async function runLoop(server: ServerArgs, engineName: EngineName): Promise<void> {
  const { bot, base } = await joinWithBase(server);
  const engine = createEngine(engineName);
  const logPath = defaultLogPath(ROLE);
  console.log(`Engine: ${engine.name}. Logging to ${logPath}`);

  const ctx: MinecraftCtx = { bot, base, log: (msg) => console.log(`    ${msg}`) };
  const pendingEvents: SkillEvent[] = [];
  const executor = createSkillExecutor({
    skills: minecraftSkills,
    ctx,
    onEvent(event) {
      pendingEvents.push(event);
      console.log(`  ${formatSkillEvent(event)}`);
    },
  });

  /** Starts the chosen skill unless it is the one already running. */
  async function act(action: Action): Promise<void> {
    if (!("skill" in action) || action.skill === executor.current()?.skill) return;
    await executor.start(action.skill, action.target);
  }

  /** Whether `skill` can run with `target` right now. */
  const acceptsTarget = (skill: string, target: string) =>
    minecraftSkills.find((s) => s.name === skill)?.canRun(ctx, target) ?? false;

  const fileLogger = createLogger(logPath);
  const firstSeen = createFirstSeenTracker();
  let encoded = 0;
  const loop = createLoop({
    engine,
    questions: (state) =>
      minerQuestions({
        nextAction: buildActionQuestion(minecraftSkills, ctx, MINER_CONTEXT),
        target: buildTargetQuestion(listTargets(state)),
      }),
    toAction: (answers) => answersToAction(answers, acceptsTarget),
    getState: () => encodeState(bot, encoded++, { base, current: executor.current() }),
    onAction: act,
    isSignificantChange,
    logger: {
      log(entry: TickLog) {
        const seen = firstSeen(entry.state);
        const withEvents: TickLog = { ...entry, skillEvents: pendingEvents.splice(0), ...(seen.length ? { firstSeen: seen } : {}) };
        fileLogger.log(withEvents);
        console.log(formatTick(withEvents));
      },
    },
  });

  let stopping = false;
  async function shutdown(reason: string, exitCode: number): Promise<void> {
    if (stopping) return;
    stopping = true;
    console.log(`Stopping (${reason})...`);
    await loop.stop();
    await executor.interrupt();
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
