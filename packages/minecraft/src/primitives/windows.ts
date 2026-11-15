import type { Bot } from "mineflayer";

/** A container the bot has opened: what `bot.openContainer` gives back (it can be put into and taken from). */
export type OpenContainer = Awaited<ReturnType<Bot["openContainer"]>>;

/** The container each bot has open through `doOpen`, so later movements can use or close it. */
const open = new WeakMap<Bot, OpenContainer>();

/** Notes the container a bot has just opened. */
export function rememberOpen(bot: Bot, container: OpenContainer): void {
  open.set(bot, container);
}

/** The container the bot has open, or null. */
export function openContainerOf(bot: Bot): OpenContainer | null {
  const container = open.get(bot);
  return container && bot.currentWindow?.id === container.id ? container : null;
}

/** Closes whatever window is open (a container, a crafting table). Does nothing if none is. */
export async function doClose(bot: Bot): Promise<void> {
  const window = bot.currentWindow;
  open.delete(bot);
  if (window) await bot.closeWindow(window);
}
