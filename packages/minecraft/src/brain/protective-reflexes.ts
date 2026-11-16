import type { Workspace } from "@familiar/contracts";
import { SORE_SIGNAL } from "@familiar/region-brainstem";
import type { ReflexRule } from "@familiar/region-reflex";
import type { MinecraftStateData } from "../encode/state-data.js";
import { INNATE_HURTS } from "../safety.js";
import { minecraftDataOf } from "./read-state.js";

// The body's fastest protections. Withdrawal pulls the bot away from whatever is hurting it,
// without knowing what it is. The stretch reflex holds its position when something moves it
// toward harm. Every number is a first guess to tune in play.

/** One bot's protective reflexes. The hard ones are on (1) or off (0, for experiments); the soft ones and the learning are 0 to 1. */
export interface ReflexSettings {
  /** What the bot is born knowing hurts. Anything else it has to learn by being hurt. */
  innateHurts: string[];
  /** Hard: pull away from whatever just hurt. */
  painWithdrawal: number;
  /** Hard: get out from inside a block. */
  buried: number;
  /** Hard: stop before touching something that hurts. */
  aboutToTouch: number;
  /** Soft: hold ground when pushed toward harm (scales its urgency). */
  holdGround: number;
  /** Soft: stop short of a big drop when stepping toward it (scales its urgency). */
  edgeGuard: number;
  /** Learn which blocks hurt from being hurt by them. */
  learnHurts: number;
  /** Be more sensitive for 30 seconds after pain. */
  sensitise: number;
}

export const DEFAULT_REFLEXES: ReflexSettings = { innateHurts: INNATE_HURTS, painWithdrawal: 1, buried: 1, aboutToTouch: 1, holdGround: 1, edgeGuard: 1, learnHurts: 1, sensitise: 1 };

const HARD = ["painWithdrawal", "buried", "aboutToTouch"] as const;
const SOFT = ["holdGround", "edgeGuard", "learnHurts", "sensitise"] as const;

/** What is wrong with the settings, or null if they are fine. */
export function reflexesProblem(s: ReflexSettings): string | null {
  if (!Array.isArray(s.innateHurts) || s.innateHurts.some((name) => typeof name !== "string")) return "reflexes.innateHurts must be a list of block names";
  for (const key of HARD) if (s[key] !== 0 && s[key] !== 1) return `reflexes.${key} must be 0 or 1 (a hard reflex is on or off), got ${s[key]}`;
  for (const key of SOFT) if (!(s[key] >= 0 && s[key] <= 1)) return `reflexes.${key} must be 0 to 1, got ${s[key]}`;
  return null;
}

/** A hurt this fresh still calls for pulling away. */
const FRESH_MS = 600;
/** Once this far from where it hurt, the pulling away is done. */
const CLEAR_OF_IT = 2;
/**
 * Kinds of damage with nothing to pull away from, or with a reflex of their own: falling (too
 * late), drowning and starving (not a place), lava and fire (in_lava_or_fire), being inside a
 * block (buried), and harm that travels with the body (poison, wither, the void).
 */
const NOT_A_PLACE = new Set(["fall", "fly_into_wall", "drown", "starve", "lava", "in_fire", "on_fire", "in_wall", "magic", "indirect_magic", "wither", "out_of_world", "generic_kill"]);
/** The skills only reflexes run. While one of them is running, the soft protections keep quiet. */
export const REFLEX_SKILLS = ["escape_hazard", "surface", "withdraw", "dig_out", "recoil"];
/** How far ahead about_to_touch looks: 1 block, or 2 while sore. */
const LOOK = { normal: 1, sore: 2 };
const HOLD_GROUND = { base: 0.8, sore: 0.9 };
const EDGE_GUARD = 0.6;

type Self = MinecraftStateData["self"];
const sore = (ws: Workspace) => (ws.signals[SORE_SIGNAL]?.value ?? 0) > 0;
/** The pathfinder is walking a planned route: it has already allowed for what lies ahead. */
const onPlannedRoute = (self: Self) => self.locomotion.moving && self.locomotion.pattern === "walk";
const reflexRunning = (data: MinecraftStateData) => data.current !== null && (REFLEX_SKILLS.includes(data.current.skill) || data.current.skill === "steady");
/** The spot `blocks` back the way the body came, as a target. */
function backFrom(self: Self, toward: { x: number; z: number }, blocks = 1): string {
  const { x, y, z } = self.position;
  return `pos:${(x + 0.5 - toward.x * blocks).toFixed(1)},${y},${(z + 0.5 - toward.z * blocks).toFixed(1)}`;
}

/** A rule that reads the Minecraft state (and the workspace); silent before the first state arrives. */
function rule(name: string, kind: ReflexRule["kind"], check: (data: MinecraftStateData, ws: Workspace) => ReturnType<ReflexRule["check"]>): ReflexRule {
  return {
    name,
    kind,
    check(ws) {
      const data = minecraftDataOf(ws.state);
      return data ? check(data, ws) : null;
    },
  };
}

// Hard reflexes. Their urgency is always 1.

/**
 * Just hurt, by a place and not by an attacker: pull away, before knowing what it was. It keeps
 * firing while the withdrawal runs, so nothing takes over half way.
 */
export const painWithdrawal = rule("pain_withdrawal", "hard", ({ self, current }) => {
  if (current?.skill === "withdraw") return { action: { skill: "withdraw" }, urgency: 1, reason: "still pulling away" };
  const hurt = self.lastHurt;
  if (!hurt || hurt.msAgo > FRESH_MS || hurt.by !== null || NOT_A_PLACE.has(hurt.kind ?? "")) return null;
  const { x, y, z } = self.position;
  if (Math.hypot(x - hurt.at.x, y - hurt.at.y, z - hurt.at.z) >= CLEAR_OF_IT) return null;
  return { action: { skill: "withdraw" }, urgency: 1, reason: `hurt${hurt.kind ? ` (${hurt.kind})` : ""} at ${hurt.at.x},${hurt.at.y},${hurt.at.z}` };
});

/** The head is inside a block: get out. */
export const buried = rule("buried", "hard", ({ self }) => (self.inBlock ? { action: { skill: "dig_out" }, urgency: 1, reason: `head inside ${self.touching.head}` } : null));

/**
 * About to touch something that hurts: the body is moving (by a single step, a push, anything
 * that is not a planned route) and the next block that way is lava, fire or a block known to
 * hurt. Stop at once and step back. While sore it looks 2 blocks ahead.
 */
export const aboutToTouch = rule("about_to_touch", "hard", (data, ws) => {
  const { self } = data;
  const moving = self.pushed ?? self.motion;
  const danger = moving?.danger;
  if (!moving || !danger || danger.what === "drop" || onPlannedRoute(self) || (data.current !== null && REFLEX_SKILLS.includes(data.current.skill))) return null;
  if (danger.blocks > (sore(ws) ? LOOK.sore : LOOK.normal)) return null;
  return { action: { skill: "recoil", target: backFrom(self, moving.toward) }, urgency: 1, reason: `${danger.what} ${danger.blocks} block${danger.blocks > 1 ? "s" : ""} ahead` };
});

// SLOT(falling): no reflex. Once the body is in the air there is nothing it can do; the
// protection is before the edge (edge_guard, hold_ground). A water-bucket landing or similar
// would go here if the body ever learns one.

// Soft reflexes (the stretch reflex). The brainstem scales them, and a goal can hold them back.

/** Pushed toward a big drop, lava, fire or a block known to hurt within 2 blocks: sneak and step back to where it stood. */
export function holdGround(strength: number): ReflexRule {
  return rule("hold_ground", "soft", (data, ws) => {
    const pushed = data.self.pushed;
    if (!pushed?.danger || reflexRunning(data)) return null;
    const base = sore(ws) ? HOLD_GROUND.sore : HOLD_GROUND.base;
    return {
      action: { skill: "steady", target: backFrom(data.self, pushed.toward, Math.max(1, pushed.blocks)) },
      urgency: base * strength,
      reason: `pushed ${pushed.blocks} blocks toward ${pushed.danger.what === "drop" ? "a drop" : pushed.danger.what}`,
    };
  });
}

/** Stepping (not on a planned route) toward a drop of 3 or more within 1 block: stop and step back. */
export function edgeGuard(strength: number): ReflexRule {
  return rule("edge_guard", "soft", (data) => {
    const { self } = data;
    const danger = self.motion?.danger;
    if (!self.motion || self.pushed || danger?.what !== "drop" || danger.blocks > 1 || onPlannedRoute(self) || reflexRunning(data)) return null;
    return { action: { skill: "steady", target: backFrom(self, self.motion.toward) }, urgency: EDGE_GUARD * strength, reason: "a drop one block ahead" };
  });
}

/** The protective reflexes this bot has switched on: the hard ones, then the soft ones. */
export function protectiveReflexes(settings: ReflexSettings): { hard: ReflexRule[]; soft: ReflexRule[] } {
  return {
    hard: [...(settings.painWithdrawal ? [painWithdrawal] : []), ...(settings.buried ? [buried] : []), ...(settings.aboutToTouch ? [aboutToTouch] : [])],
    soft: [...(settings.holdGround > 0 ? [holdGround(settings.holdGround)] : []), ...(settings.edgeGuard > 0 ? [edgeGuard(settings.edgeGuard)] : [])],
  };
}
