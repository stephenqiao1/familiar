import type { Changes } from "@familiar/contracts";
import type { Bot } from "mineflayer";
import { effectsOf } from "../body.js";
import { supportOf } from "../encode/balance.js";
import type { Entity } from "../mc-types.js";
import { keepsMovements, noteMovement, type MovementFacts } from "../movements.js";
import { changesBetween, takeSnapshot, type Focus } from "./snapshot.js";
import { SPECS } from "./specs.js";

/** The status effects that change the body's own pace. */
const PACE_EFFECTS = ["slowness", "speed"];

/** What the body senses of itself: in water, sneaking, slowed or quickened. */
export function bodyNow(bot: Bot): Pick<MovementFacts, "inWater" | "sneaking" | "body"> {
  const effect = effectsOf(bot.entity, (id) => bot.registry.effects?.[id]?.name).find((name) => PACE_EFFECTS.includes(name));
  return {
    ...((bot.entity as { isInWater?: boolean }).isInWater ? { inWater: true } : {}),
    ...(bot.getControlState("sneak") ? { sneaking: true } : {}),
    ...(effect ? { body: effect } : {}),
  };
}

/** What the body can sense of its situation as a movement begins. */
export function factsNow(bot: Bot, focus: Focus): MovementFacts {
  const support = supportOf(bot);
  const aim = focus.entity ? (focus.entity.name ?? focus.entity.type ?? undefined) : focus.block ? (bot.blockAt(focus.block)?.name ?? undefined) : undefined;
  return {
    ...(aim ? { aim } : {}),
    hand: bot.heldItem?.name ?? null,
    ground: support.on,
    surface: support.kind,
    ...bodyNow(bot),
  };
}

/** Notes a primitive run for the cerebellum, beside what the bot goes by today (the written expectations). */
export function notePrimitive(bot: Bot, name: string, status: "done" | "failed" | "interrupted", startedAt: number, facts: MovementFacts, changes: Changes, used?: { expects: readonly string[]; why: string }): void {
  const spec = SPECS.get(name);
  const { asExpected, ...caused } = changes;
  noteMovement(bot, {
    kind: "primitive",
    name,
    status,
    seconds: (Date.now() - startedAt) / 1000,
    at: Date.now(),
    facts,
    ...(spec ? { parts: spec.parts } : {}),
    changes: caused,
    ...(typeof changes.health === "number" && changes.health < 0 ? { hurt: true } : {}),
    today: { expects: spec?.expects ?? [], ...(asExpected === undefined ? {} : { asExpected }), ...(used ? { used } : {}) },
  });
}

const SETTLE_MS = 100;

/**
 * Runs one movement made inside a longer skill (a hit in a fight, a dig while digging out) and
 * notes what it changed, the way a primitive run on its own is noted. The skill is not held up:
 * the look afterwards is taken a moment later, by itself. With no movement log, it only runs.
 */
export async function watched<T>(bot: Bot, name: string, focus: Focus, run: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!keepsMovements(bot)) return run();
  const startedAt = Date.now();
  const facts = factsNow(bot, focus);
  let hurts = 0;
  const onHurt = (entity: Entity) => {
    if (focus.entity && entity?.id === focus.entity.id) hurts++;
  };
  bot.on("entityHurt", onHurt);
  const before = takeSnapshot(bot, focus, hurts);
  const after = (status: "done" | "failed" | "interrupted", wait: number) => {
    const endedAt = Date.now();
    setTimeout(() => {
      bot.off("entityHurt", onHurt);
      if (!bot.entity) return;
      notePrimitive(bot, name, status, startedAt + (Date.now() - endedAt), facts, changesBetween(before, takeSnapshot(bot, focus, hurts)));
    }, wait);
  };
  try {
    const result = await run();
    after(signal?.aborted ? "interrupted" : "done", SPECS.get(name)?.settleMs ?? SETTLE_MS);
    return result;
  } catch (error) {
    after(signal?.aborted ? "interrupted" : "failed", 0);
    throw error;
  }
}
