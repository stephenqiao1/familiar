import { connect, DEFAULT_BASE_FILE, setupBase, type Base } from "@familiar/minecraft";
import type { ServerArgs } from "./args.js";

type Bot = Awaited<ReturnType<typeof connect>>;

/** Joins the server and finds (or builds) the base. Logs out again if the base can't be set up. */
export async function joinWithBase({ host, port, name }: ServerArgs): Promise<{ bot: Bot; base: Base }> {
  const bot = await connect({ host, port, username: name });
  const base = await setupBase(bot).catch((error: unknown) => {
    bot.quit();
    throw error;
  });
  console.log(`Joined ${host}:${port} as ${name}.`);
  console.log(`Base: chest at ${base.chest}, bed at ${base.bed} (saved to ${DEFAULT_BASE_FILE})`);
  return { bot, base };
}
