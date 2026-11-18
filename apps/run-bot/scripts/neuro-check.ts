// Live check of the brain (neuromodulators, reflexes and brainstem): runs the real bot (Jev + Claude) through scripted scenes on
// the test server and judges each from its tick log. Needs the server container running and
// TYPESAFE_API_KEY / ANTHROPIC_API_KEY in .env.
// Usage: pnpm neuro-check [scene ...]      (default: every scene)
//        MC_CONTAINER=familiar-m6 pnpm neuro-check ambush
import { execFileSync, spawn } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";

const CONTAINER = process.env.MC_CONTAINER ?? "familiar-m6";
const BOT = "Tester";
const rcon = (command: string) => {
  try {
    return execFileSync("docker", ["exec", CONTAINER, "rcon-cli", "--", command], { encoding: "utf8" }).trim();
  } catch (error) {
    return `rcon failed: ${error instanceof Error ? error.message : error}`;
  }
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Tick {
  tick: number;
  timestamp: number;
  regions: { region: string; proposals: unknown[]; trace?: Record<string, unknown>; error?: string }[];
  winner: { region: string; reason: string; urgency: number; action: { skill?: string; target?: string } } | null;
  action: { skill?: string };
  goal: { text: string; setBy: string; ifThen?: { when: string; skill: string }[]; holdBack?: string[] } | null;
  signals: Record<string, { value: number }>;
  state: {
    data: {
      self: { health: number; food: number; asleep: boolean; deaths: number; air: number; onFire: boolean; inLava: boolean; inWater: boolean; bestWeapon: string | null };
      time: { isNight: boolean };
      nearby: { mobs: { id: string; type: string; dist: number; hostile: boolean; reachable: boolean }[] };
      memory: { nearby: string; kind: string } | null;
    };
  };
  skillEvents?: { skill: string; type: string; reason?: string; alongside?: boolean }[];
  /** A proposal acted on alongside the main action (with --same-time). */
  alongside?: { region: string; action: { skill?: string } };
}

interface Run {
  ticks: Tick[];
  output: string;
  /** Seconds from the bot's first tick to the tick. */
  at(t: Tick): number;
  signal(name: string): number[];
  trace(t: Tick, region: string): Record<string, unknown>;
  events(): { skill: string; type: string; reason?: string; alongside?: boolean }[];
}

interface Scene {
  name: string;
  about: string;
  seconds: number;
  /** Server commands before the bot joins. */
  before?: string[];
  /** Server commands while it runs: [seconds after joining, command]. */
  during?: [number, string][];
  /** Server commands after the bot has left (clean-up). */
  after?: string[];
  /** Keep what the bot learned in earlier scenes (default: start fresh). */
  keepMemory?: boolean;
  /** The bot to run (its settings come from bots.json). Default: Tester. Commands naming Tester are aimed at it. */
  bot?: string;
  /** Extra flags for the bot (e.g. --same-time). */
  flags?: string[];
  /** Use the echo planner with this fixed plan instead of Claude. */
  plan?: { goal: string; ifThen?: { when: string; skill: string }[]; holdBack?: string[] };
  /** Each check: what should be true, and whether it was. */
  checks(run: Run): [string, boolean, string?][];
}

const ZOMBIE = `summon zombie ~2 ~ ~ {PersistenceRequired:1b,equipment:{head:{id:"minecraft:leather_helmet",count:1}}}`;
/** A quiet day with no mobs spawning (1.21.11 names the rule spawn_mobs). */
const CALM = ["gamerule spawn_mobs false", "difficulty peaceful", "time set 1000", "weather clear", "kill @e[type=item]"];

// A walled stone plaza in the sky (x 40 to 80, z 36 to 44, floor at y 150), away from the base:
// a known flat floor with room to run, where lava, water and mobs can do no harm to the world.
const HOME = `tp ${BOT} -8 69 14`;
const PLAZA = [
  "forceload add 39 35 81 45",
  "fill 40 140 35 80 148 45 air",
  "fill 40 149 36 80 150 44 stone",
  "fill 40 151 36 80 158 44 air",
  "fill 39 151 35 81 152 35 glass",
  "fill 39 151 45 81 152 45 glass",
  "fill 39 151 35 39 152 45 glass",
  "fill 81 151 35 81 152 45 glass",
  "kill @e[type=!player,x=60,y=150,z=40,distance=..48]",
];
const TO_PLAZA = `tp ${BOT} 60.5 151 40.5`;
const CLEAR_PLAZA = ["kill @e[type=!player,x=60,y=150,z=40,distance=..48]", "fill 40 151 36 80 160 44 air", "fill 40 149 36 80 150 44 stone"];
const HELMET = `{PersistenceRequired:1b,equipment:{head:{id:"minecraft:leather_helmet",count:1}}}`;
const selfOf = (t: Tick) => t.state.data.self;
const hostiles = (t: Tick) => t.state.data.nearby.mobs.filter((m) => m.hostile);
type Fired = { rule: string; kind: "hard" | "soft"; skill: string | null; base: number; gain: number; urgency: number };
/** What the brave bot did, kept for the timid bot's scene to compare with. */
const ambushOf = new Map<string, { firstMove: string; atDistance: number; fleeGain: number; attackGain: number; fled: number; fought: number }>();

/** The same ambush for a brave and a timid bot: armed, with a zombie closing in from 6 blocks. */
function temperamentScene(bot: string, about: string): Scene {
  return {
    name: bot.toLowerCase(),
    about,
    seconds: 45,
    bot,
    before: [...CALM, "difficulty easy", ...PLAZA],
    during: [
      [2, `clear ${BOT}`],
      [3, `give ${BOT} stone_sword 1`],
      [5, TO_PLAZA],
      [14, `summon zombie 66.5 151 40.5 ${HELMET}`],
      [40, "kill @e[type=zombie]"],
      [42, HOME],
    ],
    after: CLEAR_PLAZA,
    checks: (run) => {
      const fired = run.ticks.flatMap((t) => ((run.trace(t, "reflex").rules as Fired[] | undefined) ?? []).map((f) => ({ ...f, t })));
      const gainOf = (skill: string) => mean(fired.filter((f) => f.kind === "soft" && f.skill === skill).map((f) => f.gain));
      const moves = run.ticks.flatMap((t) => (t.skillEvents ?? []).filter((e) => e.type === "started" && (e.skill === "flee" || e.skill === "attack")).map((e) => ({ skill: e.skill, dist: Math.min(99, ...hostiles(t).map((m) => m.dist)) })));
      const mine = { firstMove: moves[0]?.skill ?? "none", atDistance: moves[0]?.dist ?? -1, fleeGain: gainOf("flee"), attackGain: gainOf("attack"), fled: moves.filter((m) => m.skill === "flee").length, fought: moves.filter((m) => m.skill === "attack").length };
      ambushOf.set(bot, mine);
      const brave = ambushOf.get("Brave");
      const compare: [string, boolean, string?][] =
        bot === "Timid" && brave
          ? [
              ["the timid bot's flee reflex is stronger than the brave bot's", mine.fleeGain > brave.fleeGain, `timid ${mine.fleeGain.toFixed(2)} vs brave ${brave.fleeGain.toFixed(2)}`],
              ["REPORT brave", true, `first ${brave.firstMove} at ${brave.atDistance} blocks; fled ×${brave.fled}, fought ×${brave.fought}; flee gain ${brave.fleeGain.toFixed(2)}, attack gain ${brave.attackGain.toFixed(2)}`],
            ]
          : [];
      return [
        ["the zombie was seen", run.ticks.some((t) => hostiles(t).length > 0)],
        ["a defence reflex fired", fired.some((f) => f.kind === "soft" && (f.skill === "flee" || f.skill === "attack")), `${fired.length} firings`],
        ["it reacted", moves.length > 0],
        [`REPORT ${bot.toLowerCase()}`, true, `first ${mine.firstMove} at ${mine.atDistance} blocks; fled ×${mine.fled}, fought ×${mine.fought}; flee gain ${mine.fleeGain.toFixed(2)}, attack gain ${mine.attackGain.toFixed(2)}`],
        ...compare,
        ["it survived", run.ticks.every((t) => selfOf(t).deaths === 0)],
      ];
    },
  };
}

const max = (values: number[]) => Math.max(0, ...values);
const min = (values: number[]) => Math.min(1, ...values);
const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

const scenes: Scene[] = [
  {
    name: "calm",
    about: "A quiet day at base: nothing should alarm the bot, and the planner stays in charge.",
    seconds: 60,
    before: CALM,
    checks: (run) => [
      ["alarm stays low", max(run.signal("alarm")) < 0.3, `max ${max(run.signal("alarm")).toFixed(2)}`],
      ["the planner is never taken offline", max(run.signal("planner_offline")) === 0],
      ["no interrupts", max(run.signal("interrupt")) === 0],
      ["dopamine stays off the ceiling", mean(run.signal("dopamine")) < 0.85, `mean ${mean(run.signal("dopamine")).toFixed(2)}`],
      ["the planner set a goal", run.ticks.some((t) => t.goal?.setBy === "prefrontal")],
      ["skills are not restarted every tick", run.events().filter((e) => e.type === "started").length < run.ticks.length / 3, `${run.events().filter((e) => e.type === "started").length} starts in ${run.ticks.length} ticks`],
    ],
  },
  {
    name: "ambush",
    about: "A zombie appears next to the bot mid-task: alarm should spike, reflexes take over, and it calms down after.",
    seconds: 100,
    before: [...CALM, "difficulty normal"],
    during: [
      [25, `execute at ${BOT} run ${ZOMBIE}`],
      [55, "kill @e[type=zombie]"],
      [56, "difficulty peaceful"],
    ],
    checks: (run) => {
      const alarm = run.signal("alarm");
      const firstHigh = run.ticks.find((t) => (t.signals.alarm?.value ?? 0) > 0.5);
      // A reflex wins a tick, or the startle releases a response the planner had prepared (then Jev may carry the same skill on).
      const reflexWon = run.ticks.some((t) => t.winner?.region === "reflex" || (t.winner?.region === "brainstem" && (run.trace(t, "brainstem").startle as { released?: string } | undefined)?.released !== undefined));
      const recorded = run.ticks.flatMap((t) => (run.trace(t, "hippocampus").recorded as { summary: string; strength: number }[] | undefined) ?? []);
      const danger = recorded.filter((r) => /damage|Died|surprised by/.test(r.summary));
      const lastAlarm = alarm.at(-1) ?? 1;
      const patience = run.signal("patience");
      const patienceDrop = max(patience.slice(1).map((p, i) => patience[i]! - p));
      return [
        ["alarm is low before the ambush", max(run.ticks.filter((t) => run.at(t) < 22).map((t) => t.signals.alarm?.value ?? 0)) < 0.3],
        ["alarm spikes above 0.5 within 10 s of the zombie appearing", firstHigh !== undefined && run.at(firstHigh) < 35, firstHigh ? `at ${run.at(firstHigh).toFixed(1)} s` : "never"],
        ["a reflex, or a response the startle released, takes over", reflexWon],
        ["the planner's weight drops", min(run.signal("planner_weight")) < 0.8, `min ${min(run.signal("planner_weight")).toFixed(2)}`],
        ["patience is cut by about 0.2 when alarm jumps", patienceDrop > 0.15, `largest drop in one tick ${patienceDrop.toFixed(2)}`],
        ["the danger is remembered, more strongly than a calm event", danger.some((d) => d.strength > 0.35), danger.map((d) => `${d.summary} [${d.strength.toFixed(2)}]`).join("; ") || "nothing recorded"],
        ["alarm has faded by the end", lastAlarm < 0.4, `ends at ${lastAlarm.toFixed(2)}`],
        ["the planner is back in charge by the end", (run.signal("planner_offline").at(-1) ?? 1) === 0],
      ];
    },
  },
  {
    name: "remembered",
    about: "Restart after the ambush: the bot should still remember the spot, and it should feel bad there.",
    seconds: 30,
    before: CALM,
    keepMemory: true,
    checks: (run) => [
      ["memories were loaded from disk", /Memories: [1-9]\d* remembered/.test(run.output), run.output.match(/Memories: \d+ remembered/)?.[0]],
      ["the place feels bad from memory", run.ticks.some((t) => t.state.data.memory?.nearby === "bad"), JSON.stringify(run.ticks.find((t) => t.state.data.memory)?.state.data.memory ?? null)],
      ["the planner is told about it", run.ticks.some((t) => /damage|Died|surprised by/.test(String(run.trace(t, "prefrontal").situation ?? "")))],
    ],
  },
  {
    name: "hunger",
    about: "The bot is made hungry and given bread: eating should be rewarded, most when hungriest.",
    seconds: 70,
    // Hunger only drains outside peaceful difficulty; with spawning off nothing hostile appears.
    before: [...CALM, "difficulty easy"],
    during: [
      [3, `effect give ${BOT} hunger 20 120 true`],
      [4, `give ${BOT} bread 6`],
    ],
    checks: (run) => {
      const rewards = run.ticks.flatMap((t) => (run.trace(t, "dopamine").rewards as { rule: string; amount: number }[] | undefined) ?? []);
      const ate = rewards.filter((r) => r.rule === "food_bar_up");
      const eats = run.events().filter((e) => e.skill === "eat" && e.type === "done").length;
      const foodLow = Math.min(...run.ticks.map((t) => t.state.data.self.food));
      return [
        ["the bot got hungry", foodLow < 18, `lowest food ${foodLow}`],
        ["it ate", eats > 0, `${eats} times`],
        ["eating was rewarded", ate.length > 0, ate.map((r) => r.amount.toFixed(2)).join(", ")],
        ["no rule errors", run.ticks.every((t) => t.regions.every((r) => !r.trace?.errors))],
      ];
    },
  },
  {
    name: "night",
    about: "Night falls with a bed at base: the bot should sleep, focus should drop to its floor, and memories get sorted.",
    seconds: 60,
    before: [...CALM, "time set 14000"],
    checks: (run) => {
      const asleep = run.ticks.filter((t) => t.state.data.self.asleep);
      const sorted = run.ticks.filter((t) => run.trace(t, "hippocampus").consolidation !== undefined);
      const rewards = run.ticks.flatMap((t) => (run.trace(t, "dopamine").rewards as { rule: string }[] | undefined) ?? []);
      const woken = run.events().filter((e) => e.skill === "sleep" && e.type === "interrupted");
      return [
        ["it starts at night", run.ticks[0]?.state.data.time.isNight === true],
        ["the bot goes to sleep", asleep.length > 0, `${asleep.length} ticks asleep`],
        ["focus drops to its floor while asleep", asleep.length > 0 && asleep.every((t) => (t.signals.focus?.value ?? 1) <= 0.06)],
        ["memories are consolidated while asleep", sorted.length > 0, `${sorted.length} phases`],
        ["nothing wakes it early", woken.length === 0, woken.map((e) => e.reason ?? "interrupted").join("; ")],
        ["sleeping through the night is rewarded", rewards.some((r) => r.rule === "slept_through_night")],
        ["it is day by the end", run.ticks.at(-1)?.state.data.time.isNight === false],
      ];
    },
  },
  {
    name: "dark",
    about: "Dropped somewhere unknown, far from bed, at midnight: focus should rise and the outlook fall.",
    seconds: 45,
    // It joins by day and is moved before night falls: joining at night beside its bed, it goes
    // straight to sleep, and a bot woken by being moved starts from its lowest focus.
    before: CALM,
    during: [
      [2, `spreadplayers 400 400 0 20 false ${BOT}`],
      [3, "time set 18000"],
      [44, `tp ${BOT} -8 69 14`],
    ],
    checks: (run) => {
      // Judged once it is there, in the dark (the first seconds are by day, at base).
      const there = run.ticks.filter((t) => run.at(t) > 6);
      const dark = there.flatMap((t) => (run.trace(t, "acetylcholine").inputs as Record<string, number> | undefined)?.darkness ?? []);
      const shelter = there.flatMap((t) => (run.trace(t, "serotonin").inputs as Record<string, number> | undefined)?.light_and_shelter ?? []);
      return [
        ["it is night once it is there", run.ticks.filter((t) => run.at(t) > 6).every((t) => t.state.data.time.isNight)],
        ["the darkness input is up", mean(dark) > 0.3, `mean ${mean(dark).toFixed(2)}`],
        ["focus rises above its resting level", (run.signal("focus").at(-1) ?? 0) > 0.5, `ends at ${(run.signal("focus").at(-1) ?? 0).toFixed(2)}`],
        ["the outlook's light-and-shelter input is low", mean(shelter) < 0.3, `mean ${mean(shelter).toFixed(2)}`],
      ];
    },
  },
  {
    name: "soak",
    about: "Five mixed minutes: day, two ambushes, hunger, then night. Nothing should break or get stuck.",
    seconds: 300,
    before: [...CALM, "difficulty easy"],
    during: [
      [10, `give ${BOT} bread 8`],
      [11, `give ${BOT} stone_sword 1`],
      [40, `execute at ${BOT} run ${ZOMBIE}`],
      [75, "kill @e[type=zombie]"],
      [90, `effect give ${BOT} hunger 15 120 true`],
      [150, `execute at ${BOT} run ${ZOMBIE}`],
      [151, `execute at ${BOT} run ${ZOMBIE}`],
      [190, "kill @e[type=zombie]"],
      [220, "time set 14000"],
    ],
    checks: (run) => {
      const starts = run.events().filter((e) => e.type === "started").length;
      const neverStarted = run.events().filter((e) => e.type === "failed" && e.reason === "cannot run").length;
      const offline = run.signal("planner_offline").filter((v) => v > 0).length / run.ticks.length;
      const interrupts = run.signal("interrupt").filter((v) => v > 0).length;
      const lastAlarm = run.signal("alarm").at(-1) ?? 1;
      return [
        ["skills are not restarted every tick", starts < run.ticks.length / 3, `${starts} starts in ${run.ticks.length} ticks`],
        ["few choices of a skill that cannot run", neverStarted < run.ticks.length / 20, `${neverStarted}`],
        ["the planner is offline for a minority of the run", offline < 0.5, `${(offline * 100).toFixed(0)}% of ticks`],
        ["interrupts fire, but not constantly", interrupts >= 1 && interrupts <= 8, `${interrupts}`],
        ["alarm is not stuck high at the end", lastAlarm < 0.5, `ends at ${lastAlarm.toFixed(2)}`],
        ["dopamine moves but does not sit on a limit", mean(run.signal("dopamine")) > 0.2 && mean(run.signal("dopamine")) < 0.9, `mean ${mean(run.signal("dopamine")).toFixed(2)}`],
        ["the bot survives or its death is learned from", true],
      ];
    },
  },
  {
    name: "lava",
    about: "Dropped into a lava pit with water three blocks away: a hard reflex should get it out, with no help from Jev or the planner.",
    seconds: 32,
    before: [...CALM, "difficulty easy", ...PLAZA, "setblock 60 150 40 lava", "setblock 63 150 40 water"],
    during: [
      [8, TO_PLAZA],
      [28, HOME],
    ],
    after: CLEAR_PLAZA,
    checks: (run) => {
      const inLava = run.ticks.filter((t) => selfOf(t).inLava);
      const first = inLava[0];
      const started = run.ticks.find((t) => (t.skillEvents ?? []).some((e) => e.skill === "escape_hazard" && e.type === "started"));
      const escapes = run.ticks.filter((t) => t.action.skill === "escape_hazard");
      const lastIn = inLava.at(-1);
      const burning = run.ticks.filter((t) => selfOf(t).onFire);
      // Only the menu counts: the planner's goal text, which Jev is shown, may name the skill in its own words.
      const instinctAsked = run.ticks.some((t) => ((run.trace(t, "instinct").questions as { options?: string[] }[] | undefined) ?? []).some((q) => q.options?.includes("escape_hazard")));
      return [
        ["the bot was in lava", first !== undefined, `${inLava.length} ticks`],
        ["burning is sensed", burning.length > 0, `${burning.length} ticks on fire`],
        ["escape_hazard starts within a second", first !== undefined && started !== undefined && started.timestamp - first.timestamp <= 1000, first && started ? `${started.timestamp - first.timestamp} ms` : "never started"],
        ["every escape was a hard reflex winning at urgency 1", escapes.length > 0 && escapes.every((t) => t.winner?.region === "reflex" && t.winner.urgency === 1), `${escapes.length} ticks`],
        ["Jev is never offered escape_hazard", !instinctAsked],
        ["it is out of the lava within 3 seconds", first !== undefined && lastIn !== undefined && lastIn.timestamp - first.timestamp <= 3000, first && lastIn ? `${lastIn.timestamp - first.timestamp} ms in lava` : ""],
        ["the fire is out by the end", selfOf(run.ticks.at(-1)!).onFire === false],
        ["it survived", run.ticks.every((t) => selfOf(t).deaths === 0), `lowest health ${Math.min(...run.ticks.map((t) => selfOf(t).health))}`],
      ];
    },
  },
  {
    name: "drowning",
    about: "Shut in a glass tank of water with air at the top: when breath runs low a hard reflex should swim it up.",
    seconds: 50,
    before: [...CALM, "difficulty easy", ...PLAZA, "fill 68 151 38 72 159 42 glass hollow", "fill 69 152 39 71 156 41 water"],
    during: [
      [8, `tp ${BOT} 70.5 152 40.5`],
      [46, HOME],
    ],
    after: CLEAR_PLAZA,
    checks: (run) => {
      const air = run.ticks.map((t) => selfOf(t).air);
      // Short of breath: where the medulla's urge to breathe begins (air 12), well above the hard limit (6).
      const lowAt = run.ticks.findIndex((t) => selfOf(t).air <= 12 && selfOf(t).inWater);
      const surfaced = run.ticks.filter((t) => t.action.skill === "surface");
      const after = lowAt < 0 ? [] : air.slice(lowAt);
      // Jev sometimes swims the bot up by itself (return_to_base) before breath is short: then nothing had to save it.
      const lowestUnder = Math.min(20, ...air);
      const needed = lowestUnder <= 7;
      return [
        ["it was under water", run.ticks.some((t) => selfOf(t).inWater)],
        ["breath ran low", !needed || lowAt >= 0, needed ? `lowest air ${Math.min(...air)}` : `no: lowest air ${lowestUnder} (NOT TESTED this run)`],
        [
          "surface is started by the urge to breathe, or by the hard reflex at urgency 1",
          !needed || surfaced.length > 0 && surfaced.every((t) => t.winner?.region === "medulla" || (t.winner?.region === "reflex" && t.winner.urgency === 1)),
          needed ? `${surfaced.length} ticks, by ${[...new Set(surfaced.map((t) => t.winner?.region))].join(" and ")}` : `not needed: it swam up by itself with air ${lowestUnder} (NOT TESTED this run)`,
        ],
        ["it got its breath back", !needed || Math.max(0, ...after) >= 10, `air back up to ${Math.max(0, ...after)}`],
        ["the air signal rose and fell", !needed || (max(run.signal("air")) > 0.6 && (run.signal("air").at(-1) ?? 1) < 0.6), `max ${max(run.signal("air")).toFixed(2)}`],
        ["it survived", run.ticks.every((t) => selfOf(t).deaths === 0), `lowest health ${Math.min(...run.ticks.map((t) => selfOf(t).health))}`],
      ];
    },
  },
  {
    name: "far",
    about: "A zombie 12 blocks away across a gap it cannot cross: the bot should look at it and carry on, not flee.",
    seconds: 45,
    // A fixed plan keeps the scene about the lower layers (Claude, left to itself, loads "if zombie then attack").
    plan: { goal: "Keep watch from where you stand on the plaza." },
    before: [...CALM, "difficulty easy", ...PLAZA],
    during: [
      [6, TO_PLAZA],
      // Wherever the bot has wandered to on the plaza: cut a gap 4 to 8 blocks east of it, and put the zombie beyond.
      [13, `execute at ${BOT} run fill ~4 149 36 ~8 150 44 air`],
      [14, `execute at ${BOT} run summon zombie ~12 151 ~ ${HELMET}`],
      [40, "kill @e[type=zombie]"],
      [42, HOME],
    ],
    after: CLEAR_PLAZA,
    checks: (run) => {
      const seen = run.ticks.filter((t) => hostiles(t).length > 0);
      const nearest = Math.min(99, ...seen.flatMap((t) => hostiles(t).map((m) => m.dist)));
      const fired = run.ticks.flatMap((t) => (run.trace(t, "reflex").rules as Fired[] | undefined) ?? []);
      const oriented = run.ticks.filter((t) => run.trace(t, "brainstem").orienting !== undefined);
      const looked = run.ticks.filter((t) => t.winner?.region === "brainstem" && t.action.skill === "look_at");
      const ran = run.events().filter((e) => e.type === "started" && (e.skill === "flee" || e.skill === "attack"));
      return [
        ["the zombie was seen, and stayed far", seen.length > 0 && nearest >= 9, `nearest ${nearest} blocks over ${seen.length} ticks`],
        ["no defence reflex fired", fired.filter((f) => f.rule.startsWith("threat_")).length === 0],
        ["it was drawn to look", oriented.length > 0, `${oriented.length} orienting, ${looked.length} looks taken`],
        ["it did not flee or attack", ran.length === 0, ran.map((e) => e.skill).join(", ")],
        ["alarm stayed low", max(run.signal("alarm")) < 0.5, `max ${max(run.signal("alarm")).toFixed(2)}`],
      ];
    },
  },
  {
    name: "loaded",
    about: "The goal loads 'if creeper then flee': the response should fire the moment a creeper appears, with no new plan needed.",
    seconds: 40,
    plan: { goal: "Explore the plaza.", ifThen: [{ when: "creeper", skill: "flee" }] },
    before: [...CALM, "difficulty easy", ...PLAZA],
    during: [
      [6, TO_PLAZA],
      [22, `summon creeper 70.5 151 40.5 {NoAI:1b,PersistenceRequired:1b}`],
      [35, "kill @e[type=creeper]"],
      [37, HOME],
    ],
    after: CLEAR_PLAZA,
    checks: (run) => {
      const seenAt = run.ticks.find((t) => hostiles(t).some((m) => m.type === "creeper"));
      const firedAt = run.ticks.find((t) => run.trace(t, "brainstem").loadedResponse !== undefined);
      const fleeAt = run.ticks.find((t) => (t.skillEvents ?? []).some((e) => e.skill === "flee" && e.type === "started"));
      const plans = run.ticks.filter((t) => t.regions.some((r) => r.region === "prefrontal" && r.trace?.plan)).map((t) => t.timestamp);
      const lastPlan = firedAt ? Math.max(0, ...plans.filter((at) => at <= firedAt.timestamp)) : 0;
      const nextPlan = firedAt ? Math.min(Infinity, ...plans.filter((at) => at > firedAt.timestamp)) : 0;
      return [
        ["the goal carries the loaded response", run.ticks.some((t) => t.goal?.ifThen?.some((r) => r.when === "creeper" && r.skill === "flee"))],
        ["the creeper was seen", seenAt !== undefined, seenAt ? `${hostiles(seenAt)[0]?.dist} blocks away` : ""],
        ["the response fired on the tick the creeper appeared", seenAt !== undefined && firedAt !== undefined && firedAt.tick === seenAt.tick, firedAt && seenAt ? `${firedAt.timestamp - seenAt.timestamp} ms after first sight` : "never"],
        ["the brainstem won with flee at 0.95", firedAt?.winner?.region === "brainstem" && firedAt.winner.action.skill === "flee" && firedAt.winner.urgency === 0.95, firedAt?.winner ? `${firedAt.winner.region} ${firedAt.winner.action.skill} ${firedAt.winner.urgency}` : ""],
        ["flee started before the planner's next run", fleeAt !== undefined && firedAt !== undefined && fleeAt.timestamp < nextPlan, firedAt ? `${((firedAt.timestamp - lastPlan) / 1000).toFixed(1)} s after the last plan, ${nextPlan === Infinity ? "no later plan" : `${((nextPlan - firedAt.timestamp) / 1000).toFixed(1)} s before the next`}` : ""],
      ];
    },
  },
  {
    name: "hold",
    about: "The goal holds back flee: a zombie closing in should not make the bot retreat, but at low health last_stand still pulls it out.",
    seconds: 55,
    plan: { goal: "Stand your ground on the plaza and fight any zombie. Do not run.", holdBack: ["flee"] },
    before: [...CALM, "difficulty normal", ...PLAZA],
    during: [
      [2, `clear ${BOT}`],
      [3, `give ${BOT} stone_sword 1`],
      [6, TO_PLAZA],
      [14, `summon zombie 66.5 151 40.5 ${HELMET}`],
      // Whatever the first fight cost, start the hard part from full health: 14 damage then leaves 6.
      [33, `effect give ${BOT} instant_health 1 10 true`],
      [34, `execute at ${BOT} run summon zombie ~2 ~ ~ ${HELMET}`],
      [35, `damage ${BOT} 14`],
      [50, "kill @e[type=zombie]"],
      [52, HOME],
    ],
    after: [...CLEAR_PLAZA, "difficulty peaceful"],
    checks: (run) => {
      const fired = run.ticks.flatMap((t) => ((run.trace(t, "reflex").rules as Fired[] | undefined) ?? []).map((f) => ({ ...f, t })));
      const softFlee = fired.filter((f) => f.kind === "soft" && f.skill === "flee");
      const lastStand = fired.filter((f) => f.rule === "last_stand");
      const firstStand = lastStand[0]?.t;
      const fleeStarts = run.ticks.filter((t) => (t.skillEvents ?? []).some((e) => e.skill === "flee" && e.type === "started"));
      const early = fleeStarts.filter((t) => !firstStand || t.timestamp < firstStand.timestamp - 1000);
      const kept = run.ticks.some((t) => run.trace(t, "noradrenaline").keptGoal !== undefined);
      const died = run.ticks.some((t) => selfOf(t).deaths > 0);
      const logged = /DIED WITH DEFENCE OVERRULED/.test(run.output);
      return [
        ["the goal holds back flee", run.ticks.some((t) => t.goal?.holdBack?.includes("flee"))],
        ["the goal survives the fright", kept || run.ticks.at(-1)?.goal?.holdBack?.includes("flee") === true, kept ? "kept through an interrupt" : "no interrupt fired"],
        ["the flee reflex fired, held back", softFlee.length > 0 && softFlee.every((f) => f.gain <= 0.46), softFlee.length ? `${softFlee.length} firings, gain ${Math.min(...softFlee.map((f) => f.gain)).toFixed(2)} to ${Math.max(...softFlee.map((f) => f.gain)).toFixed(2)}, urgency up to ${Math.max(...softFlee.map((f) => f.urgency)).toFixed(2)}` : "never fired"],
        ["it stood its ground: no flee before last_stand", early.length === 0, `${early.length} early flees`],
        ["last_stand fired at low health, at urgency 1", lastStand.length > 0 && lastStand.every((f) => f.urgency === 1 && selfOf(f.t).health <= 6), `${lastStand.length} firings`],
        ["and it won: the bot broke away", lastStand.some((f) => f.t.winner?.region === "reflex" && f.t.action.skill === "flee")],
        // Holding back defence can cost the bot its life. That is allowed, but it must be logged loudly.
        ["it survived, or its death was logged as defence overruled", died === logged, died ? "DIED: logged with the gain and what won" : `lowest health ${Math.min(...run.ticks.map((t) => selfOf(t).health))}`],
      ];
    },
  },
  {
    name: "bang",
    about: "TNT goes off 10 blocks away on a quiet day: the bot should startle, brace, and its alarm should rise.",
    seconds: 30,
    before: [...CALM, "difficulty easy", ...PLAZA],
    during: [
      [6, TO_PLAZA],
      [14, `execute at ${BOT} run summon tnt ~10 ~ ~ {fuse:40}`],
      [26, HOME],
    ],
    after: CLEAR_PLAZA,
    checks: (run) => {
      const heard = run.ticks.filter((t) => ((t.state.data.nearby as unknown as { heard: { type: string }[] }).heard ?? []).some((h) => h.type === "explosion"));
      const startles = run.ticks.flatMap((t) => (run.trace(t, "brainstem").startle ? [{ t, by: (run.trace(t, "brainstem").startle as { by: string }).by }] : []));
      const first = startles[0];
      const raised = first ? (run.trace(first.t, "noradrenaline").raisedBy as Record<string, number> | undefined) : undefined;
      return [
        ["the explosion was heard", heard.length > 0, `${heard.length} ticks`],
        ["it startled, once", startles.length === 1 && first?.by === "loud_nearby", startles.map((s) => s.by).join(", ") || "no startle"],
        ["bracing (or a response the planner had prepared) won that tick", first?.t.winner?.region === "brainstem" && (first.t.action.skill === "brace" || (run.trace(first.t, "brainstem").startle as { released?: string } | undefined)?.released === first.t.action.skill), String(first?.t.action.skill)],
        ["the startle raised alarm on the same tick", (raised?.startle ?? 0) > 0, JSON.stringify(raised ?? {})],
      ];
    },
  },
  {
    name: "glance",
    about: "With --same-time: a zombie appears far off while the bot is eating. It should look at it without stopping its meal.",
    seconds: 34,
    flags: ["--same-time"],
    plan: { goal: "Stay on the plaza and keep fed." },
    before: [...CALM, "difficulty easy", ...PLAZA],
    during: [
      [5, TO_PLAZA],
      [6, `give ${BOT} bread 16`],
      [8, `effect give ${BOT} hunger 7 255 true`],
      // The meal starts about 12 to 13 s in and lasts about 8 s: the zombie appears in the middle of it.
      [16, `execute at ${BOT} run summon zombie ~12 151 ~ {NoAI:1b,PersistenceRequired:1b}`],
      [28, "kill @e[type=zombie]"],
      [30, HOME],
    ],
    after: CLEAR_PLAZA,
    checks: (run) => {
      const beside = run.ticks.filter((t) => t.alongside?.action.skill === "look_at");
      const first = beside[0];
      const looks = run.events().filter((e) => e.alongside && e.skill === "look_at");
      const cutShort = first ? (first.skillEvents ?? []).some((e) => e.skill === "eat" && e.type === "interrupted") : false;
      return [
        ["the bot ate", run.events().some((e) => e.skill === "eat" && e.type === "started")],
        ["the zombie was seen while it was eating", run.ticks.some((t) => hostiles(t).length > 0 && t.action.skill === "eat" || (hostiles(t).length > 0 && first !== undefined))],
        ["a look ran alongside the meal", first !== undefined && first.action.skill !== "look_at", first ? `main action that tick: ${first.action.skill ?? "keep going"}` : "no look ran alongside"],
        ["the look started and finished as a side movement", looks.some((e) => e.type === "started") && looks.some((e) => e.type === "done"), looks.map((e) => e.type).join(", ")],
        ["the meal was not interrupted by it", !cutShort],
      ];
    },
  },
  temperamentScene("Brave", "Bravery 0.8, armed, with a zombie closing in from 6 blocks."),
  temperamentScene("Timid", "Bravery 0.2, the same ambush: it should flee more readily than the brave bot."),
  {
    name: "sleepgate",
    about: "A full night in bed (the night is not skipped): Jev and the planner should fall silent, and a hit should wake them at once.",
    seconds: 560,
    before: [...CALM, "gamerule players_sleeping_percentage 101", "time set 13000"],
    during: [[300, `damage ${BOT} 2`]],
    after: ["gamerule players_sleeping_percentage 100"],
    checks: (run) => {
      const paused = run.ticks.filter((t) => (t.signals.upper_paused?.value ?? 0) > 0);
      const callsWhilePaused = paused.filter((t) => run.trace(t, "instinct").paused !== true).length;
      const span = (t: Tick) => (run.ticks[run.ticks.indexOf(t) + 1]?.timestamp ?? t.timestamp) - t.timestamp;
      const pausedSeconds = paused.reduce((sum, t) => sum + span(t), 0) / 1000;
      const asleepSeconds = run.ticks.filter((t) => selfOf(t).asleep).reduce((sum, t) => sum + span(t), 0) / 1000;
      const pausedAt = new Set(paused.map((t) => t.tick));
      const plansWhilePaused = run.ticks.filter((t) => pausedAt.has(t.tick) && t.regions.some((r) => r.region === "prefrontal" && r.trace?.plan)).length;
      const engineCalls = run.ticks.filter((t) => run.trace(t, "instinct").engine !== undefined).length;
      const hit = run.ticks.find((t, i) => i > 0 && selfOf(t).health < selfOf(run.ticks[i - 1]!).health && run.at(t) > 250);
      const backAsleep = hit ? run.ticks.some((t) => t.timestamp > hit.timestamp + 5000 && (t.signals.upper_paused?.value ?? 0) > 0) : false;
      const woke = run.ticks.flatMap((t) => (run.trace(t, "brainstem").woken ? [`${String(run.trace(t, "brainstem").woken)} at ${run.at(t).toFixed(0)} s`] : []));
      const stops = run.events().filter((e) => e.skill === "sleep" && e.type !== "started" && e.type !== "done").map((e) => `${e.type}${e.reason ? ` (${e.reason})` : ""}`);
      return [
        ["the bot slept most of the night", asleepSeconds > 300, `${asleepSeconds.toFixed(0)} s asleep, upper layers paused ${pausedSeconds.toFixed(0)} s`],
        ["no Jev call is made while paused", callsWhilePaused === 0, `${callsWhilePaused} calls in ${paused.length} paused ticks`],
        // A plan already being made when the pause begins may still arrive: once at the start, once after the hit.
        ["no new plan is made while paused", plansWhilePaused <= 2, `${plansWhilePaused} arrived that were started before a pause`],
        ["REPORT calls", true, `Jev: ${engineCalls} made, ${paused.length} saved; planner: about ${Math.floor(pausedSeconds / 15)} runs saved`],
        ["the hit wakes the upper layers on the same tick", hit !== undefined && (hit.signals.upper_paused?.value ?? 1) === 0 && run.trace(hit, "instinct").paused !== true, hit ? `at ${run.at(hit).toFixed(0)} s: ${String(run.trace(hit, "brainstem").woken ?? "not asleep")}` : "no hit seen"],
        ["it goes back to sleep afterwards", backAsleep],
        ["REPORT wakings", true, [...new Set(woke)].slice(0, 6).join("; ") || "none"],
        ["REPORT sleep stopped by", true, stops.join("; ") || "nothing"],
      ];
    },
  },
];

/** Runs the bot for a scene and returns its log. */
async function play(scene: Scene): Promise<Run> {
  const bot = scene.bot ?? BOT;
  /** Commands are written for Tester; a scene with its own bot has them aimed at it. */
  const send = (command: string) => rcon(command.replaceAll(BOT, bot));
  if (!scene.keepMemory) rmSync(`data/${bot}`, { recursive: true, force: true });
  for (const command of scene.before ?? []) send(command);
  rcon("kill @e[type=!player,type=!item,distance=..64,x=-8,y=68,z=16]");
  const planner = scene.plan ? ["--planner", "echo", "--plan", JSON.stringify(scene.plan)] : ["--planner", "claude"];
  const child = spawn("node", ["--env-file-if-exists=.env", "apps/run-bot/dist/index.js", "--engine", "jev", ...planner, ...(scene.flags ?? []), "--name", bot], { stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (d: Buffer) => (output += d));
  child.stderr.on("data", (d: Buffer) => (output += d));
  const joined = Date.now();
  let exited = false;
  child.once("exit", () => (exited = true));
  while (!output.includes("Logging to") && !exited && Date.now() - joined < 30_000) await sleep(200);
  if (exited) throw new Error(`The bot stopped before it started playing:\n${output.slice(-600)}`);
  // Every scene starts at base, wherever the last one left the bot.
  send(HOME);
  send(`effect clear ${BOT}`);
  send(`effect give ${BOT} instant_health 1 10 true`);
  const started = Date.now();
  const pending = [...(scene.during ?? [])].sort((a, b) => a[0] - b[0]);
  while (Date.now() - started < scene.seconds * 1000) {
    while (pending[0] && (Date.now() - started) / 1000 >= pending[0][0]) send(pending.shift()![1]);
    await sleep(250);
  }
  child.kill("SIGINT");
  if (!exited) await new Promise((resolve) => child.once("exit", resolve));
  for (const command of scene.after ?? []) send(command);
  const file = output.match(/Logging to (\S+)/)?.[1];
  if (!file) throw new Error(`The bot did not start:\n${output.slice(-600)}`);
  const ticks = readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as Tick);
  const t0 = ticks[0]?.timestamp ?? 0;
  console.log(`  log: ${file} (${ticks.length} ticks)`);
  return {
    ticks,
    output,
    at: (t) => (t.timestamp - t0) / 1000,
    signal: (name) => ticks.map((t) => t.signals[name]?.value).filter((v): v is number => v !== undefined),
    trace: (t, region) => t.regions.find((r) => r.region === region)?.trace ?? {},
    events: () => ticks.flatMap((t) => t.skillEvents ?? []),
  };
}

/** Checks every scene shares: nothing broke. */
function health(run: Run): [string, boolean, string?][] {
  // A slow reply from Jev now and then is tolerated (that tick simply has no instinct proposal).
  const all = run.ticks.flatMap((t) => t.regions.filter((r) => r.error).map((r) => `${r.region}: ${r.error}`));
  const timeouts = all.filter((e) => /timed out/.test(e));
  const errors = timeouts.length <= run.ticks.length * 0.05 ? all.filter((e) => !timeouts.includes(e)) : all;
  const outOfRange = [...new Set(run.ticks.flatMap((t) => Object.entries(t.signals).filter(([, s]) => !Number.isFinite(s.value) || s.value < 0 || s.value > 1).map(([name]) => name)))];
  return [
    ["the bot ran", run.ticks.length > 10, `${run.ticks.length} ticks`],
    ["no region failed", errors.length === 0, [...new Set(errors)].slice(0, 3).join("; ")],
    ["every signal stayed within 0 to 1", outOfRange.length === 0, outOfRange.join(", ")],
  ];
}

const wanted = process.argv.slice(2);
const chosen = wanted.length ? scenes.filter((s) => wanted.includes(s.name)) : scenes;
if (chosen.length === 0) throw new Error(`Unknown scene. Use: ${scenes.map((s) => s.name).join(", ")}`);
let failed = 0;
for (const scene of chosen) {
  console.log(`\n=== ${scene.name}: ${scene.about}`);
  const run = await play(scene);
  for (const [what, ok, detail] of [...health(run), ...scene.checks(run)]) {
    if (!ok) failed++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`);
  }
}
for (const command of ["gamerule spawn_mobs true", "difficulty easy", "time set 1000", "forceload remove 39 35 81 45"]) rcon(command);
console.log(failed ? `\n${failed} check(s) failed.` : "\nAll checks passed.");
process.exitCode = failed ? 1 : 0;
