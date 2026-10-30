// M2 check: run the bot on Jev, summon a zombie 10 blocks away every 20 s (10 times), then
// report reaction times. Needs the local test server and TYPESAFE_API_KEY (.env).
//   node --env-file-if-exists=.env apps/run-bot/scripts/reaction-check.ts
import { spawn, spawnSync } from "node:child_process";
import { rcon } from "./skill-check/rcon.ts";
import { setUpTestWorld } from "./skill-check/test-world.ts";

const EVENTS = 10;
const EVERY_MS = 20_000;
const ZOMBIE = `zombie ~-10 ~1 ~ {PersistenceRequired:1b,equipment:{head:{id:"minecraft:leather_helmet",count:1}}}`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

if (process.platform === "darwin") {
  // Sleep pauses the server VM and skews every timing.
  spawn("caffeinate", ["-i", "-w", String(process.pid)], { stdio: "ignore", detached: true }).unref();
}

console.log("Setting up the test world (daytime, flat area west of base)...");
await setUpTestWorld();

const bot = spawn("node", ["apps/run-bot/dist/index.js", "--engine", "jev"], { stdio: ["ignore", "pipe", "pipe"] });
let output = "";
bot.stdout.on("data", (d: Buffer) => (output += d));
bot.stderr.on("data", (d: Buffer) => (output += d));
await sleep(EVERY_MS / 2);

for (let i = 1; i <= EVENTS; i++) {
  rcon("kill @e[type=zombie]");
  await sleep(1500);
  const reply = rcon(`execute at Miner run summon ${ZOMBIE}`);
  console.log(`zombie ${i}/${EVENTS}: ${reply}`);
  await sleep(EVERY_MS - 1500);
}

bot.kill("SIGINT");
await new Promise((resolve) => bot.once("exit", resolve));
rcon("kill @e[type=zombie]");

const log = /Logging to (\S+)/.exec(output)?.[1];
const failedTicks = output.split("\n").filter((l) => l.startsWith("[loop] tick")).length;
console.log(`\nbot exited; failed ticks logged: ${failedTicks}; log: ${log}\n`);
spawnSync("node", ["apps/run-bot/scripts/reaction-report.ts", ...(log ? [log] : [])], { stdio: "inherit" });
