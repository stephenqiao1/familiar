import { joinBody } from "./body.ts";
import { build, freshPlaza, rcon, sleep } from "./plaza.ts";
import { type Demo } from "./types.ts";

const MAX_SECONDS = 25;

export const lava: Demo = {
  name: "lava",
  finding: "Live testing, 2026-11-15: the spinal cord and brainstem layer (lava is only survivable with health and water to spare)",
  title: "Out of the lava, still on fire",
  watch: "Tester is dropped into lava with no water anywhere near. The reflex gets it out. Watch what happens next.",
  camera: "60 160 50 180 45",

  async run(stage) {
    await freshPlaza();
    const body = await joinBody("Tester");
    try {
      await body.place(56);
      let died = false;
      body.bot.once("death", () => void (died = true));
      const burning = () => (Number((body.bot.entity.metadata as unknown[])[0]) & 1) === 1;
      const inLava = () => body.bot.blockAt(body.bot.entity.position)?.name === "lava";
      let lowest = 20;
      let burned = 0;
      const done = stage.readout(() => `health ${Math.round(body.bot.health)}/20   ${inLava() ? "IN LAVA" : burning() ? "ON FIRE" : "safe"}   ${body.executor.current()?.skill ?? "standing"}`);
      await build(["fill 59 150 39 61 150 41 lava"]);
      rcon("tp Tester 60.5 151 40.5");
      const started = Date.now();
      while (Date.now() - started < MAX_SECONDS * 1000 && !died) {
        // No brain here: the demo plays the reflex's part, starting its skill whenever the body is in danger.
        if ((inLava() || burning()) && !body.executor.current()) void body.executor.start("escape_hazard");
        lowest = Math.min(lowest, body.bot.health);
        if (burning() && !inLava()) burned++;
        if (!inLava() && !burning() && Date.now() - started > 3000) break;
        await sleep(100);
      }
      done();
      await body.executor.interrupt();
      return {
        shown: died || burned > 20,
        result: died ? `It got out of the lava and burned to death (${(burned / 10).toFixed(0)} s on fire).` : `It lived, with ${Math.round(lowest)}/20 health at worst, after ${(burned / 10).toFixed(0)} s on fire out of the lava.`,
      };
    } finally {
      rcon("fill 59 150 39 61 150 41 stone");
      body.quit();
    }
  },
};
