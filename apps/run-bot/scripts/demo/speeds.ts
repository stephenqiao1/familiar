import { joinBody } from "./body.ts";
import { freshPlaza } from "./plaza.ts";
import { OVERVIEW, type Demo } from "./types.ts";

const never = new AbortController().signal;
/** Three runners, one lane each: a slow walk, the resting drive, and what full alarm gives. */
const RUNNERS = [
  { name: "Slow", speed: 0.2, z: 38 },
  { name: "Resting", speed: 0.4, z: 40 },
  { name: "Alarmed", speed: 0.9, z: 42 },
];
const [FROM, TO] = [43, 77];

export const speeds: Demo = {
  name: "speeds",
  finding: "Live testing, 2026-11-16: the locomotion controller (alarm barely speeds up a long straight walk)",
  title: "A race: slow, resting, alarmed",
  watch: `Three bots run ${TO - FROM} blocks side by side at three speeds. Watch how close Resting and Alarmed finish.`,
  camera: OVERVIEW,

  async run(stage) {
    await freshPlaza();
    const bodies = await Promise.all(RUNNERS.map((r) => joinBody(r.name)));
    try {
      for (const [i, body] of bodies.entries()) await body.place(FROM, RUNNERS[i]!.z);
      for (const r of RUNNERS) stage.glow(r.name);
      const times: (number | null)[] = RUNNERS.map(() => null);
      const started = Date.now();
      const done = stage.readout(() => RUNNERS.map((r, i) => `${r.name} ${times[i] === null ? `${bodies[i]!.locomotion.status().gait}…` : `${times[i]!.toFixed(1)} s`}`).join("   "));
      await Promise.all(
        bodies.map(async (body, i) => {
          body.locomotion.setDrive({ speed: RUNNERS[i]!.speed });
          await body.locomotion.goTo(body.at(TO, RUNNERS[i]!.z), { range: 1 }, never);
          times[i] = (Date.now() - started) / 1000;
        }),
      );
      done();
      const [slow, resting, alarmed] = times as number[];
      return {
        shown: resting! - alarmed! < 1,
        result: `Slow ${slow!.toFixed(1)} s, resting ${resting!.toFixed(1)} s, alarmed ${alarmed!.toFixed(1)} s. Full alarm saved ${(resting! - alarmed!).toFixed(1)} s over ${TO - FROM} blocks.`,
      };
    } finally {
      for (const body of bodies) body.quit();
    }
  },
};
