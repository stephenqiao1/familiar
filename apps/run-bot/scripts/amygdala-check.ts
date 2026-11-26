// Live check of the amygdala on the test server: what the real bot learns to fear, and unlearns,
// from what happens to its body, and what its readers then do. No Jev and no planner calls: the
// scenes stage what happens (a hurt, a creature that does nothing), and the bot's own brain learns.
// Needs the server container (MC_CONTAINER, default familiar-m6).
//   pnpm amygdala-check [scene ...]      scenes: place sign unlearn tagalong shelter similar
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { BOT, n, play, runScenes, traceOf, type Row, type Tick } from "./live.ts";
import { rcon, sleep } from "./primitive-check/world.ts";

/** The ground: a stone floor in the sky south of the plaza, walled, with two lit caves and a lit hut. */
const G = { x0: 40, x1: 104, z0: 60, z1: 108 };
const SPOT = {
  field: "44.5 151 62.5 -90 0",
  fieldSouth: "44.5 151 104.5 -90 0",
  // Deep inside each. (On this server the sky light under a roof made by a fill command cannot be trusted: the map
  // then knows a covered place by its roof and walls, which must be within 6 blocks on three sides. So the caves are short.)
  caveA: "57.5 151 74.5 90 0",
  caveAWest: "52.5 151 74.5 -90 0",
  caveB: "57.5 151 94.5 90 0",
  hut: "90.5 151 74.5 90 0",
};
/** Something predicting this much harm is known to bring harm (KNOWN_HARM in the bot). */
const KNOWN = 0.12;
const AWAY_EAST = "{IsBaby:0b,NoAI:1b,Rotation:[-90f,0f]}";
const AWAY_WEST = "{IsBaby:0b,NoAI:1b,Rotation:[90f,0f]}";

function buildGround(): void {
  for (const command of [
    `forceload add ${G.x0 - 1} ${G.z0 - 1} ${G.x1 + 1} ${G.z1 + 1}`,
    "gamerule spawn_mobs false",
    "weather clear",
    "time set 1000",
    "gamerule advance_time false",
    "kill @e[type=!player,x=72,y=151,z=84,distance=..60]",
    `fill ${G.x0} 151 ${G.z0} ${G.x1} 157 ${G.z1} air`,
    `fill ${G.x0} 150 ${G.z0} ${G.x1} 150 ${G.z1} stone`,
    `fill ${G.x0 - 1} 151 ${G.z0 - 1} ${G.x1 + 1} 153 ${G.z0 - 1} glass`,
    `fill ${G.x0 - 1} 151 ${G.z1 + 1} ${G.x1 + 1} 153 ${G.z1 + 1} glass`,
    `fill ${G.x0 - 1} 151 ${G.z0 - 1} ${G.x0 - 1} 153 ${G.z1 + 1} glass`,
    `fill ${G.x1 + 1} 151 ${G.z0 - 1} ${G.x1 + 1} 153 ${G.z1 + 1} glass`,
    // Two caves (roofed, lit from the roof so that the dark is not what makes the bot wary), open at the west end.
    ...[70, 90].flatMap((z) => [`fill 50 150 ${z} 60 154 ${z + 8} stone hollow`, `fill 51 154 ${z + 4} 59 154 ${z + 4} glowstone`, `fill 50 151 ${z + 3} 50 152 ${z + 5} air`]),
    // A hut (roofed and lit), with one way in on its west side.
    "fill 80 150 70 92 154 78 stone hollow",
    "fill 81 154 74 91 154 74 glowstone",
    "fill 80 151 74 80 152 74 air",
  ]) rcon(command);
}

interface Association {
  harm: number;
  good: number;
  safe?: Record<string, { value: number }>;
  from?: string;
  met?: number;
}
interface Amygdala {
  area?: string | null;
  fear?: number;
  begun?: { cue: string; harm: number; like?: string }[];
  learned?: { after: string; sign?: string; spared?: number; changes: { cue: string; what: string; from: number; to: number }[] }[];
  returned?: { cue: string; from: number; to: number; why: string }[];
}
const amygdala = (t: Tick) => traceOf<Amygdala>(t, "amygdala");
const fear = (t: Tick) => t.signals.fear?.value ?? 0;
const possible = (t: Tick) => (t.state.data as unknown as { defence?: { possible: string | null } }).defence?.possible ?? null;
const threats = (t: Tick) => (t.state.data as unknown as { defence?: { threats: { kind: string; danger: number; harm?: number }[] } }).defence?.threats ?? [];
const learnedBy = (ticks: Tick[]) => JSON.parse(readFileSync(`data/${BOT}/associations.json`, "utf8")) as Record<string, Association>;
const peak = (ticks: Tick[], of: (t: Tick) => number) => Math.max(0, ...ticks.map(of));
const middle = (ticks: Tick[], of: (t: Tick) => number) => [...ticks.map(of)].sort((a, b) => a - b)[ticks.length >> 1] ?? 0;
const window = (ticks: Tick[], from: number, to: number) => ticks.filter((t) => t.timestamp >= from && t.timestamp < to);
const tp = (spot: string) => rcon(`tp ${BOT} ${spot}`);
const heal = () => rcon(`effect give ${BOT} instant_health 1 10 true`);

/**
 * A bot that has been about for a while: the ground under it and the time of day are long
 * familiar and harmless (a newborn bot would blame them as readily as anything else).
 */
function livedIn(): void {
  rmSync(`data/${BOT}`, { recursive: true, force: true });
  mkdirSync(`data/${BOT}`, { recursive: true });
  const familiar = { harm: 0, good: 0, sure: 1, at: Date.now(), met: 20 };
  writeFileSync(`data/${BOT}/associations.json`, JSON.stringify({ "block:stone": familiar, "time:day": familiar }));
}

let built = false;
/**
 * Runs a scene on the ground with a lived-in bot. The ground is built once and then left alone:
 * the server takes some seconds to work out the light under a new roof, and a bot that joins
 * before it has reads the old light (and so takes a cave for open ground).
 */
async function scene(act: Parameters<typeof play>[0], start: string, settings?: object): Promise<Tick[]> {
  if (!built) {
    buildGround();
    built = true;
    await sleep(12_000);
  }
  for (const command of ["kill @e[type=!player,x=72,y=151,z=84,distance=..60]", "time set 1000", "gamerule advance_time false"]) rcon(command);
  await sleep(1000);
  livedIn();
  return play(act, { start, keep: true, ...(settings ? { settings } : {}) }).finally(() => rcon("gamerule advance_time true"));
}

/** A creature that does nothing, in view for 21 seconds and gone for 7, `times` over. Returns when each showing began. */
async function harmlessMeetings(kind: string, at: string, tag: string, times: number): Promise<number[]> {
  const shown: number[] = [];
  for (let i = 0; i < times; i++) {
    rcon(`summon ${kind} ${at} ${tag}`);
    shown.push(Date.now());
    await sleep(21_000);
    rcon(`kill @e[type=${kind},x=72,y=151,z=84,distance=..60]`);
    await sleep(7000);
  }
  return shown;
}

const scenes: Record<string, () => Promise<Row>> = {
  /** 1. Badly hurt, by nothing it can see, in one cave. It is wary going back there, and not in the other cave. */
  async place() {
    const at: Record<string, number> = {};
    const ticks = await scene(async () => {
      await sleep(6000);
      tp(SPOT.caveA);
      await sleep(8000);
      for (let i = 0; i < 2; i++) {
        rcon(`damage ${BOT} 14 minecraft:generic`);
        await sleep(5000);
        heal();
        await sleep(9000);
      }
      tp(SPOT.field);
      at.field = Date.now() + 4000;
      await sleep(10_000);
      tp(SPOT.caveA);
      at.caveA = Date.now() + 4000;
      await sleep(10_000);
      // By way of the field: a jump straight from cave to cave would be taken for a walk between them, and join them as one area.
      tp(SPOT.field);
      await sleep(3000);
      tp(SPOT.caveB);
      at.caveB = Date.now() + 4000;
      await sleep(10_000);
      at.end = Date.now();
    }, SPOT.field);
    const [inField, inA, inB] = [window(ticks, at.field!, at.caveA! - 4000), window(ticks, at.caveA!, at.caveB! - 7500), window(ticks, at.caveB!, at.end!)];
    const dread = (w: Tick[]) => w.filter((t) => possible(t)?.includes("fear")).length / Math.max(1, w.length);
    const wary = (w: Tick[]) => w.filter((t) => (t.signals.wary?.value ?? 0) > 0).length / Math.max(1, w.length);
    const held = learnedBy(ticks);
    const areaA = amygdala(inA.at(-1) ?? ticks.at(-1)!).area ?? "?";
    const areaB = amygdala(inB.at(-1) ?? ticks.at(-1)!).area ?? "?";
    const [harmA, harmB, stone] = [held[`area:${areaA}`]?.harm ?? 0, held[`area:${areaB}`]?.harm ?? 0, held["block:stone"]?.harm ?? 0];
    const ok = areaA !== areaB && harmA >= KNOWN && dread(inA) > 0.7 && wary(inA) > 0.7 && dread(inB) === 0 && dread(inField) === 0 && stone < KNOWN;
    return {
      scene: "1 place: badly hurt in one cave",
      saw: `learned: area ${areaA} (the cave) harm ${n(harmA)}, area ${areaB} (the other cave) ${n(harmB)}, the stone floor ${n(stone)} | fear: in the field ${n(middle(inField, fear))}, back in the cave ${n(middle(inA, fear))}, in the other cave ${n(middle(inB, fear))} | wary for a feared place: back in the cave on ${Math.round(100 * dread(inA))}% of ticks (wary signal ${Math.round(100 * wary(inA))}%), in the other cave ${Math.round(100 * dread(inB))}%, in the field ${Math.round(100 * dread(inField))}%`,
      problem: ok ? "" : "the cave was not feared, or the other cave or the floor was",
    };
  },

  /** 2. A warning (thunder a way off) twice comes just before a hurt. The third time, fear rises at the warning alone. */
  async sign() {
    const at: Record<string, number> = {};
    const ticks = await scene(async () => {
      await sleep(8000);
      for (let i = 0; i < 2; i++) {
        at[`warned${i}`] = Date.now();
        rcon("summon lightning_bolt 58.5 151 62.5");
        await sleep(1500);
        rcon(`damage ${BOT} 9 minecraft:generic`);
        await sleep(5000);
        heal();
        tp(SPOT.field);
        await sleep(18_000);
      }
      at.alone = Date.now();
      rcon("summon lightning_bolt 58.5 151 62.5");
      await sleep(6000);
      at.end = Date.now();
    }, SPOT.field);
    const first = window(ticks, at.warned0!, at.warned0! + 1400);
    const before = window(ticks, at.alone! - 6000, at.alone!);
    const third = window(ticks, at.alone!, at.alone! + 2500);
    const hurtAfter = window(ticks, at.alone!, at.end!).some((t) => (amygdala(t).learned ?? []).some((l) => l.sign === "harm"));
    const thunder = learnedBy(ticks)["sound:thunder"]?.harm ?? 0;
    const ok = thunder >= KNOWN && peak(third, fear) >= KNOWN && peak(third, fear) > peak(first, fear) + 0.1 && peak(third, fear) > peak(before, fear) + 0.1 && !hurtAfter;
    return {
      scene: "2 sign: a warning before the hurt, twice",
      saw: `learned: the sound of thunder predicts harm ${n(thunder)} | fear at the warning: the first time ${n(peak(first, fear))}, the third time (no hurt followed) ${n(peak(third, fear))}; just before it ${n(peak(before, fear))} (the place itself took some of the blame) | alarm at the third warning ${n(peak(third, (t) => t.signals.alarm?.value ?? 0))}`,
      problem: ok ? "" : "fear did not rise at the warning alone",
    };
  },

  /** 3. The same creature met harmlessly ten times in one area. Fear of it falls there, and is back in another area. */
  async unlearn() {
    const at: Record<string, number> = {};
    let shown: number[] = [];
    const ticks = await scene(async () => {
      await sleep(5000);
      shown = await harmlessMeetings("husk", "56.5 151 104.5", AWAY_EAST, 10);
      tp(SPOT.caveB);
      await sleep(3000);
      at.elsewhere = Date.now();
      rcon(`summon husk 52.5 151 94.5 ${AWAY_WEST}`);
      await sleep(8000);
      at.end = Date.now();
    }, SPOT.fieldSouth);
    const meeting = (i: number) => window(ticks, shown[i]! + 2000, shown[i]! + 20_000);
    const [firstFear, lastFear] = [peak(meeting(0), fear), middle(meeting(9), fear)];
    const elsewhere = window(ticks, at.elsewhere! + 1500, at.end!);
    const husk = learnedBy(ticks)["kind:husk"];
    const back = ticks.flatMap((t) => amygdala(t).returned ?? []).filter((r) => r.cue === "kind:husk");
    const ok = lastFear < firstFear - 0.2 && peak(elsewhere, fear) > lastFear + 0.1 && (husk?.harm ?? 0) >= 0.45 && back.length > 0;
    return {
      scene: "3 unlearning: ten harmless meetings in one area",
      saw: `unlearned: husk is still held at harm ${n(husk?.harm ?? 0)}, with "safe here" ${Object.entries(husk?.safe ?? {}).map(([area, s]) => `${area} ${n(s.value)}`).join(", ") || "nowhere"} | fear with the husk in view: meeting 1 ${n(firstFear)}, ${[2, 4, 6, 8].map((i) => `${i + 1}: ${n(middle(meeting(i), fear))}`).join(", ")}, meeting 10 ${n(lastFear)}; in another area ${n(peak(elsewhere, fear))} | came back: ${back[0] ? `${n(back[0].from)} to ${n(back[0].to)}, ${back[0].why}` : "not logged"}`,
      problem: ok ? "" : "fear did not fall where it was harmless, or did not come back elsewhere",
    };
  },

  /** 4. A cow stands by each time a husk hurts the bot. The cow is not learned as dangerous. */
  async tagalong() {
    const ticks = await scene(async () => {
      rcon("summon cow 47.5 151 63.5 {NoAI:1b}");
      rcon(`summon husk 50.5 151 61.5 ${AWAY_EAST}`);
      await sleep(8000);
      for (let i = 0; i < 3; i++) {
        rcon(`damage ${BOT} 12 minecraft:mob_attack by @e[type=husk,limit=1,sort=nearest]`);
        await sleep(6000);
        heal();
        tp(SPOT.field);
        await sleep(5000);
      }
    }, SPOT.field);
    const held = learnedBy(ticks);
    const hurts = ticks.flatMap((t) => (amygdala(t).learned ?? []).filter((l) => l.sign === "harm"));
    const cowAround = hurts.filter((l) => l.changes.some((c) => c.cue === "kind:cow") || (l.spared ?? 0) > 0).length;
    const cowThreat = ticks.some((t) => threats(t).some((x) => x.kind === "cow"));
    const [cow, husk] = [held["kind:cow"]?.harm ?? 0, held["kind:husk"]?.harm ?? 0];
    const ok = hurts.length >= 3 && cow < KNOWN && !cowThreat && husk > 0.5 && held["kind:cow"] !== undefined;
    return {
      scene: "4 tag-along: a cow nearby each time a husk hurts",
      saw: `learned: husk harm ${n(husk)}, cow ${n(cow, 3)} (known harmful from ${KNOWN}) | ${hurts.length} hurts, the cow around for ${cowAround}; cues spared blame in all ${hurts.reduce((sum, l) => sum + (l.spared ?? 0), 0)} | the cow was ${cowThreat ? "" : "never "}sized up as a threat | fear peak ${n(peak(ticks, fear))}`,
      problem: ok ? "" : "the cow was learned as dangerous, or the hurts were not seen",
    };
  },

  /** 5. A husk is met harmlessly ten times from inside a hut. Fear is lower in the hut than out in the open. */
  async shelter() {
    const at: Record<string, number> = {};
    let shown: number[] = [];
    const ticks = await scene(async () => {
      await sleep(5000);
      shown = await harmlessMeetings("husk", "77.5 151 74.5", AWAY_WEST, 10);
      at.inside = Date.now();
      rcon(`summon husk 77.5 151 74.5 ${AWAY_WEST}`);
      await sleep(8000);
      rcon("kill @e[type=husk,x=72,y=151,z=84,distance=..60]");
      tp(SPOT.fieldSouth);
      await sleep(7000);
      at.outside = Date.now();
      rcon(`summon husk 56.5 151 104.5 ${AWAY_EAST}`);
      await sleep(8000);
      at.end = Date.now();
    }, SPOT.hut);
    const inside = window(ticks, at.inside! + 1500, at.inside! + 8000);
    const outside = window(ticks, at.outside! + 1500, at.end!);
    const hut = amygdala(inside.at(-1) ?? ticks[0]!).area ?? "?";
    const held = learnedBy(ticks);
    const first = peak(window(ticks, shown[0]! + 2000, shown[0]! + 20_000), fear);
    const ok = middle(inside, fear) < peak(outside, fear) - 0.1 && middle(inside, fear) < first - 0.2 && (held[`area:${hut}`]?.harm ?? 0) <= 0;
    return {
      scene: "5 safety: a shelter where nothing has ever hurt it",
      saw: `learned: the hut (area ${hut}) harm ${n(held[`area:${hut}`]?.harm ?? 0, 3)} (below 0 is a sign of safety); husk "safe here" in the hut ${n(held["kind:husk"]?.safe?.[hut]?.value ?? 0)} | fear with a husk in view: at first ${n(first)}, in the hut after ten harmless meetings ${n(middle(inside, fear))}, out in the open ${n(peak(outside, fear))}`,
      problem: ok ? "" : "fear was not lower inside the shelter",
    };
  },

  /** 6. A bot born fearing nothing learns that husks hurt. A zombie (alike) then starts feared; a chicken (not alike) starts neutral. */
  async similar() {
    const at: Record<string, number> = {};
    const ticks = await scene(
      async () => {
        rcon(`summon husk 58.5 151 74.5 ${AWAY_EAST}`);
        await sleep(6000);
        for (let i = 0; i < 3; i++) {
          rcon(`damage ${BOT} 12 minecraft:mob_attack by @e[type=husk,limit=1,sort=nearest]`);
          await sleep(5000);
          heal();
          tp(SPOT.caveAWest);
          await sleep(4000);
        }
        rcon("kill @e[type=husk,x=72,y=151,z=84,distance=..60]");
        await sleep(7000);
        tp(SPOT.caveAWest);
        at.zombie = Date.now();
        rcon(`summon zombie 58.5 151 74.5 ${AWAY_EAST}`);
        await sleep(7000);
        rcon("kill @e[type=zombie,x=72,y=151,z=84,distance=..60]");
        await sleep(6000);
        tp(SPOT.caveAWest);
        at.chicken = Date.now();
        rcon("summon chicken 56.5 151 74.5 {NoAI:1b}");
        await sleep(7000);
        at.end = Date.now();
      },
      SPOT.caveAWest,
      { defence: { innateThreats: [] } },
    );
    const begun = ticks.flatMap((t) => amygdala(t).begun ?? []);
    const zombie = begun.find((b) => b.cue === "kind:zombie");
    const husk = learnedBy(ticks)["kind:husk"]?.harm ?? 0;
    const chicken = learnedBy(ticks)["kind:chicken"];
    const sized = window(ticks, at.zombie!, at.chicken!).flatMap(threats).find((x) => x.kind === "zombie");
    const chickenThreat = window(ticks, at.chicken!, at.end!).some((t) => threats(t).some((x) => x.kind === "chicken"));
    const ok = husk > 0.4 && (zombie?.harm ?? 0) >= KNOWN && zombie?.like === "kind:husk" && sized !== undefined && chicken !== undefined && chicken.harm < KNOWN && !chickenThreat;
    return {
      scene: "6 similar: husks hurt; then a zombie, then a chicken",
      saw: `learned: husk harm ${n(husk)} (born fearing nothing) | a zombie, never met, began at ${n(zombie?.harm ?? 0)}${zombie?.like ? ` (like ${zombie.like.slice(5)})` : ""} and was ${sized ? `sized up as a threat (danger ${n(sized.danger)})` : "not sized up as a threat"}; a chicken began at ${n(chicken?.harm ?? 0, 3)} and was ${chickenThreat ? "" : "not "}a threat | fear: zombie in view ${n(peak(window(ticks, at.zombie!, at.zombie! + 7000), fear))}, chicken in view ${n(peak(window(ticks, at.chicken! + 1000, at.end!), fear))}`,
      problem: ok ? "" : "the similar kind did not start feared, or the unlike one did",
    };
  },
};

await runScenes(scenes);
