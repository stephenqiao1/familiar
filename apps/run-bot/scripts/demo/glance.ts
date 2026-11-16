import { joinBody, type Body } from "./body.ts";
import { build, every100ms, freshPlaza, share } from "./plaza.ts";
import { OVERVIEW, type Demo } from "./types.ts";

const never = new AbortController().signal;
/** What it looks at: a gold block on top of the north wall. */
const TARGET = { x: 60, y: 153, z: 35 };
const BUMPS = [50, 54, 58, 62, 66, 70].map((x) => `fill ${x} 151 36 ${x} 151 44 stone`);

/** Whether the head points at the target (within about 20 degrees). */
function onTarget(body: Body): boolean {
  const me = body.bot.entity.position;
  const want = Math.atan2(-(TARGET.x + 0.5 - me.x), -(TARGET.z + 0.5 - me.z));
  return Math.abs(Math.atan2(Math.sin(body.bot.entity.yaw - want), Math.cos(body.bot.entity.yaw - want))) < 0.35;
}

/** Walks the lane while asking for a look at the target again and again; returns how much of the walk the head was on it. */
async function walkLooking(body: Body) {
  let [on, samples] = [0, 0];
  const watch = every100ms(() => {
    samples++;
    if (onTarget(body)) on++;
  });
  const look = setInterval(() => void body.executor.startAlongside("look_at", `pos:${TARGET.x},${TARGET.y},${TARGET.z}`), 300);
  void body.executor.start("go_to", "pos:76,151,40");
  await new Promise((resolve) => setTimeout(resolve, 600));
  while (body.executor.current()) await new Promise((resolve) => setTimeout(resolve, 100));
  clearInterval(look);
  watch();
  return { on, samples };
}

export const glance: Demo = {
  name: "glance",
  finding: "Primitives: looking while walking works by pressing other keys, with limits",
  title: "Looking one way, walking another",
  watch: "Tester walks east while keeping its head on the gold block to the north. First on flat ground, then over steps: watch its head.",
  camera: OVERVIEW,

  async run(stage) {
    await freshPlaza();
    const body = await joinBody("Tester");
    try {
      stage.glow("Tester");
      body.locomotion.setDrive({ speed: 0.2 });
      const done = stage.readout(() => `head ${onTarget(body) ? "ON the gold block" : "back on the path"}`);
      stage.say("Part 1: flat ground.");
      await build([`setblock ${TARGET.x} ${TARGET.y} ${TARGET.z} gold_block`]);
      await body.place(44);
      body.locomotion.setDrive({ speed: 0.2 });
      const flat = await walkLooking(body);
      stage.say("Part 2: a step to jump every four blocks.");
      await build(BUMPS);
      await body.place(44);
      body.locomotion.setDrive({ speed: 0.2 });
      const rough = await walkLooking(body);
      done();
      void never;
      return { shown: rough.on / rough.samples < flat.on / flat.samples, result: `Head on the gold block ${share(flat.on, flat.samples)} of the walk on flat ground, ${share(rough.on, rough.samples)} over steps.` };
    } finally {
      await body.executor.interrupt();
      body.quit();
    }
  },
};
