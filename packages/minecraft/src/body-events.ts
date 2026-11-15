import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import { resetBody } from "./body.js";
import type { LastHurt } from "./encode/encode-self.js";
import type { LoudEvent } from "./encode/encode-state.js";

const KEEP_LOUD_MS = 5000;

/** Things the body feels as events, not as state: being hurt, and loud bangs. */
export interface BodyEvents {
  /** When the bot was last hurt and by whom (if the game said), or null if never. */
  lastHurt(): LastHurt | null;
  /** Explosions heard in the last few seconds. */
  loud(): LoudEvent[];
}

/**
 * Listens for the bot being hurt (Mineflayer's "entityHurt", which names the attacker on 1.20+)
 * and for explosions, and keeps the body's flags right across a death.
 *
 * Explosions have no public Mineflayer event, and on 1.21.11 they do not come through
 * "soundEffectHeard" either (whose sound names are also off on that version), so this reads the
 * server's own "explosion" packet, as Mineflayer does internally.
 * TODO(senses): thunder and other loud sounds, once sound names can be trusted.
 */
export function trackBodyEvents(bot: Bot): BodyEvents {
  let lastHurt: LastHurt | null = null;
  let loud: LoudEvent[] = [];
  // `source` is missing when the damage had no attacker (a fall, fire, drowning).
  bot.on("entityHurt", (entity, source: { id: number } | undefined) => {
    if (entity?.id === bot.entity?.id) lastHurt = { at: Date.now(), by: source ? `entity:${source.id}` : null };
  });
  bot._client.on("explosion", (packet: { center?: { x: number; y: number; z: number } }) => {
    const c = packet.center;
    if (c) loud.push({ type: "explosion", position: new Vec3(c.x, c.y, c.z), at: Date.now() });
  });
  bot.on("death", () => resetBody(bot.entity));
  bot.on("spawn", () => resetBody(bot.entity));
  return {
    lastHurt: () => lastHurt,
    loud() {
      loud = loud.filter((e) => Date.now() - e.at <= KEEP_LOUD_MS);
      return loud;
    },
  };
}
