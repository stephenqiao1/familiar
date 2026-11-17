// The bots the demos drive directly (no Jev, no planner): each is a body with its own locomotion
// controller and skill executor.
import type { SkillEvent } from "@familiar/contracts";
import { createSkillExecutor } from "@familiar/core";
import { connect, createLocomotion, createGut, createPain, INNATE_BAD_FOODS, INNATE_HURTS, minecraftSkills, type MinecraftCtx } from "@familiar/minecraft";
import { rcon, sleep } from "../primitive-check/world.ts";

export async function joinBody(name: string, onNote: (note: string) => void = () => {}) {
  const bot = await connect({ host: "localhost", port: 25565, username: name });
  bot.on("error", () => {});
  rcon(`gamemode survival ${name}`);
  await bot.waitForChunksToLoad();
  const locomotion = createLocomotion(bot, { log: onNote });
  const ctx: MinecraftCtx = { bot, base: { chest: bot.entity.position.clone(), bed: bot.entity.position.clone() }, wants: () => [], locomotion, pain: createPain({ innate: INNATE_HURTS }), gut: createGut({ innate: INNATE_BAD_FOODS }), lastHurt: () => null, chests: {} as MinecraftCtx["chests"], log: () => {} };
  const sideEvents: SkillEvent[] = [];
  const events: SkillEvent[] = [];
  const executor = createSkillExecutor({ skills: minecraftSkills, ctx, onEvent: (e) => void events.push(e), onSideEvent: (e) => void sideEvents.push(e) });
  return {
    name,
    bot,
    locomotion,
    executor,
    events,
    sideEvents,
    /** A point on the plaza floor. */
    at: (x: number, z = 40, y = 151) => bot.entity.position.clone().set(x + 0.5, y, z + 0.5),
    /** Puts the bot on the plaza, healthy and empty-handed, facing east. */
    async place(x: number, z = 40, y = 151) {
      locomotion.stop();
      locomotion.setDrive({ speed: 0.4, caution: 0.3 });
      for (const command of [`clear ${name}`, `effect clear ${name}`, `effect give ${name} instant_health 1 10 true`, `effect give ${name} saturation 1 10 true`, `tp ${name} ${x + 0.5} ${y} ${z + 0.5} -90 0`]) rcon(command);
      await sleep(900);
    },
    quit() {
      locomotion.stop();
      bot.quit();
    },
  };
}

export type Body = Awaited<ReturnType<typeof joinBody>>;
