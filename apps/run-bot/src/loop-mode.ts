import type { Action, SkillEvent, TickLog } from "@familiar/contracts";
import { highestUrgency } from "@familiar/arbiter";
import { createBrainLoop, createLogger, createSkillExecutor, defaultLogPath } from "@familiar/core";
import { createFirstSeenTracker, encodeState, isSignificantChange, minecraftSkills, type MinecraftCtx } from "@familiar/minecraft";
import type { BrainArgs, ServerArgs } from "./args.js";
import { createBrain } from "./brain.js";
import { createEngine, createPlanner } from "./create-engine.js";
import { formatSkillEvent } from "./format-skill-event.js";
import { formatTick } from "./format-tick.js";
import { joinWithBase } from "./join.js";

const ROLE = "miner";

/**
 * The decision loop: each tick encodes the state, runs the brain's regions, and starts the
 * winning proposal's skill through the skill executor if it differs from the one running.
 * Runs until Ctrl+C.
 */
export async function runLoop(server: ServerArgs, brainArgs: BrainArgs): Promise<void> {
  const { bot, base } = await joinWithBase(server);
  const engine = createEngine(brainArgs.engine);
  const planner = createPlanner(brainArgs.planner);
  const ctx: MinecraftCtx = { bot, base, log: (msg) => console.log(`    ${msg}`) };
  const regions = createBrain({ engine, planner, skills: minecraftSkills, ctx }, brainArgs.regions);
  const logPath = defaultLogPath(ROLE);
  console.log(`Regions: ${regions.map((r) => r.name).join(", ")}. Engine: ${engine.name}. Planner: ${planner.name}.`);
  console.log(`Logging to ${logPath}`);

  const pendingEvents: SkillEvent[] = [];
  const onEvent = (event: SkillEvent) => {
    pendingEvents.push(event);
    loop.workspace.addEvent(event);
    console.log(`  ${formatSkillEvent(event)}`);
  };
  const executor = createSkillExecutor({ skills: minecraftSkills, ctx, onEvent });

  /** Starts the chosen skill unless it is the one already running. */
  async function act(action: Action): Promise<void> {
    if (!("skill" in action) || action.skill === executor.current()?.skill) return;
    await executor.start(action.skill, action.target);
  }

  const fileLogger = createLogger(logPath);
  const firstSeen = createFirstSeenTracker();
  let encoded = 0;
  const loop = createBrainLoop({
    regions,
    arbiter: highestUrgency,
    getState: () => encodeState(bot, encoded++, { base, current: executor.current() }),
    current: () => executor.current(),
    onAction: act,
    isSignificantChange,
    logger: {
      log(entry: TickLog) {
        const seen = firstSeen(entry.state);
        const full: TickLog = { ...entry, skillEvents: pendingEvents.splice(0), ...(seen.length ? { firstSeen: seen } : {}) };
        fileLogger.log(full);
        console.log(formatTick(full));
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
