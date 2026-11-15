import type { Bot } from "mineflayer";
import type { Vec3 } from "vec3";
import { holdKey } from "./primitives/keys.js";
import { doLookAt } from "./primitives/look-at.js";

/**
 * Heads straight for a block by holding the movement keys: no pathfinding, so it works in
 * liquid, where the pathfinder plans badly. `jump` swims up in liquid, or hops a ledge. Call it
 * again as the bot moves, and let go of the keys (`releaseKeys`) when done.
 */
export async function steerToward(bot: Bot, block: Vec3 | null, jump: boolean): Promise<void> {
  holdKey(bot, "jump", jump);
  const me = bot.entity.position;
  const far = block !== null && Math.hypot(block.x + 0.5 - me.x, block.z + 0.5 - me.z) > 0.3;
  holdKey(bot, "forward", far);
  holdKey(bot, "sprint", far);
  if (far) await doLookAt(bot, block.offset(0.5, bot.entity.height, 0.5));
}
