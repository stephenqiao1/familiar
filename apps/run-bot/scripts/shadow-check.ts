// Ordinary play with the amygdala in shadow: the whole brain, in the ordinary world by the base,
// with nothing scripted, for 30 minutes (or the minutes given). Then the shadow report.
//   pnpm shadow-check [minutes]
import { rcon, sleep } from "./primitive-check/world.ts";
import { BOT, play } from "./live.ts";
import { shadowReport } from "./shadow-report.ts";

const minutes = Number(process.argv[2] ?? 30);
// An ordinary afternoon: dusk comes in a few minutes, then a night, then a morning.
for (const command of ["difficulty normal", "gamerule spawn_mobs true", "gamerule advance_time true", "time set 9000", "weather clear"]) rcon(command);
const ticks = await play(
  async () => {
    for (const give of ["bread 8", "cooked_beef 4", "stone_sword 1", "torch 8"]) rcon(`give ${BOT} ${give}`);
    for (let minute = 1; minute <= minutes; minute++) {
      await sleep(60_000);
      if (minute % 5 === 0) console.log(`    ${minute} minutes`);
    }
  },
  { whole: true, start: "-8 69 14 0 0" },
);
for (const command of ["difficulty easy", "time set 1000"]) rcon(command);
console.log(shadowReport(ticks).join("\n"));
