import { joinBody } from "./body.ts";
import { freshPlaza, sleep } from "./plaza.ts";
import { OVERVIEW, type Demo } from "./types.ts";

const never = new AbortController().signal;

export const stuck: Demo = {
  name: "stuck",
  finding: "Live testing, 2026-11-16: the locomotion controller (the third recovery and the final stuck failure were not seen live)",
  title: "Held fast",
  watch: "A second into its walk the test holds Tester's body still. Its legs keep trying; chat shows each thing it tries. (You will not see the jump: the body is held.)",
  camera: OVERVIEW,

  async run(stage) {
    await freshPlaza();
    const tried: string[] = [];
    const body = await joinBody("Tester", (note) => {
      if (!note.includes("trying")) return;
      tried.push(note.split("trying ")[1]!.split(" (")[0]!);
      stage.say(`Tester: ${note.replace("locomotion: ", "")}`, "red");
    });
    try {
      stage.glow("Tester");
      await body.place(50);
      const done = stage.readout(() => {
        const s = body.locomotion.status();
        return `${s.moving ? "travelling" : "stopped"}   stuck: ${s.stuck ? "YES" : "no"}   recoveries tried: ${s.recoveries}`;
      });
      // The server cannot hold this client still (slowness and a speed of 0 are ignored), so the test switches its movement off.
      const freeze = setTimeout(() => (body.bot.physicsEnabled = false), 1000);
      const result = await Promise.race([body.locomotion.goTo(body.at(72), { range: 1 }, never), sleep(40_000).then(() => ({ status: "failed" as const, reason: "no result in 40 s" }))]);
      clearTimeout(freeze);
      body.bot.physicsEnabled = true;
      done();
      return { shown: !tried.includes("replan"), result: `Tried: ${tried.join(", then ") || "nothing"}. Ended: ${result.status}${result.reason ? ` (${result.reason})` : ""}.` };
    } finally {
      body.bot.physicsEnabled = true;
      body.quit();
    }
  },
};
