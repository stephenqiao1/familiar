import type { ItemWant, SkillEvent } from "@familiar/contracts";
import { createChainSkill, createSkillExecutor } from "@familiar/core";
import { minecraftSkills, primitives, tidyBody } from "@familiar/minecraft";
import type { ServerArgs } from "./args.js";
import { formatChanges, formatSkillEvent } from "./format-skill-event.js";
import { joinWithBase } from "./join.js";
import { chestsFile, learnedSkillsFile, loadChests, loadLearnedSkills, saveChests } from "./memory-store.js";

export interface SkillRun {
  server: ServerArgs;
  skill: string;
  target?: string;
  interruptAfterMs?: number;
  /** Stay connected (doing nothing) this long after the skill ends, so observers can check the bot stopped. */
  lingerMs?: number;
  /** What to carry, standing in for a goal's wants. Default: nothing. */
  wants?: ItemWant[];
}

/** Runs one skill through the executor (no decision loop), prints every event, then logs out. */
export async function runSkill({ server, skill, target, interruptAfterMs, lingerMs, wants = [] }: SkillRun): Promise<void> {
  const learned = await loadLearnedSkills(learnedSkillsFile(server.name), primitives.map((s) => s.name), minecraftSkills.map((s) => s.name));
  const skills = [...minecraftSkills, ...learned.skills.map((s) => createChainSkill(s, primitives, tidyBody))];
  if (!skills.some((s) => s.name === skill)) {
    throw new Error(`Unknown skill "${skill}". Run "pnpm start -- skills" to list them.`);
  }
  const { bot, base } = await joinWithBase(server);
  const chests = await loadChests(chestsFile(server.name));
  bot.on("error", (error) => console.error(`Bot error: ${error.message}`));

  let finish: (event: SkillEvent) => void = () => {};
  const finished = new Promise<SkillEvent>((resolve) => (finish = resolve));
  const executor = createSkillExecutor({
    skills,
    ctx: { bot, base, wants: () => wants, chests, log: (msg) => console.log(`  ${msg}`) },
    onEvent(event) {
      console.log(formatSkillEvent(event));
      const changes = formatChanges(event);
      if (changes) console.log(`  changes: ${changes}`);
      if (event.type !== "started") finish(event);
    },
  });

  const interrupt = (why: string) => {
    console.log(`Interrupting (${why})...`);
    void executor.interrupt();
  };
  const timer = interruptAfterMs === undefined ? undefined : setTimeout(() => interrupt("--interrupt-after"), interruptAfterMs);
  const onSigint = () => interrupt("Ctrl+C");
  process.once("SIGINT", onSigint);
  const onEnd = (why: string) => interrupt(`disconnected: ${why}`);
  bot.once("end", onEnd);

  await executor.start(skill, target);
  const last = await finished;

  clearTimeout(timer);
  process.off("SIGINT", onSigint);
  bot.off("end", onEnd);
  await saveChests(chests, chestsFile(server.name));
  if (lingerMs) await new Promise((resolve) => setTimeout(resolve, lingerMs));
  bot.quit();
  process.exitCode = last.type === "failed" ? 1 : 0;
}
