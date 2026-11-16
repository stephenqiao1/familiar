// Live demonstrations of the limits in docs/findings.md, to watch in your own Minecraft client.
// Join the test server (Minecraft 1.21.11, Multiplayer, Direct Connection, localhost:25565), then:
//   pnpm demo                 list the demos
//   pnpm demo follow door     run some
//   pnpm demo all             run every one, pausing between them
//   pnpm demo follow --viewer Steve --no-pause
// Each demo moves your camera (as a spectator), says on screen what to watch for, keeps a live
// readout above your hotbar, and ends with the measured result. You are put back afterwards.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { far, dawn, hold } from "./demo/brain-demos.ts";
import { door } from "./demo/door.ts";
import { follow } from "./demo/follow.ts";
import { glance } from "./demo/glance.ts";
import { lava } from "./demo/lava.ts";
import { pond } from "./demo/pond.ts";
import { speeds } from "./demo/speeds.ts";
import { createStage, findViewer } from "./demo/stage.ts";
import { stuck } from "./demo/stuck.ts";
import type { Demo } from "./demo/types.ts";
import { sleep, tearDown } from "./primitive-check/world.ts";

const DEMOS: Demo[] = [follow, door, pond, speeds, glance, stuck, lava, hold, far, dawn];
const TALLY_FILE = "data/demo-tally.json";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const viewerName = args.includes("--viewer") ? args[args.indexOf("--viewer") + 1] : undefined;
const names = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--viewer");

if (names.length === 0) {
  console.log("Live demos of the limits in docs/findings.md. Join localhost:25565 in Minecraft 1.21.11, then run: pnpm demo <name ...> | all\n");
  const width = Math.max(...DEMOS.map((d) => d.name.length));
  for (const d of DEMOS) console.log(`  ${d.name.padEnd(width)}  ${d.title}${d.varies ? "  (uses Jev: varies from run to run)" : ""}\n  ${" ".repeat(width)}  ${d.watch}\n`);
  process.exit(0);
}
const chosen = names.includes("all") ? DEMOS : names.map((name) => DEMOS.find((d) => d.name === name) ?? name);
const unknown = chosen.filter((d): d is string => typeof d === "string");
if (unknown.length) {
  console.error(`Unknown demo(s): ${unknown.join(", ")}. Use: ${DEMOS.map((d) => d.name).join(", ")}, or all.`);
  process.exit(1);
}

/** How often each demo has shown its limit, kept between runs. */
function tally(name: string, shown: boolean): { runs: number; shown: number } {
  const all = existsSync(TALLY_FILE) ? (JSON.parse(readFileSync(TALLY_FILE, "utf8")) as Record<string, { runs: number; shown: number }>) : {};
  const mine = all[name] ?? { runs: 0, shown: 0 };
  all[name] = { runs: mine.runs + 1, shown: mine.shown + Number(shown) };
  mkdirSync("data", { recursive: true });
  writeFileSync(TALLY_FILE, `${JSON.stringify(all, null, 2)}\n`);
  return all[name];
}

const viewer = await findViewer(viewerName);
console.log(`Showing to ${viewer}.`);
const stage = createStage(viewer);
const prompt = createInterface({ input: process.stdin, output: process.stdout });
let failed = false;
try {
  for (const [i, demo] of (chosen as Demo[]).entries()) {
    console.log(`\n=== ${demo.name}: ${demo.title}\n    finding: ${demo.finding}\n    watch:   ${demo.watch}`);
    stage.camera(demo.camera);
    stage.title(demo.title, "watch the bar above your hotbar");
    stage.say(`▶ ${demo.title}`, "gold");
    stage.say(demo.watch);
    await sleep(4000);
    try {
      const outcome = await demo.run(stage);
      const count = tally(demo.name, outcome.shown);
      const seen = `The limit ${outcome.shown ? "showed" : "did not show"} this time (${count.shown} of ${count.runs} runs so far).`;
      stage.title(outcome.shown ? "Limit shown" : "Not this time", demo.title, outcome.shown ? "red" : "green");
      stage.say(`Result: ${outcome.result}`, "white");
      stage.say(seen, outcome.shown ? "red" : "green");
      console.log(`    result:  ${outcome.result}\n    ${seen}`);
    } catch (error) {
      failed = true;
      stage.say(`The demo broke: ${error instanceof Error ? error.message : error}`, "red");
      console.error(`    the demo broke: ${error instanceof Error ? error.stack : error}`);
    }
    if (i < chosen.length - 1 && !flag("--no-pause")) await prompt.question("    Press Enter for the next demo... ");
    else await sleep(5000);
  }
} finally {
  prompt.close();
  tearDown();
  stage.leave();
}
process.exit(failed ? 1 : 0);
