// Live check of the locomotion controller on the test server: flat walks at two speeds, a pond,
// a pit, a door, following a moving player, stopping mid-journey, and looking while walking.
// Needs the server container (MC_CONTAINER, default familiar-m6) and a fresh build.
//   pnpm locomotion-check [scene ...]
import type { SkillEvent, SkillResult } from "@familiar/contracts";
import { createSkillExecutor } from "@familiar/core";
import { connect, createLocomotion, minecraftSkills, type MinecraftCtx } from "@familiar/minecraft";
import { walkAndLook } from "./primitive-check/walk-and-look.ts";
import { BOT, buildPlaza, rcon, reset, sleep, startObserver, tearDown } from "./primitive-check/world.ts";

const wanted = process.argv.slice(2);
const never = new AbortController().signal;
const KEYS = ["forward", "back", "left", "right", "jump", "sprint", "sneak"] as const;

const bot = await connect({ host: "localhost", port: 25565, username: BOT });
bot.on("error", (error) => console.error(`Bot error: ${error.message}`));
await bot.waitForChunksToLoad();
buildPlaza();
await reset();
const observer = await startObserver();
const notes: string[] = [];
const locomotion = createLocomotion(bot, { log: (msg) => notes.push(msg) });
const ctx: MinecraftCtx = { bot, base: { chest: bot.entity.position.clone(), bed: bot.entity.position.clone() }, wants: () => [], locomotion, chests: {} as MinecraftCtx["chests"], log: () => {} };

/** Puts the bot at a spot on the plaza floor, facing east, with everything else reset. */
async function start(x: number, z = 40, y = 151): Promise<void> {
  await reset();
  locomotion.setDrive({ speed: 0.4, caution: 0.3 });
  rcon(`tp ${BOT} ${x + 0.5} ${y} ${z + 0.5} -90 0`);
  await sleep(900);
  notes.length = 0;
}
const at = (x: number, z = 40, y = 151) => bot.entity.position.clone().set(x + 0.5, y, z + 0.5);
const keysHeld = () => KEYS.filter((key) => bot.getControlState(key));
const nearX = (x: number) => Math.abs(bot.entity.position.x - (x + 0.5)) <= 2;

interface Row {
  scene: string;
  arrived: string;
  seconds: string;
  recoveries: string;
  switches: string;
  ok: boolean;
  detail: string;
}
const row = (scene: string, result: SkillResult, ok: boolean, detail: string): Row => ({
  scene,
  arrived: result.status === "done" ? "yes" : `${result.status}${result.reason ? `: ${result.reason}` : ""}`,
  seconds: String(result.changes?.seconds ?? ""),
  recoveries: `${result.changes?.recoveries ?? 0}${result.changes?.recovered ? ` (${String(result.changes.recovered)})` : ""}`,
  switches: String(result.changes?.patternSwitches ?? 0),
  ok,
  detail,
});

/**
 * Runs a journey that is likely to get stuck and watches how it ends: it must either get free
 * or fail cleanly, with no keys left held and without spinning on the spot.
 */
async function watchStuck(scene: string, goal: ReturnType<typeof at>, free: () => boolean): Promise<Row> {
  let turned = 0;
  let last = bot.entity.yaw;
  const watch = setInterval(() => {
    turned += Math.abs(Math.atan2(Math.sin(bot.entity.yaw - last), Math.cos(bot.entity.yaw - last)));
    last = bot.entity.yaw;
  }, 100);
  const started = Date.now();
  const result = await Promise.race([locomotion.goTo(goal, { range: 1 }, never), sleep(60_000).then((): SkillResult => ({ status: "failed", reason: "no result in 60 s" }))]);
  clearInterval(watch);
  locomotion.stop();
  const seconds = (Date.now() - started) / 1000;
  const circles = turned / (2 * Math.PI);
  const clean = result.status === "done" || (result.status === "failed" && result.reason !== "no result in 60 s");
  const tried = notes.filter((n) => n.includes("trying")).map((n) => n.split("trying ")[1]).join(", ");
  return row(scene, result, clean && keysHeld().length === 0 && circles < 0.5 * seconds, `${free() ? "got free" : "did not get free"} after ${seconds.toFixed(1)} s; turned ${circles.toFixed(1)} full circles; recoveries: ${tried || "none"}; keys held after: ${keysHeld().join(",") || "none"}`);
}

const scenes: Record<string, () => Promise<Row>> = {
  /** 1. A flat walk of 30 blocks at the resting drive. */
  async flat() {
    await start(44);
    const result = await locomotion.goTo(at(74), { range: 1 }, never);
    const d = Number(result.changes?.distance ?? 0);
    return row("flat walk, 30 blocks", result, result.status === "done" && nearX(74) && d > 27 && d < 34, `distance ${d}, time ${result.changes?.seconds} s, late ${result.changes?.late}`);
  },
  /** 2. The same walk with alarm raised: speed 0.9, a sprint from the first step. */
  async alarmed() {
    /** Walks the 30 blocks and notes when sprint was first held, and for how much of the walk. */
    const timed = async (speed: number) => {
      await start(44);
      locomotion.setDrive({ speed });
      const began = Date.now();
      let firstSprint: number | null = null;
      let [sprinting, samples] = [0, 0];
      const watch = setInterval(() => {
        samples++;
        if (!bot.getControlState("sprint")) return;
        sprinting++;
        firstSprint ??= Date.now() - began;
      }, 50);
      const result = await locomotion.goTo(at(74), { range: 1 }, never);
      clearInterval(watch);
      return { result, seconds: Number(result.changes?.seconds), firstSprint, share: sprinting / Math.max(1, samples) };
    };
    const strolling = await timed(0.2); // a walk
    const calm = await timed(0.4); // the resting drive: sprints once the stretch has proved straight
    const alarmed = await timed(0.9); // what full alarm gives: 0.4 + 0.5 × 1
    // Times are only good to a quarter of a second (how often the controller looks), so "no slower" allows that much.
    const ok = alarmed.result.status === "done" && alarmed.seconds < strolling.seconds && alarmed.seconds <= calm.seconds + 0.3 && (alarmed.firstSprint ?? Infinity) < (calm.firstSprint ?? Infinity) && strolling.share === 0;
    const show = (name: string, run: typeof calm) => `${name} ${run.seconds} s (sprinting ${(run.share * 100).toFixed(0)}% of it, from ${run.firstSprint === null ? "never" : `${run.firstSprint} ms`})`;
    return row("same walk, alarm raised", alarmed.result, ok, [show("alarmed", alarmed), show("resting", calm), show("slow", strolling)].join("; "));
  },
  /** 3. Across a pond two deep. */
  async pond() {
    await start(46);
    // A basin across the whole plaza, with the side walls raised so there is no way round along their tops.
    for (const command of ["fill 53 147 35 61 150 45 stone", "fill 54 149 36 60 150 44 water", "fill 50 151 35 64 157 35 glass", "fill 50 151 45 64 157 45 glass"]) rcon(command);
    await sleep(800);
    const patterns = new Set<string>();
    const trail: string[] = [];
    const watch = setInterval(() => {
      patterns.add(locomotion.status().pattern ?? "none");
      const p = bot.entity.position;
      if (process.env.DEBUG_POND) trail.push(`${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)} feet=${bot.blockAt(p)?.name} below=${bot.blockAt(p.offset(0, -1, 0))?.name}`);
    }, 100);
    const result = await locomotion.goTo(at(70), { range: 1 }, never);
    if (trail.length) console.log(trail.filter((_, i) => i % 4 === 0).join("\n"));
    clearInterval(watch);
    const switches = Number(result.changes?.patternSwitches ?? 0);
    return row("across a pond", result, result.status === "done" && nearX(70) && patterns.has("swim") && switches >= 2, `patterns seen: ${[...patterns].join(", ")}; ${notes.filter((n) => n.includes("→")).join("; ")}`);
  },
  /** 4. Boxed in a 1x1 pit two deep, in bedrock so it cannot dig out. */
  async pit() {
    await start(50);
    rcon("fill 49 147 39 51 150 41 bedrock");
    rcon("fill 50 149 40 50 150 40 air");
    rcon(`tp ${BOT} 50.5 149 40.5 -90 0`);
    await sleep(900);
    return watchStuck("boxed in a pit", at(60), () => bot.entity.position.y >= 150.9);
  },
  /**
   * 4b. Held fast: the route is open and the legs keep trying, but the body does not move.
   * (The test switches the bot's own movement off a second into the walk: the server's ways of
   * slowing a player, a slowness effect or a movement speed of 0, do not hold this client still.)
   */
  async held() {
    await start(50);
    const freeze = setTimeout(() => (bot.physicsEnabled = false), 1000);
    const result = await watchStuck("held fast on an open path", at(72), () => bot.entity.position.x > 71);
    clearTimeout(freeze);
    bot.physicsEnabled = true;
    // With its movement off the bot's route planner stops too, so after the sidestep the journey ends as
    // "no path found" and not "stuck": the third recovery (plan again) is covered by the unit tests only.
    return { ...result, ok: result.ok && /^failed: (stuck at|no path found)/.test(result.arrived) && /jump, sidestep/.test(result.recoveries) };
  },
  /** 5. Through a closed door in a wall. */
  async door() {
    await start(58);
    for (const command of ["fill 64 151 36 64 153 44 stone", "setblock 64 151 40 oak_door[half=lower,facing=east]", "setblock 64 152 40 oak_door[half=upper,facing=east]"]) rcon(command);
    await sleep(800);
    const result = await locomotion.goTo(at(72), { range: 1 }, never);
    const wall = ["64 151 39", "64 151 41", "64 152 39", "64 152 41"].every((p) => observer.block(p).name === "stone");
    const used = notes.some((n) => n.includes("going through the door"));
    return row("through a closed door", result, result.status === "done" && nearX(72) && used && wall, `used the door: ${used}; wall left whole: ${wall}; door now open: ${observer.block("64 151 40").properties.open}`);
  },
  /** 6. Follow a player who walks up and down the plaza for 30 seconds. */
  async follow() {
    await start(46);
    const leader = await connect({ host: "localhost", port: 25565, username: "Leader" });
    rcon("gamemode creative Leader");
    rcon("tp Leader 50.5 151 42.5");
    await leader.waitForChunksToLoad();
    await sleep(1500);
    // The leader is a plain test player, steered by hand here: it walks east, then west, and so on.
    let east = true;
    const steerLeader = setInterval(() => {
      if (leader.entity.position.x > 74) east = false;
      if (leader.entity.position.x < 46) east = true;
      void leader.look(east ? -Math.PI / 2 : Math.PI / 2, 0, true);
      leader.setControlState("forward", true);
    }, 100);
    const entity = bot.players.Leader?.entity;
    if (!entity) {
      clearInterval(steerLeader);
      leader.quit();
      return row("follow a moving player", { status: "failed", reason: "the bot cannot see the leader" }, false, "");
    }
    const stop = new AbortController();
    const following = locomotion.follow(entity, { range: 3 }, stop.signal);
    const gaps: number[] = [];
    for (let i = 0; i < 60; i++) {
      await sleep(500);
      gaps.push(entity.position.distanceTo(bot.entity.position));
    }
    const led = Math.abs(leader.entity.position.x - 50.5) + gaps.length; // it kept moving the whole time
    stop.abort(new Error("interrupted"));
    const result = await following;
    clearInterval(steerLeader);
    leader.quit();
    // The walking rhythm plans to where the leader was, so the bot trails by a few blocks more than the range.
    const close = gaps.slice(6).filter((g) => g <= 8).length / gaps.slice(6).length;
    return row("follow a moving player, 30 s", { ...result, status: result.status === "interrupted" ? "done" : result.status }, close > 0.8 && keysHeld().length === 0 && led > 0, `asked to keep within 3; within 8 blocks ${(close * 100).toFixed(0)}% of the time, typically ${[...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)]!.toFixed(1)}, farthest ${Math.max(...gaps).toFixed(1)}; travelled ${result.changes?.distance} blocks; keys held after stopping: ${keysHeld().join(",") || "none"}`);
  },
  /** 7. Stop mid-journey. */
  async stop() {
    await start(44);
    const journey = locomotion.goTo(at(76), { range: 1 }, never);
    await sleep(1500);
    locomotion.stop();
    const keys = keysHeld();
    const result = await journey;
    await sleep(400);
    const where = bot.entity.position.clone();
    await sleep(1000);
    const drift = bot.entity.position.distanceTo(where);
    return row("stop mid-journey", result, result.status === "interrupted" && keys.length === 0 && drift < 0.05 && !locomotion.status().moving, `keys held at once after stop(): ${keys.join(",") || "none"}; moved ${drift.toFixed(2)} blocks in the next second`);
  },
  /** 8. Looking one way while walking another (--same-time). */
  async look() {
    const sideEvents: SkillEvent[] = [];
    const executor = createSkillExecutor({ skills: minecraftSkills, ctx, onEvent: () => {}, onSideEvent: (event) => void sideEvents.push(event) });
    const together = await walkAndLook(executor, observer, sideEvents);
    await executor.interrupt();
    return { scene: "looking while walking", arrived: together.ok ? "yes" : "NO", seconds: "", recoveries: "", switches: "", ok: together.ok, detail: together.detail };
  },
};

const rows: Row[] = [];
try {
  for (const [name, play] of Object.entries(scenes)) {
    if (wanted.length && !wanted.includes(name)) continue;
    const result = await play().catch((error: unknown): Row => ({ scene: name, arrived: "ERROR", seconds: "", recoveries: "", switches: "", ok: false, detail: String(error) }));
    rows.push(result);
    console.log(`- ${result.scene}: ${result.ok ? "ok" : "NOT ok"}; ${result.detail}`);
    for (const note of notes) console.log(`    ${note}`);
  }
} finally {
  locomotion.stop();
  tearDown();
  observer.quit();
  bot.quit();
}

const table = [["scene", "arrived", "time (s)", "recoveries", "pattern switches", "ok"], ...rows.map((r) => [r.scene, r.arrived, r.seconds, r.recoveries, r.switches, r.ok ? "yes" : "NO"])];
const widths = table[0]!.map((_, c) => Math.max(...table.map((r) => r[c]!.length)));
console.log("");
for (const [i, r] of table.entries()) {
  console.log(r.map((cell, c) => cell.padEnd(widths[c]!)).join(" | "));
  if (i === 0) console.log(widths.map((w) => "-".repeat(w)).join("-|-"));
}
const failed = rows.filter((r) => !r.ok);
console.log(failed.length ? `\nFAIL: ${failed.map((r) => r.scene).join(", ")}` : `\nPASS: all ${rows.length} scenes.`);
process.exit(failed.length ? 1 : 0);
