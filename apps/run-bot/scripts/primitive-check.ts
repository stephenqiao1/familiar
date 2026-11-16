// Live pass for the primitives: runs each one on the test server, once to completion and once
// interrupted, and checks the changes it reports against what an observer bot and the server see.
// Needs the server container (MC_CONTAINER, default familiar-m6) and a fresh build.
//   pnpm skill-check [primitive ...]
import type { Changes, SkillEvent } from "@familiar/contracts";
import { createSkillExecutor } from "@familiar/core";
import { connect, createLocomotion, createPain, INNATE_HURTS, minecraftSkills, type MinecraftCtx } from "@familiar/minecraft";
import { doorwayViolations, moduleRuleViolations, travelViolations } from "./skill-check/module-rule.ts";
import { scenes, type Scene } from "./primitive-check/scenes.ts";
import { walkAndLook } from "./primitive-check/walk-and-look.ts";
import { BOT, buildPlaza, reset, sleep, startObserver, tearDown, type Observer } from "./primitive-check/world.ts";

const KEYS = ["forward", "back", "left", "right", "jump", "sprint"] as const;
const wanted = process.argv.slice(2);

const bot = await connect({ host: "localhost", port: 25565, username: BOT });
bot.on("error", (error) => console.error(`Bot error: ${error.message}`));
await bot.waitForChunksToLoad();
buildPlaza();
await reset();
const observer = await startObserver();

let ended: (event: SkillEvent) => void = () => {};
const ctx: MinecraftCtx = { bot, base: { chest: bot.entity.position.clone(), bed: bot.entity.position.clone() }, wants: () => [], locomotion: createLocomotion(bot), pain: createPain({ innate: INNATE_HURTS }), lastHurt: () => null, chests: {} as MinecraftCtx["chests"], log: () => {} };
const sideEvents: SkillEvent[] = [];
const executor = createSkillExecutor({ skills: minecraftSkills, ctx, onEvent: (event) => void (event.type !== "started" && ended(event)), onSideEvent: (event) => void sideEvents.push(event) });

/** Runs one primitive; with `interruptAfterMs` it is interrupted that long after starting. */
async function run(name: string, target?: string, interruptAfterMs?: number): Promise<SkillEvent> {
  const done = new Promise<SkillEvent>((resolve) => (ended = resolve));
  await executor.start(name, target);
  if (interruptAfterMs !== undefined) {
    await sleep(interruptAfterMs);
    void executor.interrupt();
  }
  return Promise.race([done, sleep(30_000).then((): SkillEvent => ({ skill: name, type: "failed", reason: "no result in 30 s", timestamp: Date.now() }))]);
}

async function prepare(scene: Scene, forInterrupt: boolean): Promise<void> {
  await reset(scene.give);
  await (forInterrupt && scene.interruptSetup ? scene.interruptSetup() : scene.setup?.());
  await sleep(400);
  for (const [name, target] of scene.first ?? []) await run(name, target);
  await sleep(300);
}

/** Nothing left held, in use, being dug or open (a container `open` leaves open is its job). */
function leftovers(scene: Scene): string[] {
  const held = KEYS.filter((key) => bot.getControlState(key)).map((key) => `key ${key}`);
  if (bot.usingHeldItem) held.push("item in use");
  if (bot.targetDigBlock) held.push("still digging");
  if (bot.currentWindow && !["open", "move_item"].includes(scene.primitive)) held.push("window open");
  return held;
}

interface Row {
  name: string;
  completed: string;
  interrupted: string;
  changes: string;
  ok: boolean;
}

async function play(scene: Scene, seen: Observer): Promise<Row> {
  const name = scene.target ? `${scene.primitive} ${scene.target}` : scene.primitive;
  // 1. To completion.
  await prepare(scene, false);
  const before = scene.before?.(seen);
  const full = await run(scene.primitive, scene.target);
  await sleep(500);
  const changes: Changes = full.changes ?? {};
  const [correct, detail] = full.type === "done" ? scene.check(changes, seen, before) : [false, "did not finish"];
  const completed = full.type === "done" ? "done" : `${full.type}${full.reason ? `: ${full.reason}` : ""}`;
  console.log(`- ${name}: ${completed}; ${detail}`);
  console.log(`    changes: ${JSON.stringify(changes)}`);

  // 2. Interrupted.
  await prepare(scene, true);
  const cut = await run(scene.primitive, scene.target, scene.interruptAfterMs ?? 0);
  await sleep(500);
  const left = leftovers(scene);
  const stoppedAt = seen.position();
  await sleep(600);
  // Sideways drift only: a bot stopped in mid-jump still comes down, which is not a key left held.
  const now = seen.position();
  const still = stoppedAt && now ? Math.hypot(now.x - stoppedAt.x, now.z - stoppedAt.z) : 0;
  const extra = cut.type === "interrupted" && scene.interruptCheck ? scene.interruptCheck(cut.changes ?? {}, seen) : ([true, ""] as [boolean, string]);
  // A primitive too quick to catch simply finishes: that is clean too.
  const clean = left.length === 0 && still < 0.3 && extra[0] && cut.type !== "failed";
  const interrupted = `${cut.type === "done" ? "finished first" : cut.type}${left.length ? ` (left: ${left.join(", ")})` : ""}${still >= 0.3 ? " (still moving)" : ""}${extra[1] ? `; ${extra[1]}` : ""}`;
  console.log(`    interrupted run: ${interrupted}`);
  if (bot.getControlState("sneak")) bot.setControlState("sneak", false);
  await executor.interrupt();
  if (bot.currentWindow) await bot.closeWindow(bot.currentWindow);
  return { name, completed, interrupted: clean ? "yes" : "NO", changes: correct ? "yes" : "NO", ok: full.type === "done" && clean && correct };
}

const rows: Row[] = [];
let together: Awaited<ReturnType<typeof walkAndLook>> | null = null;
try {
  for (const scene of scenes.filter((s) => wanted.length === 0 || wanted.includes(s.primitive))) rows.push(await play(scene, observer));
  if (wanted.length === 0 || wanted.includes("walk_and_look")) {
    together = await walkAndLook(executor, observer, sideEvents);
    console.log(`- walk and look at the same time: ${together.ok ? "ok" : "NOT ok"}; ${together.detail}`);
  }
} finally {
  tearDown();
  observer.quit();
  bot.quit();
}

const table = [["primitive", "completed", "interrupted cleanly", "changes correct"], ...rows.map((r) => [r.name, r.completed, r.interrupted, r.changes])];
const widths = table[0]!.map((_, c) => Math.max(...table.map((row) => row[c]!.length)));
console.log("");
for (const [i, row] of table.entries()) {
  console.log(row.map((cell, c) => cell.padEnd(widths[c]!)).join(" | "));
  if (i === 0) console.log(widths.map((w) => "-".repeat(w)).join("-|-"));
}
const violations = [...moduleRuleViolations(), ...doorwayViolations(), ...travelViolations()];
console.log(violations.length ? `\nModule rules BROKEN:\n${violations.join("\n")}` : "\nModule rules OK: no Minecraft imports in the game-free packages, and nothing outside primitives/ and locomotion/ moves the body, and only locomotion/ travels.");
if (together) console.log(`\nDifferent body parts at the same time (walking east, looking north): ${together.ok ? "PASS" : "FAIL"}`);
const failed = [...rows.filter((r) => !r.ok).map((r) => r.name), ...(together && !together.ok ? ["walk_and_look"] : [])];
console.log(failed.length ? `\nFAIL: ${failed.join(", ")}` : `\nPASS: all ${rows.length} scenes${together ? ", and walking while looking" : ""}.`);
process.exit(failed.length || violations.length ? 1 : 0);
