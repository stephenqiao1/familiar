import { joinBody, type Body } from "./body.ts";
import { build, every100ms, freshPlaza } from "./plaza.ts";
import { OVERVIEW, type Demo } from "./types.ts";

const never = new AbortController().signal;
const POND = ["fill 53 147 35 61 150 45 stone", "fill 54 149 36 60 150 44 water"];
const HIGH_WALLS = ["fill 50 151 35 64 157 35 glass", "fill 50 151 45 64 157 45 glass"];

/** Walks from one side of the pond to the other and says which patterns were used and how high the bot got. */
async function cross(body: Body) {
  const patterns = new Set<string>();
  let top = 0;
  const watch = every100ms(() => {
    patterns.add(body.locomotion.status().pattern ?? "none");
    top = Math.max(top, body.bot.entity.position.y);
  });
  const result = await body.locomotion.goTo(body.at(70), { range: 1 }, never);
  watch();
  return { swam: patterns.has("swim"), top, status: result.status };
}

export const pond: Demo = {
  name: "pond",
  finding: "Live testing, 2026-11-16: the locomotion controller (the pathfinder went round the pond)",
  title: "It would rather not swim",
  watch: "A pond lies across the path. First the side walls are low: watch where Tester goes. Then the walls are raised.",
  camera: OVERVIEW,

  async run(stage) {
    await freshPlaza();
    const body = await joinBody("Tester");
    try {
      stage.glow("Tester");
      const done = stage.readout(() => `pattern ${body.locomotion.status().pattern ?? "standing"}   height ${body.bot.entity.position.y.toFixed(0)} (floor is 151)`);
      stage.say("Part 1: low side walls.");
      await build(POND);
      await body.place(46);
      const low = await cross(body);
      stage.say("Part 2: the side walls are raised, so there is no way round.");
      await build([...POND, ...HIGH_WALLS]);
      await body.place(46);
      const high = await cross(body);
      done();
      const how = (run: typeof low) => (run.swam ? "swam across" : run.top >= 152.5 ? "went along the top of the wall" : "stayed dry some other way");
      return { shown: !low.swam, result: `Low walls: ${how(low)} (${low.status}). High walls: ${how(high)} (${high.status}).` };
    } finally {
      body.quit();
    }
  },
};
