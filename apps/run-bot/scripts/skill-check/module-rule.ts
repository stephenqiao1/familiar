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
/** The locomotion controller owns all travel: it alone drives the pathfinder and holds keys for it. */
const LOCOMOTION = "packages/minecraft/src/locomotion/";
/** Calls that move the body or act on the world, on the bot or on an open window. */
const ACTIONS = [
  "dig", "stopDigging", "placeBlock", "attack", "swingArm", "lookAt", "look", "setControlState", "clearControlStates",
  "equip", "unequip", "consume", "activateItem", "deactivateItem", "activateBlock", "activateEntity", "activateEntityAt", "useOn",
  "openContainer", "openChest", "openFurnace", "openBlock", "openEntity", "closeWindow", "clickWindow", "transfer",
  "craft", "toss", "tossStack", "sleep", "wake", "fish", "setQuickBarSlot", "deposit", "withdraw",
];
const ACTION_CALL = new RegExp(`\\b(bot|window|container)\\.(${ACTIONS.join("|")})\\s*\\(`);
const isTest = (file: string) => file.endsWith(".test.ts") || file.endsWith(".test-helper.ts");

/**
 * Rule 2, one doorway: outside primitives/ and locomotion/, no file may call the bot's action
 * methods. `roots` is for the rule's own test.
 */
export function doorwayViolations(roots: string[] = BODY_ROOTS): string[] {
  const checked = roots.flatMap((dir) => files(dir)).filter((file) => !file.startsWith(DOORWAY) && !file.startsWith(LOCOMOTION) && !isTest(file));
  return matches(checked, ACTION_CALL);
}

/** The single movements that hold a key themselves: one step, one jump, sneaking. Not journeys. */
const SINGLE_MOVEMENTS = ["keys.ts", "step.ts", "jump.ts", "sneak.ts"].map((name) => DOORWAY + name);
/** Reaching for the pathfinder, or holding movement keys. */
const TRAVEL = /\.pathfinder\b|\b(holdKey|releaseKeys)\s*\(/;

/**
 * Rule 3, one traveller: outside locomotion/, no file may touch the pathfinder or hold movement
 * keys for travel (the single movements aside). `roots` is for the rule's own test.
 */
export function travelViolations(roots: string[] = BODY_ROOTS): string[] {
  const checked = roots.flatMap((dir) => files(dir)).filter((file) => !file.startsWith(LOCOMOTION) && !SINGLE_MOVEMENTS.includes(file) && !isTest(file));
  return matches(checked, TRAVEL);
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
