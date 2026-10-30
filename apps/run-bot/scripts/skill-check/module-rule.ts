// The game-agnostic packages must never import Minecraft code.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ENGINES = readdirSync("packages").filter((d) => d.startsWith("engine-")).map((d) => `packages/${d}/src`);
const PACKAGES = ["packages/core/src", "packages/contracts/src", ...ENGINES];
const FORBIDDEN = /from\s+["'](mineflayer[^"']*|@familiar\/minecraft|minecraft-[^"']*|prismarine-[^"']*|vec3)["']/;

export function moduleRuleViolations(): string[] {
  return PACKAGES.flatMap((dir) => files(dir)).flatMap((file) =>
    readFileSync(file, "utf8")
      .split("\n")
      .flatMap((line, i) => (FORBIDDEN.test(line) ? [`${file}:${i + 1}: ${line.trim()}`] : [])),
  );
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith(".ts") ? [path] : [];
  });
}
