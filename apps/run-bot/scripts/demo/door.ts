import { joinBody, type Body } from "./body.ts";
import { build, freshPlaza } from "./plaza.ts";
import { OVERVIEW, type Demo } from "./types.ts";

const never = new AbortController().signal;
/** A wall across the whole plaza, too high to climb, with the plaza's side walls raised beside it so there is no way over or round. */
const WALL = ["fill 64 151 36 64 156 44 oak_planks", "fill 58 151 35 70 158 35 glass", "fill 58 151 45 70 158 45 glass"];
const doorAt = (z: number) => [`setblock 64 151 ${z} oak_door[half=lower,facing=east]`, `setblock 64 152 ${z} oak_door[half=upper,facing=east]`];

/** How many blocks it broke to get past: in the plank wall (the door aside), or in the glass beside it. */
function holes(body: Body, doorZ: number): number {
  let gone = 0;
  const missing = (x: number, y: number, z: number, name: string) => body.bot.blockAt(body.at(x, z, y))?.name !== name;
  for (let z = 36; z <= 44; z++) {
    for (let y = 151; y <= 156; y++) if (!(z === doorZ && y < 153) && missing(64, y, z, "oak_planks")) gone++;
  }
  for (let x = 58; x <= 70; x++) {
    for (let y = 151; y <= 154; y++) for (const z of [35, 45]) if (missing(x, y, z, "glass")) gone++;
  }
  return gone;
}

export const door: Demo = {
  name: "door",
  finding: "Locomotion: limits of this first version (doors are found by a simple rule)",
  title: "A door round the corner",
  watch: "First the door is straight ahead: Tester opens it. Then the door is 4 blocks to one side: watch whether it finds the door or breaks its way past.",
  camera: OVERVIEW,

  async run(stage) {
    await freshPlaza();
    const notes: string[] = [];
    const body = await joinBody("Tester", (note) => notes.push(note));
    try {
      stage.glow("Tester");
      const done = stage.readout(() => `${body.bot.targetDigBlock ? "DIGGING its way through" : "walking"}   ${notes.some((n) => n.includes("door")) ? "used the door" : "door not used"}`);

      stage.say("Part 1: the door is straight ahead.");
      await build([...WALL, ...doorAt(40)]);
      await body.place(58, 40);
      const ahead = await body.locomotion.goTo(body.at(72, 40), { range: 1 }, never);
      const usedAhead = notes.some((n) => n.includes("going through the door"));
      const brokenAhead = holes(body, 40);

      stage.say("Part 2: the same wall, with the door 4 blocks to the side.");
      notes.length = 0;
      await build([...WALL, ...doorAt(37)]);
      await body.place(58, 41);
      const aside = await body.locomotion.goTo(body.at(72, 41), { range: 1 }, never);
      const usedAside = notes.some((n) => n.includes("going through the door"));
      const brokenAside = holes(body, 37);
      done();
      return {
        shown: !usedAside && brokenAside > 0,
        result: `Door ahead: ${usedAhead ? "opened it" : "did not use it"}, broke ${brokenAhead} blocks (${ahead.status}). Door to the side: ${usedAside ? "opened it" : "did not use it"}, broke ${brokenAside} blocks to get past (${aside.status}).`,
      };
    } finally {
      body.quit();
    }
  },
};
