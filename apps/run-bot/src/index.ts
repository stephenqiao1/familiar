import { parseCommand } from "./args.js";
import { listSkills } from "./list-skills.js";
import { runLoop } from "./loop-mode.js";
import { runSkill } from "./skill-mode.js";

async function main(): Promise<void> {
  const command = parseCommand(process.argv.slice(2));
  switch (command.kind) {
    case "loop":
      return runLoop(command.server, command.brain);
    case "skills":
      return listSkills();
    case "skill":
      return runSkill(command);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
