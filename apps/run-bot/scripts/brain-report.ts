// Summarises a run's tick log for checking the brain: each dial's range, what moved it, rewards,
// surprises, reflexes and the brainstem, the medulla, balance and posture, the colliculus, memories, interrupts, warnings and region errors.
// Usage: pnpm brain-report [logs/player-....jsonl]   (default: the newest player log)
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

interface RegionLog {
  region: string;
  proposals: { action: { skill?: string; target?: string }; urgency: number; reason: string }[];
  trace?: Record<string, unknown>;
  error?: string;
}
interface Tick {
  tick: number;
  timestamp: number;
  regions: RegionLog[];
  winner: { region: string; reason: string; action: { skill?: string } } | null;
  action: { skill?: string; target?: string; keepGoing?: boolean };
  goal: { text: string; setBy: string; stepsDone: number; steps: string[]; wants: unknown[]; watchFor: string[] } | null;
  signals: Record<string, { value: number }>;
  skillEvents?: { skill: string; type: string; reason?: string; target?: string; alongside?: boolean; changes?: Record<string, unknown> }[];
  alongside?: { region: string; action: { skill?: string } };
}

const file = process.argv[2] ?? newestLog();
const ticks: Tick[] = readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as Tick);
if (ticks.length === 0) throw new Error(`${file} has no ticks`);
const seconds = (ticks.at(-1)!.timestamp - ticks[0]!.timestamp) / 1000;
console.log(`${file}\n${ticks.length} ticks over ${seconds.toFixed(0)} s (${(ticks.length / Math.max(1, seconds)).toFixed(1)} ticks/s)\n`);

function newestLog(): string {
  const logs = readdirSync("logs").filter((f) => f.startsWith("player-")).sort();
  if (logs.length === 0) throw new Error("No player logs in logs/");
  return join("logs", logs.at(-1)!);
}

const trace = (t: Tick, region: string) => t.regions.find((r) => r.region === region)?.trace ?? {};
const count = <T>(items: T[], key: (item: T) => string) => {
  const out = new Map<string, number>();
  for (const item of items) out.set(key(item), (out.get(key(item)) ?? 0) + 1);
  return [...out].sort((a, b) => b[1] - a[1]);
};
const list = (pairs: [string, number][], limit = 12) => pairs.slice(0, limit).map(([k, n]) => `${k} ×${n}`).join(", ") || "none";

// Dials: range, and anything out of bounds or not a number.
console.log("SIGNALS            min    mean   max    last");
const names = [...new Set(ticks.flatMap((t) => Object.keys(t.signals)))];
const bad: string[] = [];
for (const name of names) {
  const values = ticks.map((t) => t.signals[name]?.value).filter((v): v is number => v !== undefined);
  if (values.some((v) => !Number.isFinite(v) || v < 0 || v > 1)) bad.push(name);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  console.log(`${name.padEnd(18)} ${Math.min(...values).toFixed(2).padStart(5)}  ${mean.toFixed(2).padStart(5)}  ${Math.max(...values).toFixed(2).padStart(5)}  ${values.at(-1)!.toFixed(2).padStart(5)}`);
}
console.log(bad.length ? `!! out of range or not a number: ${bad.join(", ")}` : "all signals within 0 to 1");

// Region health.
const errors = ticks.flatMap((t) => t.regions.filter((r) => r.error).map((r) => `${r.region}: ${r.error}`));
console.log(`\nREGION ERRORS: ${list(count(errors, (e) => e))}`);
const ruleErrors = ticks.flatMap((t) => t.regions.flatMap((r) => Object.entries((r.trace?.errors as Record<string, string> | undefined) ?? {}).map(([k, v]) => `${r.region}/${k}: ${v}`)));
console.log(`RULE/TRIGGER ERRORS: ${list(count(ruleErrors, (e) => e))}`);

// Behaviour.
console.log(`\nWINNERS BY REGION: ${list(count(ticks.filter((t) => t.winner), (t) => t.winner!.region))}`);
const events = ticks.flatMap((t) => t.skillEvents ?? []);
console.log(`SKILL EVENTS: ${list(count(events, (e) => `${e.skill} ${e.type}${e.type === "failed" && e.reason ? ` (${e.reason})` : ""}`), 20)}`);

// What skills changed (primitives and learned skills report it), and what ran alongside the main skill.
const reported = events.filter((e) => e.changes);
const kinds = reported.flatMap((e) => Object.keys(e.changes!).filter((k) => k !== "asExpected" && k !== "steps"));
const surprises = reported.filter((e) => e.type === "done" && e.changes!.asExpected === false);
console.log(`CHANGES REPORTED: ${reported.length} runs; ${list(count(kinds, (k) => k))}`);
console.log(`NOT AS EXPECTED: ${list(count(surprises, (e) => e.skill))}`);
console.log(`RAN ALONGSIDE: ${list(count(events.filter((e) => e.alongside && e.type === "started"), (e) => e.skill))}`);

// Protective reflexes: withdrawals carry their report on the skill event; pushes are in each tick's state.
type Withdrew = { skill: string; type: string; reason?: string; changes: { cause: string; hurtAt: string; hurtToStartMs: number; radius: number; learned?: string; to?: string } };
const withdrawals = events.filter((e) => e.skill === "withdraw" && e.type !== "started" && e.changes?.cause !== undefined) as unknown as Withdrew[];
const middle = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
console.log(`\nWITHDRAWALS: ${withdrawals.length}; by cause: ${list(count(withdrawals, (w) => w.changes.cause))}; stayed put (nowhere safe): ${withdrawals.filter((w) => w.reason?.startsWith("nowhere safe")).length}`);
const delays = withdrawals.map((w) => w.changes.hurtToStartMs);
console.log(`HURT TO WITHDRAWAL STARTING: ${delays.length ? `median ${middle(delays)} ms, slowest ${Math.max(...delays)} ms, over 250 ms: ${delays.filter((d) => d > 250).length} of ${delays.length}` : "none"}`);
const lessons = ticks.flatMap((t) => (t.skillEvents ?? []).filter((e) => e.skill === "withdraw" && e.changes?.learned).map((e) => `${String(e.changes!.learned)} (${((t.timestamp - ticks[0]!.timestamp) / 1000).toFixed(0)} s in)`));
console.log(`LEARNED TO HURT: ${lessons.join(", ") || "nothing"}`);
type Body = { pushed: { danger: unknown } | null; deaths: number };
const bodyOf = (t: Tick) => (t as Tick & { state?: { data?: { self?: Body } } }).state?.data?.self ?? null;
const reflexWins = (rule: string) => ticks.filter((t) => t.winner?.region === "reflex" && ((trace(t, "reflex").rules as { rule: string }[] | undefined) ?? []).some((r) => r.rule === rule) && ["steady", "recoil", "dig_out"].includes(t.winner.action.skill ?? "")).length;
const pushes = ticks.filter((t) => bodyOf(t)?.pushed);
console.log(`PUSHES: ${pushes.length} ticks pushed (${pushes.filter((t) => bodyOf(t)!.pushed!.danger).length} toward danger); held (hold_ground won): ${reflexWins("hold_ground")}; edge stops (edge_guard won): ${reflexWins("edge_guard")}; about-to-touch stops: ${reflexWins("about_to_touch")}; dug out: ${events.filter((e) => e.skill === "dig_out" && e.type === "done").length}`);
const died = ticks.filter((t, i) => i > 0 && (bodyOf(t)?.deaths ?? 0) > (bodyOf(ticks[i - 1]!)?.deaths ?? 0));
const afterWithdrawal = died.filter((d) => ticks.some((t) => d.timestamp - t.timestamp >= 0 && d.timestamp - t.timestamp <= 5000 && (t.skillEvents ?? []).some((e) => e.skill === "withdraw")));
console.log(`DEATHS WITHIN 5 s OF A WITHDRAWAL: ${afterWithdrawal.length} of ${died.length} deaths; sore signal max ${Math.max(0, ...ticks.map((t) => t.signals.sore?.value ?? 0)).toFixed(2)}`);

// Locomotion: every journey's report rides on its skill event; the pattern and gait are in each tick's state.
type Journey = { skill: string; type: string; reason?: string; changes: { distance: number; seconds: number; patternSwitches: number; recoveries: number; recovered?: string; late: boolean } };
const journeys = events.filter((e) => typeof e.changes?.distance === "number" && e.changes.patternSwitches !== undefined) as unknown as Journey[];
const share = (n: number, of: number) => (of ? `${Math.round((100 * n) / of)}%` : "n/a");
const finished = journeys.filter((j) => j.type === "done").length;
console.log(`\nJOURNEYS: ${journeys.length}; finished ${finished} (${share(finished, journeys.length)}); late ${journeys.filter((j) => j.changes.late).length}; ${journeys.reduce((sum, j) => sum + j.changes.distance, 0).toFixed(0)} blocks in ${journeys.reduce((sum, j) => sum + j.changes.seconds, 0).toFixed(0)} s; pattern switches ${journeys.reduce((sum, j) => sum + j.changes.patternSwitches, 0)}`);
const stumbles = journeys.filter((j) => j.changes.recoveries > 0);
console.log(`STUCK EVENTS: ${stumbles.length}${stumbles.length ? `: ${list(count(stumbles, (j) => `${j.skill} tried ${j.changes.recovered} → ${j.type}${j.type === "failed" && j.reason ? ` (${j.reason.replace(/ at .*/, "")})` : ""}`), 6)}` : ""}`);
type Legs = { moving: boolean; pattern: string | null; gait: string; stuck: boolean };
const legsOf = (t: Tick) => ((t as Tick & { state?: { data?: { self?: { locomotion?: Legs } } } }).state?.data?.self?.locomotion ?? null);
const travelling = ticks.map((t, i) => ({ legs: legsOf(t), ms: (ticks[i + 1]?.timestamp ?? t.timestamp) - t.timestamp })).filter((x) => x.legs?.moving);
const timeIn = (key: (legs: Legs) => string) => {
  const totals = new Map<string, number>();
  for (const { legs, ms } of travelling) totals.set(key(legs!), (totals.get(key(legs!)) ?? 0) + ms);
  return [...totals].sort((a, b) => b[1] - a[1]).map(([name, ms]) => `${name} ${(ms / 1000).toFixed(0)} s`).join(", ") || "none";
};
console.log(`TIME TRAVELLING: by pattern: ${timeIn((l) => l.pattern ?? "none")}; by gait: ${timeIn((l) => l.gait)}; stuck signal max ${Math.max(0, ...ticks.map((t) => t.signals.stuck?.value ?? 0)).toFixed(2)}`);

// Dopamine.
type Reward = { rule: string; amount: number; raw?: number };
const rewards = ticks.flatMap((t) => (trace(t, "dopamine").rewards as Reward[] | undefined) ?? []);
const byRule = new Map<string, { n: number; total: number }>();
for (const r of rewards) byRule.set(r.rule, { n: (byRule.get(r.rule)?.n ?? 0) + 1, total: (byRule.get(r.rule)?.total ?? 0) + r.amount });
console.log(`\nREWARDS: ${[...byRule].map(([rule, { n, total }]) => `${rule} ×${n} (${total >= 0 ? "+" : ""}${total.toFixed(2)})`).join(", ") || "none"}`);
type Episode = { skill: string; situation: string; outcome: number; surprise: number; ended: string; toward?: string };
const episodes = ticks.flatMap((t) => (trace(t, "dopamine").episodes as Episode[] | undefined) ?? []);
console.log(`EPISODES: ${episodes.length}; biggest surprises: ${[...episodes].sort((a, b) => Math.abs(b.surprise) - Math.abs(a.surprise)).slice(0, 5).map((e) => `${e.skill} ${e.surprise.toFixed(2)}`).join(", ") || "none"}`);
console.log(`SITUATIONS: ${list(count(ticks, (t) => String(trace(t, "dopamine").situation ?? "?")), 6)}`);
const cues = ticks.flatMap((t) => (trace(t, "dopamine").cues as { thing: { kind: string } }[] | undefined) ?? []);
console.log(`WANTING CUES: ${list(count(cues, (c) => c.thing.kind))}`);

// Serotonin.
const inputs = (region: string, key: string) => {
  const sums = new Map<string, number[]>();
  for (const t of ticks) for (const [k, v] of Object.entries((trace(t, region)[key] as Record<string, number> | undefined) ?? {})) sums.set(k, [...(sums.get(k) ?? []), v]);
  return [...sums].map(([k, v]) => `${k} ${(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2)}`).join(", ") || "none";
};
console.log(`\nOUTLOOK INPUTS (mean): ${inputs("serotonin", "inputs")}`);
const gaveUp = events.filter((e) => e.reason?.startsWith("gave up"));
console.log(`GAVE UP: ${gaveUp.length}${gaveUp[0] ? ` e.g. ${gaveUp[0].skill}: ${gaveUp[0].reason}` : ""}`);

// Noradrenaline.
const raised = ticks.flatMap((t) => Object.keys((trace(t, "noradrenaline").raisedBy as Record<string, number> | undefined) ?? {}));
console.log(`\nALARM RAISED BY: ${list(count(raised, (r) => r))}`);
console.log(`SEARCH INPUTS (mean): ${inputs("noradrenaline", "searchInputs")}`);
const flags = (region: string, keys: string[]) => keys.map((k) => `${k} ×${ticks.filter((t) => trace(t, region)[k] !== undefined).length}`).join(", ");
console.log(`NORADRENALINE: ${flags("noradrenaline", ["interrupt", "plannerOffline", "panicLock", "jumpy", "rethink", "goalHopping"])}`);

// Acetylcholine.
console.log(`\nFOCUS INPUTS (mean): ${inputs("acetylcholine", "inputs")}`);
type Lookup = { what: string; used: boolean };
const lookups = ticks.flatMap((t) => (trace(t, "acetylcholine").remembered as Lookup[] | undefined) ?? []);
console.log(`REMEMBERED VALUES: used ${lookups.filter((l) => l.used).length}, rejected ${lookups.filter((l) => !l.used).length}`);
console.log(`ACETYLCHOLINE: ${flags("acetylcholine", ["cue", "asleep", "warning", "attention"])}`);

// Spinal cord and brainstem.
type Fired = { rule: string; kind: "hard" | "soft"; skill: string | null; base: number; gain: number; urgency: number };
const fired = ticks.flatMap((t) => (trace(t, "reflex").rules as Fired[] | undefined) ?? []);
const soft = fired.filter((f) => f.kind === "soft");
const meanOf = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
console.log(`\nREFLEXES FIRED: hard ${list(count(fired.filter((f) => f.kind === "hard"), (f) => f.rule))}; soft ${list(count(soft, (f) => f.rule))}`);
console.log(
  `SOFT REFLEX GAIN: ${soft.length ? `mean ${meanOf(soft.map((f) => f.gain)).toFixed(2)}, range ${Math.min(...soft.map((f) => f.gain)).toFixed(2)} to ${Math.max(...soft.map((f) => f.gain)).toFixed(2)}, mean urgency ${meanOf(soft.map((f) => f.urgency)).toFixed(2)}` : "no soft reflex fired"}`,
);
const stem = (key: string) => ticks.filter((t) => trace(t, "brainstem")[key] !== undefined);
console.log(`STARTLES: ${list(count(stem("startle"), (t) => (trace(t, "brainstem").startle as { by: string }).by))}`);
console.log(`LOADED RESPONSES FIRED: ${list(count(stem("loadedResponse"), (t) => { const r = trace(t, "brainstem").loadedResponse as { when: string; skill: string }; return `${r.when} → ${r.skill}`; }))}; dropped: ${stem("droppedResponses").length}; hold-backs ignored: ${stem("ignoredHoldBack").length}`);
console.log(`ORIENTING: ${stem("orienting").length} times, ${ticks.filter((t) => t.winner?.region === "brainstem" && t.winner.action.skill === "look_at").length} looks taken`);
// Time is counted from each tick to the next.
const span = (t: Tick, i: number) => (ticks[i + 1]?.timestamp ?? t.timestamp) - t.timestamp;
const asleepMs = ticks.reduce((sum, t, i) => sum + ((t.signals.arousal?.value ?? 1) < 0.1 ? span(t, i) : 0), 0);
const pausedTicks = ticks.filter((t) => (t.signals.upper_paused?.value ?? 0) > 0);
const pausedMs = ticks.reduce((sum, t, i) => sum + ((t.signals.upper_paused?.value ?? 0) > 0 ? span(t, i) : 0), 0);
const engineCalls = ticks.filter((t) => trace(t, "instinct").engine !== undefined || t.regions.some((r) => r.region === "instinct" && r.error)).length;
const engineSaved = ticks.filter((t) => trace(t, "instinct").paused === true).length;
const callsWhilePaused = pausedTicks.filter((t) => trace(t, "instinct").paused !== true).length;
const PLAN_EVERY_MS = 15_000;
console.log(`ASLEEP: ${(asleepMs / 1000).toFixed(0)} s; upper layers paused ${(pausedMs / 1000).toFixed(0)} s (${pausedTicks.length} ticks)`);
console.log(`ENGINE CALLS: ${engineCalls} made, ${engineSaved} saved by the pause (${callsWhilePaused} made while paused); planner runs saved: about ${Math.floor(pausedMs / PLAN_EVERY_MS)}`);
const woken = count(stem("woken"), (t) => String(trace(t, "brainstem").woken));
console.log(`WOKEN BY: ${list(woken)}`);
const overruled = ticks.filter((t) => (t as Tick & { defenceOverruledBeforeDeath?: unknown }).defenceOverruledBeforeDeath);
for (const t of overruled) console.log(`!! DIED WITH DEFENCE OVERRULED at tick ${t.tick}: ${JSON.stringify((t as Tick & { defenceOverruledBeforeDeath?: unknown }).defenceOverruledBeforeDeath)}`);

// The medulla: body upkeep.
type Signs = Record<string, number>;
type Upkeep = { food?: number; health?: number; air?: number; healing?: boolean };
const upkeepOf = (t: Tick) => bodyOf(t) as (Upkeep & Body) | null;
const lowest = (key: "air" | "food" | "health") => Math.min(20, ...ticks.map((t) => upkeepOf(t)?.[key] ?? 20));
const HEALING_FOOD = 18;
const hurtUnfedMs = ticks.reduce((sum, t, i) => { const b = upkeepOf(t); return sum + (b && (b.health ?? 20) < 20 && (b.food ?? 20) < HEALING_FOOD ? span(t, i) : 0); }, 0);
const hurtMs = ticks.reduce((sum, t, i) => sum + ((upkeepOf(t)?.health ?? 20) < 20 ? span(t, i) : 0), 0);
console.log(`\nMEDULLA: lowest air ${lowest("air")}/20, lowest food ${lowest("food")}/20, lowest health ${lowest("health").toFixed(1)}/20; lowest overall vitals ${Math.min(1, ...ticks.map((t) => t.signals.vitals?.value ?? 1)).toFixed(2)}`);
console.log(`HURT AND TOO HUNGRY TO HEAL (food under ${HEALING_FOOD}): ${(hurtUnfedMs / 1000).toFixed(0)} s of ${(hurtMs / 1000).toFixed(0)} s hurt`);
const urgeTicks = ticks.flatMap((t) => ((trace(t, "medulla").urges as Fired[] | undefined) ?? []).map((u) => ({ u, won: t.winner?.region === "medulla" && t.winner.action.skill === u.skill })));
const UPKEEP_REFLEXES = ["drowning", "eat_when_starving"];
const hardUpkeep = ticks.flatMap((t) => ((trace(t, "reflex").rules as Fired[] | undefined) ?? []).filter((f) => UPKEEP_REFLEXES.includes(f.rule)).map((u) => ({ u, won: t.winner?.region === "reflex" && t.winner.action.skill === u.skill })));
for (const rule of [...new Set([...urgeTicks, ...hardUpkeep].map((x) => x.u.rule))]) {
  const of = [...urgeTicks, ...hardUpkeep].filter((x) => x.u.rule === rule);
  const held = of.filter((x) => x.u.kind === "soft" && x.u.gain < 1).length;
  console.log(`  ${rule} (${of[0]!.u.kind}): fired ${of.length} ticks, won ${of.filter((x) => x.won).length}, outvoted ${of.filter((x) => !x.won).length}, held back by a goal ${held}; urgency ${Math.min(...of.map((x) => x.u.urgency)).toFixed(2)} to ${Math.max(...of.map((x) => x.u.urgency)).toFixed(2)}`);
}
if (urgeTicks.length + hardUpkeep.length === 0) console.log("  no upkeep reflex or urge fired");
console.log(`URGES WHILE ASLEEP: ${list(count(ticks.flatMap((t) => (trace(t, "medulla").urgeWhileAsleep as string[] | undefined) ?? []), (r) => r))}`);
const badFoodLessons = ticks.flatMap((t) => ((trace(t, "hippocampus").recorded as { trigger: string; summary: string }[] | undefined) ?? []).filter((r) => r.trigger === "learned_bad_food").map((r) => r.summary));
console.log(`FOODS LEARNED AS BAD: ${badFoodLessons.join("; ") || "none"}`);
for (const d of died) {
  const lastTen = ticks.filter((t) => d.timestamp - t.timestamp > 0 && d.timestamp - t.timestamp <= 10_000).map((t) => trace(t, "medulla").vitals as Signs | undefined).filter((v): v is Signs => v !== undefined);
  const worst = (key: string, low = false) => (lastTen.length ? (low ? Math.min : Math.max)(...lastTen.map((v) => v[key] ?? (low ? 1 : 0))).toFixed(2) : "?");
  console.log(`DEATH at tick ${d.tick}, the 10 s before: air ${worst("air")}, hunger ${worst("hunger")}, pain ${worst("pain")}, hurt ${worst("hurt")}, sick ${worst("sick")}, cold ${worst("cold")}, tired ${worst("tired")}; overall vitals down to ${worst("vitals", true)}`);
}

// Balance and posture.
type PostureTrace = {
  balance?: number;
  refusals?: { action: string; at: string; reason: string }[];
  repeated?: { action: string; at: string; reason: string }[];
  stance?: string[];
  falls?: { blocks: number; damage: number; steered: boolean; onto: string; note?: string }[];
  learned?: string[];
  displaced?: string[];
  worstCheckMs?: number;
};
const postures = ticks.map((t) => (trace(t, "brainstem").posture as PostureTrace | undefined) ?? {});
const refusals = postures.flatMap((p) => p.refusals ?? []);
console.log(`\nPOSTURE: ${refusals.length} action(s) refused: ${list(count(refusals, (r) => `${r.action}: ${r.reason}`), 8)}`);
for (const r of postures.flatMap((p) => p.repeated ?? [])) console.log(`!! REFUSED THREE TIMES IN A MINUTE: ${r.action} at ${r.at} (${r.reason}): the layer above is not learning from the failure`);
const UNSTEADY_ABOVE = 0.3;
const unsteadyMs = ticks.reduce((sum, t, i) => sum + ((t.signals.unsteady?.value ?? 0) > UNSTEADY_ABOVE ? span(t, i) : 0), 0);
console.log(`UNSTEADY (above ${UNSTEADY_ABOVE}): ${(unsteadyMs / 1000).toFixed(0)} s of ${seconds.toFixed(0)} s; lowest balance ${Math.min(1, ...postures.map((p) => p.balance ?? 1)).toFixed(2)}`);
console.log(`STANCE HOLDS: ${list(count(postures.flatMap((p) => p.stance ?? []), (a) => a))}`);
const falls = postures.flatMap((p) => p.falls ?? []);
console.log(`FALLS: ${falls.length}${falls.length ? `: ${falls.map((f) => `${f.blocks} blocks onto ${f.onto}, damage ${f.damage}, ${f.steered ? "steered" : "not steered"}`).join("; ")}` : ""}`);
const steered = falls.filter((f) => f.steered);
if (steered.length) console.log(`  steering: ${steered.filter((f) => f.damage === 0).length} of ${steered.length} steered falls ended unhurt`);
console.log(`DISPLACEMENTS: ${postures.flatMap((p) => p.displaced ?? []).join("; ") || "none"}`);
console.log(`SURFACES LEARNED: ${postures.flatMap((p) => p.learned ?? []).join("; ") || "none"}`);
const worstCheck = Math.max(0, ...postures.map((p) => p.worstCheckMs ?? 0));
console.log(`SLOWEST POSTURE CHECK: ${worstCheck.toFixed(3)} ms${worstCheck > 2 ? " (!! over the 2 ms limit)" : ""}`);

// The colliculus: what turned the head.
type Look = { target: string; urgency: number; how: string };
type Won = { id: string; kind: string; via: string; bearing: string; salience: number; why: string };
const colliculus = ticks.map((t) => trace(t, "colliculus"));
const looked = ticks.flatMap((t, i) => (colliculus[i]!.look && colliculus[i]!.winner ? [{ t, look: colliculus[i]!.look as Look, won: colliculus[i]!.winner as Won }] : []));
const glances = colliculus.filter((c) => c.scan !== undefined).length;
const minutes = Math.max(seconds / 60, 1 / 60);
console.log(`\nCOLLICULUS: ${looked.length} looks (${(looked.length / minutes).toFixed(1)} a minute), plus ${glances} glances around`);
const drawnBy = (w: Won) => (w.via === "touch" ? "touch" : w.why.endsWith("looming") ? "looming" : w.via);
console.log(`DRAWN BY: ${list(count(looked, (l) => drawnBy(l.won)))}; kinds: ${list(count(looked, (l) => l.won.kind), 8)}`);
const lookEnds = ticks.flatMap((t) => (t.skillEvents ?? []).filter((e) => e.skill === "look_at" && e.type === "done").map(() => t.timestamp));
const turnTimes = looked.flatMap((l) => {
  const done = lookEnds.find((at) => at >= l.t.timestamp);
  return done !== undefined && done - l.t.timestamp <= 3000 ? [done - l.t.timestamp] : [];
});
console.log(`EVENT TO HEAD TURNED: ${turnTimes.length ? `median ${middle(turnTimes)} ms, slowest ${Math.max(...turnTimes)} ms (${turnTimes.length} timed, to the nearest tick)` : "none timed"}`);
const tookOver = looked.filter((l) => l.look.how !== "alongside" && l.t.winner?.region === "colliculus").length;
console.log(`HOW: ${list(count(looked, (l) => l.look.how))}; of those not alongside, ${tookOver} won and interrupted what was running`);
const habituated = [...new Set(colliculus.flatMap((c) => Object.keys((c.damped as Record<string, number> | undefined) ?? {})))];
console.log(`HABITUATED TO: ${habituated.slice(0, 10).join("; ") || "nothing"}${habituated.length > 10 ? ` (and ${habituated.length - 10} more)` : ""}`);
type Hurt = { msAgo: number; by: string | null };
const attendedAt = ticks.map((t, i) => ({ at: t.timestamp, id: ((t as Tick & { attended?: { id: string } | null }).attended?.id ?? (colliculus[i]!.attended as string | undefined)) ?? null }));
const blindsided = ticks.flatMap((t, i) => {
  const hurt = (bodyOf(t) as { lastHurt?: Hurt | null } | null)?.lastHurt;
  const before = i > 0 ? (bodyOf(ticks[i - 1]!) as { lastHurt?: Hurt | null } | null)?.lastHurt : null;
  const fresh = hurt && hurt.by !== null && (!before || hurt.msAgo < before.msAgo);
  if (!fresh) return [];
  const sawIt = attendedAt.some((a) => a.id === hurt.by && t.timestamp - a.at <= 5000 && a.at < t.timestamp);
  return sawIt ? [] : [`tick ${t.tick} by ${hurt.by}`];
});
console.log(`BLINDSIDED (hurt by something not attended in the 5 s before): ${blindsided.length}${blindsided.length ? `: ${blindsided.slice(0, 8).join(", ")}` : ""}`);
const worstMap = Math.max(0, ...colliculus.map((c) => (c.worstMs as number | undefined) ?? 0));
console.log(`SLOWEST MAP: ${worstMap.toFixed(3)} ms${worstMap > 2 ? " (!! over the 2 ms limit)" : ""}; field of view: ${ticks.some((t) => JSON.stringify(trace(t, "instinct")).includes("lastSeen")) ? "on" : "not seen in use"}`);

// Memory.
type Recorded = { trigger: string; summary: string; strength: number; merged: boolean };
const recorded = ticks.flatMap((t) => (trace(t, "hippocampus").recorded as Recorded[] | undefined) ?? []);
console.log(`\nMEMORIES RECORDED: ${recorded.length} (${list(count(recorded, (r) => r.trigger))})`);
for (const r of recorded.slice(0, 8)) console.log(`  - ${r.summary} [${r.strength.toFixed(2)}${r.merged ? ", merged" : ""}]`);
const passes = ticks.flatMap((t) => (trace(t, "hippocampus").consolidation ? [trace(t, "hippocampus").consolidation as { phase: string; changed: number }] : []));
console.log(`CONSOLIDATION: ${passes.length} phases, ${passes.reduce((a, p) => a + p.changed, 0)} changes`);

// Planner.
const plans = ticks.flatMap((t) => t.regions.filter((r) => r.region === "prefrontal" && r.trace?.plan).map((r) => r.trace!.plan as { goal: string }));
console.log(`\nPLANS: ${plans.length}; goals: ${list(count(plans, (p) => p.goal), 5)}`);
console.log(`GOAL SET BY: ${list(count(ticks.filter((t) => t.goal), (t) => t.goal!.setBy))}`);

// Every warning anywhere.
const warnings = ticks.flatMap((t) => t.regions.flatMap((r) => [r.trace?.warning, ...((r.trace?.warnings as string[] | undefined) ?? []), r.trace?.attention].filter((w): w is string => typeof w === "string").map((w) => `${r.region}: ${w}`)));
console.log(`\nWARNINGS: ${list(count(warnings, (w) => w), 10)}`);
