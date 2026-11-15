// Two rules about what may import or call what, checked by reading the source.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ENGINES = readdirSync("packages").filter((d) => d.startsWith("engine-")).map((d) => `packages/${d}/src`);
const PACKAGES = ["packages/core/src", "packages/contracts/src", ...ENGINES];
const FORBIDDEN = /from\s+["'](mineflayer[^"']*|@familiar\/minecraft|minecraft-[^"']*|prismarine-[^"']*|vec3)["']/;

/** Rule 1: the game-agnostic packages must never import Minecraft code. */
export function moduleRuleViolations(): string[] {
  return matches(PACKAGES.flatMap((dir) => files(dir)), FORBIDDEN);
}

/** Where the bot's body may be moved from: everything else must go through the primitives. */
const BODY_ROOTS = ["packages/minecraft/src", "apps/run-bot/src"];
const DOORWAY = "packages/minecraft/src/primitives/";
/** Pathfinding is the walking rhythm: these helpers may drive movement directly. */
const PATHFINDING = ["packages/minecraft/src/abort.ts", "packages/minecraft/src/walk-to.ts", "packages/minecraft/src/movements.ts"];
/** Calls that move the body or act on the world, on the bot or on an open window. */
const ACTIONS = [
  "dig", "stopDigging", "placeBlock", "attack", "swingArm", "lookAt", "look", "setControlState", "clearControlStates",
  "equip", "unequip", "consume", "activateItem", "deactivateItem", "activateBlock", "activateEntity", "activateEntityAt", "useOn",
  "openContainer", "openChest", "openFurnace", "openBlock", "openEntity", "closeWindow", "clickWindow", "transfer",
  "craft", "toss", "tossStack", "sleep", "wake", "fish", "setQuickBarSlot", "deposit", "withdraw",
];
const ACTION_CALL = new RegExp(`\\b(bot|window|container)\\.(${ACTIONS.join("|")})\\s*\\(`);

/**
 * Rule 2, one doorway: outside primitives/ and the pathfinding helpers, no file may call the
 * bot's action methods. `roots` is for the rule's own test.
 */
export function doorwayViolations(roots: string[] = BODY_ROOTS): string[] {
  const checked = roots
    .flatMap((dir) => files(dir))
    .filter((file) => !file.startsWith(DOORWAY) && !PATHFINDING.includes(file) && !file.endsWith(".test.ts") && !file.endsWith(".test-helper.ts"));
  return matches(checked, ACTION_CALL);
}

/** Every line (outside comments) of the files that matches, as "file:line: text". */
function matches(paths: string[], pattern: RegExp): string[] {
  return paths.flatMap((file) =>
    readFileSync(file, "utf8")
      .split("\n")
      .flatMap((line, i) => (pattern.test(line) && !/^\s*(\/\/|\*|\/\*)/.test(line) ? [`${file}:${i + 1}: ${line.trim()}`] : [])),
  );
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith(".ts") ? [path] : [];
  });
}
