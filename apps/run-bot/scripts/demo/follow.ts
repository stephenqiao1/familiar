import { connect } from "@familiar/minecraft";
import { joinBody } from "./body.ts";
import { every100ms, freshPlaza, median, rcon, sleep } from "./plaza.ts";
import { OVERVIEW, type Demo } from "./types.ts";

const RANGE = 3;
const SECONDS = 30;

export const follow: Demo = {
  name: "follow",
  finding: "Live testing, 2026-11-16: the locomotion controller (following trails by about twice the range)",
  title: "Following trails behind",
  watch: `Tester is asked to stay within ${RANGE} blocks of Leader, who walks up and down. Watch the gap between them.`,
  camera: OVERVIEW,

  async run(stage) {
    await freshPlaza();
    const body = await joinBody("Tester");
    const leader = await connect({ host: "localhost", port: 25565, username: "Leader" });
    try {
      rcon("gamemode creative Leader");
      rcon("tp Leader 50.5 151 42.5");
      await body.place(46);
      await leader.waitForChunksToLoad();
      await sleep(1500);
      stage.glow("Tester");
      stage.glow("Leader");
      // Leader is a plain test player steered by hand: east, then west, and so on.
      let east = true;
      const walk = every100ms(() => {
        if (leader.entity.position.x > 74) east = false;
        if (leader.entity.position.x < 46) east = true;
        void leader.look(east ? -Math.PI / 2 : Math.PI / 2, 0, true);
        leader.setControlState("forward", true);
      });
      const entity = body.bot.players.Leader?.entity;
      if (!entity) return { shown: false, result: "Tester could not see Leader" };
      const gap = () => entity.position.distanceTo(body.bot.entity.position);
      const gaps: number[] = [];
      const measure = setInterval(() => gaps.push(gap()), 500);
      const done = stage.readout(() => `gap ${gap().toFixed(1)} blocks (asked: ${RANGE})   gait ${body.locomotion.status().gait}`);
      const stop = new AbortController();
      const following = body.locomotion.follow(entity, { range: RANGE }, stop.signal);
      await sleep(SECONDS * 1000);
      stop.abort(new Error("demo over"));
      await following;
      walk();
      clearInterval(measure);
      done();
      const typical = median(gaps.slice(6));
      return { shown: typical > RANGE + 1, result: `Asked to stay within ${RANGE}. Typical gap ${typical.toFixed(1)} blocks, farthest ${Math.max(...gaps.slice(6)).toFixed(1)}.` };
    } finally {
      body.quit();
      leader.quit();
    }
  },
};
