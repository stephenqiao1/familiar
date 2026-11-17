import type { Bot } from "mineflayer";
import type { Vec3 } from "vec3";
import { SPEED } from "../locomotion/gait.js";
import { postureOf } from "./runtime.js";
import type { SurfaceKind, SurfaceLesson, Surfaces } from "./surfaces.js";

// Learning how surfaces behave from what happens to the bot's own body: a block that comes down
// when the one under it is dug is loose; ground it covers faster or slower than its legs should
// carry it, or slides on after stopping, is slippery or slow.

/** Another player this close may be the one changing the world. */
const SOMEONE_NEAR = 8;
/** A measured stretch: this long to get up to speed, then this long at a steady pace. */
const STRETCH = { settleMs: 400, measureMs: 1000 };
/**
 * Clearly off what the legs should manage. A jog that keeps starting and stopping its sprint
 * runs at about 0.85 of what is expected on plain stone, and at 0.78 on ice (it gets going
 * slowly there), so anything nearer than this would teach falsely.
 */
const CLEARLY = { slow: 0.7, fast: 1.3 };
/** After the legs stop the body slides a little; more than this in this long is a slippery surface. */
const SLIDE = { blocks: 1, ms: 600 };
const STRAIGHT = 0.1;
/** A block that came down has landed by this long after; it is looked for this far below where it was dug under. */
const LANDED = { afterMs: 700, below: 4 };
/** Speed and slowness (the status effects) change the pace by themselves. */
const PACE_EFFECTS = ["1", "2"];

const learners = new WeakMap<object, { surfaces: Surfaces; quiet(): boolean }>();

/** Gives a bot somewhere to keep what it learns about surfaces. `quiet`: nothing else has been changing the world just now (no explosion). */
export function setSurfaceLearner(bot: object, surfaces: Surfaces, quiet: () => boolean = () => true): void {
  learners.set(bot, { surfaces, quiet });
}

function learned(bot: object, lesson: SurfaceLesson | null, how: string): void {
  if (!lesson) return;
  const posture = postureOf(bot);
  const text = lesson.learned ? `learned that ${lesson.block} is ${lesson.kind} (${how}, ${lesson.count} times)` : `${lesson.block} ${how} (${lesson.count} time so far): not yet known to be ${lesson.kind}`;
  posture.log(`posture: ${text}`);
  if (lesson.learned) posture.note("learned", `${lesson.block} is ${lesson.kind}`);
}

/**
 * The bot broke a block and the block above it left its place. Counts toward that block type
 * being known loose, but only when it was the bot's own digging with nothing else changing
 * nearby (no other player close, no explosion just now), and only if the block really fell: with
 * `under` given (where the dug block was), it is looked for there or just below a moment later,
 * so something that merely broke off (a cactus, a plant) teaches nothing.
 */
export function sawComeDown(bot: Bot, block: string, under?: Vec3, now = Date.now()): void {
  const learner = learners.get(bot);
  if (!learner) return;
  const others = Object.values(bot.players ?? {}).some((p) => p.entity && p.entity !== bot.entity && p.entity.position.distanceTo(bot.entity.position) <= SOMEONE_NEAR);
  if (others || !learner.quiet()) {
    postureOf(bot).log(`posture: ${block} came down, but something else was changing the world nearby: nothing learned`);
    return;
  }
  const count = () => learned(bot, learner.surfaces.saw(block, "loose", now), "came down when dug under");
  if (!under) return count();
  setTimeout(() => {
    const landed = Array.from({ length: LANDED.below + 1 }, (_, d) => bot.blockAt(under.offset(0, -d, 0))?.name).includes(block);
    if (landed) count();
  }, LANDED.afterMs);
}

/**
 * What a measured pace says about a surface, if anything: clearly slower or faster than the legs
 * should manage. `sprinting`: the share of the stretch spent sprinting, 0 to 1 (or true or false).
 */
export function paceVerdict(speed: number, sprinting: boolean | number): SurfaceKind | null {
  const ratio = speed / (SPEED.walk + (SPEED.sprint - SPEED.walk) * Number(sprinting));
  return ratio < CLEARLY.slow ? "slow" : ratio > CLEARLY.fast ? "slippery" : null;
}

/**
 * Feels the ground while walking. On a straight, level stretch at a steady gait it compares the
 * pace with what the legs should manage; when the legs stop, it measures how far the body slides.
 * `walking` says whether a walked journey is under way.
 */
export function feelSurfaces(bot: Bot, walking: () => boolean): void {
  let stretch: { since: number; from: { x: number; z: number } | null; y: number; yaw: number; on: string; ticks: number; sprinted: number } | null = null;
  let slide: { at: number; from: { x: number; z: number }; y: number; on: string } | null = null;
  let wasPushing = false;
  const key = (name: "forward" | "back" | "left" | "right" | "jump" | "sneak" | "sprint") => bot.getControlState(name);

  bot.on("physicsTick", () => {
    const learner = learners.get(bot);
    if (!learner) return;
    const now = Date.now();
    const e = bot.entity as typeof bot.entity & { isInWater?: boolean; effects?: Record<string, unknown> };
    const here = e.position;
    const on = bot.blockAt(here.offset(0, -0.2, 0))?.name ?? "unknown";
    const level = e.onGround && !e.isInWater;
    const pushing = key("forward") || key("back") || key("left") || key("right");

    // The slide after the legs stop.
    if (wasPushing && !pushing && level) slide = { at: now, from: { x: here.x, z: here.z }, y: here.y, on };
    wasPushing = pushing;
    if (slide && (pushing || !level || Math.abs(here.y - slide.y) > 0.01)) slide = null;
    if (slide && now - slide.at >= SLIDE.ms) {
      if (Math.hypot(here.x - slide.from.x, here.z - slide.from.z) > SLIDE.blocks && on === slide.on) learned(bot, learner.surfaces.saw(on, "slippery", now), "slid on after stopping");
      slide = null;
    }

    // The pace on a straight, level stretch.
    const plain = walking() && level && key("forward") && !key("back") && !key("left") && !key("right") && !key("jump") && !key("sneak") && !PACE_EFFECTS.some((id) => e.effects?.[id]);
    const same = stretch !== null && stretch.on === on && Math.abs(here.y - stretch.y) < 0.01 && Math.abs(Math.atan2(Math.sin(e.yaw - stretch.yaw), Math.cos(e.yaw - stretch.yaw))) < STRAIGHT;
    if (!plain || !same) {
      stretch = plain ? { since: now, from: null, y: here.y, yaw: e.yaw, on, ticks: 0, sprinted: 0 } : null;
      return;
    }
    const run = stretch!;
    if (run.from === null) {
      if (now - run.since >= STRETCH.settleMs) Object.assign(run, { since: now, from: { x: here.x, z: here.z } });
      return;
    }
    // The gait may sprint for part of a stretch: what the legs should manage is weighed by how much.
    run.ticks++;
    if (key("sprint")) run.sprinted++;
    if (now - run.since < STRETCH.measureMs) return;
    const speed = Math.hypot(here.x - run.from.x, here.z - run.from.z) / ((now - run.since) / 1000);
    const share = run.sprinted / Math.max(1, run.ticks);
    const verdict = paceVerdict(speed, share);
    if (verdict) learned(bot, learner.surfaces.saw(on, verdict, now), `${speed.toFixed(1)} blocks a second, sprinting ${Math.round(share * 100)}% of the time`);
    stretch = null;
  });
}
