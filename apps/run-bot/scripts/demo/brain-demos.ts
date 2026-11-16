// The demos that need the whole brain (Jev and a fixed plan): the bot runs as its own process,
// and the readout comes from what it prints. These vary from run to run.
import { execFile } from "node:child_process";
import { readTick, runBrain, type Tick } from "./brain-run.ts";
import { build, freshPlaza, rcon } from "./plaza.ts";
import type { Stage } from "./stage.ts";
import { OVERVIEW, type Demo } from "./types.ts";

const BOT = "Tester";
const CONTAINER = process.env.MC_CONTAINER ?? "familiar-m6";
const HELMET = `{PersistenceRequired:1b,equipment:{head:{id:"minecraft:leather_helmet",count:1}}}`;
const TO_PLAZA = `tp ${BOT} 60.5 151 40.5`;
const HOME = `tp ${BOT} -8 69 14`;
/** Every run starts with the bot whole: full health, fed, nothing left over from the last demo. */
const FRESH: [number, string][] = [
  [0.3, `effect clear ${BOT}`],
  [0.5, `effect give ${BOT} instant_health 1 10 true`],
  [0.7, `effect give ${BOT} saturation 1 10 true`],
];

/** Keeps the latest tick and the bot's health (asked of the server once a second) for the readout. */
function follow(stage: Stage, extra: (tick: Tick | null) => string = () => "") {
  let tick: Tick | null = null;
  let health = 20;
  let lowest = 20;
  const ask = setInterval(() => {
    execFile("docker", ["exec", CONTAINER, "rcon-cli", "--", `data get entity ${BOT} Health`], (_error, out) => {
      const value = Number(/(-?[\d.]+)f/.exec(out ?? "")?.[1]);
      if (Number.isFinite(value)) [health, lowest] = [value, Math.min(lowest, value)];
    });
  }, 1000);
  const done = stage.readout(() => `health ${Math.round(health)}/20   doing: ${tick?.action ?? "…"}${tick?.by ? ` (${tick.by})` : ""}   alarm ${(tick?.signals.alarm ?? 0).toFixed(2)}${extra(tick)}`);
  return {
    onLine(line: string) {
      tick = readTick(line) ?? tick;
    },
    lowest: () => lowest,
    stop() {
      clearInterval(ask);
      done();
    },
  };
}

const started = (output: string, skill: string) => (output.match(new RegExp(`\\[skill\\] ${skill}(?: \\([^)]*\\))? started`, "g")) ?? []).length;

export const hold: Demo = {
  name: "hold",
  finding: "Brainstem: holding back flee leaves an unarmed bot with nothing until last_stand",
  title: "Told to stand its ground",
  watch: "The goal holds back the flee reflex. A zombie closes in, then Tester is badly hurt with a second zombie beside it. Watch whether last_stand gets it out alive.",
  camera: OVERVIEW,
  varies: true,

  async run(stage) {
    await freshPlaza();
    await build(["difficulty normal"]);
    const watch = follow(stage);
    const output = await runBrain(BOT, {
      seconds: 50,
      plan: { goal: "Stand your ground on the plaza and fight any zombie. Do not run.", holdBack: ["flee"] },
      during: [
        ...FRESH,
        [1, `clear ${BOT}`],
        [2, `give ${BOT} stone_sword 1`],
        [3, TO_PLAZA],
        [4, `effect give ${BOT} glowing 600 0 true`],
        [12, `summon zombie 66.5 151 40.5 ${HELMET}`],
        [29, `effect give ${BOT} instant_health 1 10 true`],
        [30, `execute at ${BOT} run summon zombie ~2 ~ ~ ${HELMET}`],
        [31, `damage ${BOT} 14`],
        [46, "kill @e[type=zombie]"],
        [48, HOME],
      ],
      onLine: watch.onLine,
    });
    watch.stop();
    rcon("kill @e[type=zombie]");
    rcon("difficulty peaceful");
    const died = /DIED WITH DEFENCE OVERRULED|\bdied\b/i.test(output) || watch.lowest() <= 0;
    const fled = started(output, "flee");
    return { shown: died, result: died ? "It died: the held-back flee reflex was overruled, and last_stand came too late." : `It lived, at ${Math.round(watch.lowest())}/20 health at worst. It fled ${fled} time(s) in the end (last_stand).` };
  },
};

export const far: Demo = {
  name: "far",
  finding: "Live testing, 2026-11-15: the spinal cord and brainstem layer (Jev fled from a far zombie by itself)",
  title: "A zombie it cannot be reached by",
  watch: "A zombie stands 12 blocks away across a gap it cannot cross. No reflex should fire. Watch whether Tester runs anyway.",
  camera: OVERVIEW,
  varies: true,

  async run(stage) {
    await freshPlaza();
    const watch = follow(stage);
    const output = await runBrain(BOT, {
      seconds: 42,
      plan: { goal: "Keep watch from where you stand on the plaza." },
      during: [
        ...FRESH,
        [3, TO_PLAZA],
        [4, `effect give ${BOT} glowing 600 0 true`],
        [11, `execute at ${BOT} run fill ~4 140 36 ~8 150 44 air`],
        [12, `execute at ${BOT} run summon zombie ~12 151 ~ ${HELMET}`],
        [38, "kill @e[type=zombie]"],
        [40, HOME],
      ],
      onLine: watch.onLine,
    });
    watch.stop();
    rcon("kill @e[type=zombie]");
    const [fled, fought] = [started(output, "flee"), started(output, "attack")];
    const byReflex = /(flee|attack)[^\n]*<- reflex/.test(output);
    return { shown: (fled > 0 || fought > 0) && !byReflex, result: fled + fought === 0 ? "It looked and carried on: no fleeing, no attacking." : `It ${fled ? `fled ${fled} time(s)` : ""}${fled && fought ? " and " : ""}${fought ? `attacked ${fought} time(s)` : ""}${byReflex ? " (a reflex fired)" : ", by Jev's choice: no reflex fired"}.` };
  },
};

export const dawn: Demo = {
  name: "dawn",
  finding: "Live testing, 2026-11-15: the spinal cord and brainstem layer (at dawn sleep is started and refused)",
  title: "Still trying to sleep at dawn",
  watch: "It is the end of the night at base. Tester goes to bed. As dawn breaks, watch it keep trying to get back in.",
  camera: "-8 75 24 180 40",
  varies: true,

  async run(stage) {
    await build(["gamerule spawn_mobs false", "difficulty peaceful", "weather clear", "gamerule players_sleeping_percentage 101", "time set 22300"]);
    let refused = 0;
    const watch = follow(stage, () => `   sleep refused: ${refused}`);
    const output = await runBrain(BOT, {
      seconds: 110,
      plan: { goal: "Sleep in the base bed until morning." },
      during: [...FRESH, [1, HOME], [2, `effect give ${BOT} glowing 600 0 true`]],
      onLine(line) {
        watch.onLine(line);
        if (/\[skill\] sleep(?: \([^)]*\))? failed/.test(line)) refused++;
      },
    });
    watch.stop();
    await build(["gamerule players_sleeping_percentage 100", "time set 1000"]);
    const slept = started(output, "sleep");
    return { shown: refused >= 5, result: slept === 0 ? "It never chose to sleep this time (Jev's choice), so there was nothing to refuse." : `It started sleep ${slept} time(s); the game refused it ${refused} time(s).` };
  },
};
