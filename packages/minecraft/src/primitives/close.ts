import { primitive } from "./primitive.js";
import { doClose } from "./windows.js";

export { doClose };

/** Closes whatever is open. */
export const close = primitive({
  name: "close",
  description: "Close the container that is open.",
  parts: ["hands"],
  expects: ["closed"],
  usesWindow: true,

  canRun(ctx) {
    return ctx.bot.currentWindow !== null;
  },

  async run(ctx) {
    if (ctx.bot.currentWindow === null) return { status: "failed", reason: "nothing is open" };
    await doClose(ctx.bot);
    return { status: "done" };
  },
});
