import type { SkillEvent } from "@familiar/contracts";
import { createSkillExecutor } from "@familiar/core";
import { minecraftSkills } from "@familiar/minecraft";
import type { ServerArgs } from "./args.js";
import { formatSkillEvent } from "./format-skill-event.js";
import { joinWithBase } from "./join.js";

export interface SkillRun {
  server: ServerArgs;
  skill: string;
  target?: string;
  interruptAfterMs?: number;
  /** Stay connected (doing nothing) this long after the skill ends, so observers can check the bot stopped. */
  lingerMs?: number;
}

/** Runs one skill through the executor (no decision loop), prints every event, then logs out. */
export async function runSkill({ server, skill, target, interruptAfterMs, lingerMs }: SkillRun): Promise<void> {
  if (!minecraftSkills.some((s) => s.name === skill)) {
    throw new Error(`Unknown skill "${skill}". Run "pnpm start -- skills" to list them.`);
  }
  const { bot, base } = await joinWithBase(server);
  bot.on("error", (error) => console.error(`Bot error: ${error.message}`));

  let finish: (event: SkillEvent) => void = () => {};
  const finished = new Promise<SkillEvent>((resolve) => (finish = resolve));
  const executor = createSkillExecutor({
    skills: minecraftSkills,
    ctx: { bot, base, log: (msg) => console.log(`  ${msg}`) },
    onEvent(event) {
      console.log(formatSkillEvent(event));
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
  if (lingerMs) await new Promise((resolve) => setTimeout(resolve, lingerMs));
  bot.quit();
  process.exitCode = last.type === "failed" ? 1 : 0;
}
