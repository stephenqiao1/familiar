// First, and before the posture imports: `stance.ts` defines a primitive (sneak) while this file is still loading, and that needs the list.
import { SPECS } from "./specs.js";
import type { BodyPart, Changes, Skill, SkillResult } from "@familiar/contracts";
import { sleepFor } from "../abort.js";
import type { Entity } from "../mc-types.js";
import { resolveTarget } from "../resolve-target.js";
import { sawComeDown } from "../posture/learn.js";
import { holdStance } from "../posture/stance.js";
import type { MinecraftCtx } from "../skill-context.js";
import { parseTarget } from "../target.js";
import { doClose } from "./windows.js";
import { asExpected, type Expectation } from "./expect.js";
import { keepsMovements, learnedCheck } from "../movements.js";
import { changesBetween, takeSnapshot, type Focus } from "./snapshot.js";
import { factsNow, notePrimitive } from "./watch.js";

/** How one of the body's built-in movements is described. */
export interface PrimitiveSpec {
  name: string;
  description: string;
  /** The body parts it uses: two primitives that share one cannot run at the same time. */
  parts: BodyPart[];
  /** What changes when it works, e.g. ["targetBlock=air"] for "the target block becomes air". */
  expects: Expectation;
  /** May run for many seconds. Default: over in about one. */
  long?: boolean;
  risky?: boolean;
  /** Works with an open container, so one is left open before and after it. Default: any open one is closed. */
  usesWindow?: boolean;
  /** Sneaking changes what it does (a block used while sneaking is not opened), so no stance is held for it. */
  standing?: boolean;
  /** What it acts on when given no target (e.g. "ahead"), so the changes to that thing are watched too. */
  defaultTarget?(ctx: MinecraftCtx): string | undefined;
  /** How long to wait after it ends for the world to catch up (drops, hurt, block updates). Default: 100 ms. */
  settleMs?: number;
  canRun(ctx: MinecraftCtx, target?: string): boolean;
  run(ctx: MinecraftCtx, target: string | undefined, signal: AbortSignal): Promise<SkillResult>;
}

const SETTLE_MS = 100;

/**
 * Turns a description into a primitive skill, and wraps every run the same way:
 *   - a container left open by an earlier movement is closed first (unless this one uses it);
 *   - a snapshot is taken before and after, and what changed is reported in `changes`
 *     (with `targetAt`, where it changed a block, so an effect can be traced to the bot's own act);
 *   - stance: if it leaves the legs free and the bot is at an edge or beside something that
 *     hurts, sneak is held for as long as it runs (`changes.stance`), and let go the moment it is stopped;
 *   - `changes.asExpected` says whether the run did what the primitive says it does when it works
 *     (by its written list, or by what the cerebellum has learned it does in this situation),
 *     and the run is noted in the body's movement log (movements.ts) for the cerebellum;
 *   - an error becomes a clean failure with a reason, never a throw.
 */
export function primitive(spec: PrimitiveSpec): Skill<MinecraftCtx> {
  const { name, description, parts, long, risky, canRun } = spec;
  SPECS.set(name, { parts, expects: spec.expects, ...(spec.settleMs === undefined ? {} : { settleMs: spec.settleMs }) });
  return {
    name,
    description,
    primitive: true,
    parts,
    ...(long ? { long } : {}),
    ...(risky ? { risky } : {}),
    canRun,

    async run(ctx, target, signal) {
      const { bot } = ctx;
      if (!spec.usesWindow) await doClose(bot).catch(() => {});
      const focus = focusOf(ctx, target ?? spec.defaultTarget?.(ctx));
      let hurts = 0;
      const onHurt = (entity: Entity) => {
        if (focus.entity && entity?.id === focus.entity.id) hurts++;
      };
      bot.on("entityHurt", onHurt);
      const before = takeSnapshot(bot, focus, hurts);
      const startedAt = Date.now();
      const facts = keepsMovements(bot) ? factsNow(bot, focus) : null;
      const stance = holdStance(bot, spec, ctx.locomotion.status().moving, signal);
      let result: SkillResult;
      try {
        result = await spec.run(ctx, target, signal);
        if (result.status === "done") await sleepFor(spec.settleMs ?? SETTLE_MS, signal).catch(() => {});
      } catch (error) {
        result = signal.aborted ? { status: "interrupted" } : { status: "failed", reason: error instanceof Error ? error.message : String(error) };
      } finally {
        stance.release();
        bot.off("entityHurt", onHurt);
      }
      // A window opened in passing (a crafting table that was used, say) is not left open.
      if (!spec.usesWindow) await doClose(bot).catch(() => {});
      const changes: Changes = { ...changesBetween(before, takeSnapshot(bot, focus, hurts)), ...(stance.held ? { stance: true } : {}), ...result.changes };
      // Where it changed the world, so what happens there next can be traced to the bot's own act.
      if (focus.block && (changes.targetBlock !== undefined || changes.opened !== undefined)) changes.targetAt = `${focus.block.x},${focus.block.y},${focus.block.z}`;
      // A block the bot dug under came down: that is how it learns which blocks are loose.
      if (typeof changes.cameDown === "string" && focus.block) sawComeDown(bot, changes.cameDown, focus.block);
      // Checked against the written list, or against what experience says this movement does here (an empty list, or one experience disagrees with).
      const learned = facts && learnedCheck(bot, name, facts, parts, spec.expects);
      changes.asExpected = result.status === "done" && (learned ? learned.met(changes) : asExpected(spec.expects, changes));
      // The body's note of the movement: the cerebellum learns from it what this movement does here.
      if (facts) notePrimitive(bot, name, result.status, startedAt, facts, changes, learned ? { expects: learned.expects, why: learned.why } : undefined);
      return { ...result, changes };
    },
  };
}

/** The block or entity a target points at, for watching what happens to it. */
function focusOf(ctx: MinecraftCtx, target: string | undefined): Focus {
  const parsed = target === undefined ? null : parseTarget(target);
  const resolved = parsed && resolveTarget(ctx.bot, parsed);
  if (resolved?.kind === "block") return { block: resolved.block.position };
  if (resolved?.kind === "position") return { block: resolved.position.floored() };
  if (resolved?.kind === "entity") return { entity: resolved.entity };
  return {};
}
