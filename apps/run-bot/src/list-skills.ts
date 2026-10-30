import { minecraftSkills } from "@familiar/minecraft";

/** Prints every skill name with its description. */
export function listSkills(): void {
  const width = Math.max(...minecraftSkills.map((s) => s.name.length));
  for (const skill of minecraftSkills) console.log(`${skill.name.padEnd(width)}  ${skill.description}`);
}
