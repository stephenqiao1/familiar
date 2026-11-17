import type { Bot } from "mineflayer";
import type { Gut } from "./gut.js";
import { nearestHostile } from "./mobs.js";

/** A hostile mob this close could have caused an illness (a witch's potion, a cave spider's bite). */
const HOSTILE_NEAR = 8;

/**
 * Tells the gut whenever a harmful effect starts on the bot's own body, so it can learn which
 * foods make the bot ill. `harmful` says which effects count; `log` gets each thing learned or
 * worth saying.
 */
export function trackGut(bot: Bot, gut: Gut, harmful: (effect: string) => boolean, log: (msg: string) => void): void {
  const has = new Set<string>();
  const nameOf = (id: number) => bot.registry.effects[id]?.name.toLowerCase().replace(/\s+/g, "_");
  bot.on("entityEffect", (entity, effect) => {
    const name = entity === bot.entity ? nameOf(effect.id) : undefined;
    if (!name || !harmful(name)) return;
    const fresh = !has.has(name);
    has.add(name);
    const lesson = gut.fellIll(name, Date.now(), fresh, nearestHostile(bot, HOSTILE_NEAR) !== null);
    if (lesson.learned) log(`learned that ${lesson.blamed} is bad to eat (${name} has followed it ${lesson.count} times)`);
    else if (lesson.note) log(lesson.note);
    else if (lesson.count) log(`${name} followed eating ${lesson.blamed} (${lesson.count} time so far): not yet known to be bad`);
  });
  bot.on("entityEffectEnd", (entity, effect) => {
    const name = entity === bot.entity ? nameOf(effect.id) : undefined;
    if (name) has.delete(name);
  });
  bot.on("death", () => has.clear());
}
