import type { SkillResult } from "@familiar/contracts";
import type { Vec3 } from "vec3";
import type { Entity } from "../mc-types.js";

/** A way of moving, chosen from what the body senses. `dash` is the straight-line run an urgent journey uses on land. */
export type PatternName = "walk" | "swim" | "dash";
/** How fast the legs go: walking, sprinting on straight stretches, or sprinting whenever the game allows. */
export type Gait = "walk" | "jog" | "sprint";

/** The command from above: how fast, and how carefully. Both 0 to 1. */
export interface Drive {
  speed: number;
  caution: number;
}

/** What the controller reports about itself. */
export interface LocomotionStatus {
  /** A journey is under way. */
  moving: boolean;
  pattern: PatternName | null;
  gait: Gait;
  /** Trying to get unstuck, or has just given up as stuck. */
  stuck: boolean;
  /** How much of the journey's starting distance is covered, 0 to 1 (0 with no journey). */
  progress: number;
  /** Recoveries tried on the current journey. */
  recoveries: number;
}

/** Somewhere to head for: a fixed point, or one that is asked for again as the journey goes (null: stand still). */
export type Place = Vec3 | (() => Vec3 | null);

export interface GoToOptions {
  /** Close enough, in blocks. Default: 1. */
  range?: number;
  /** End where the block at the place can be seen and reached (for opening a container). */
  see?: boolean;
  /** A dash to safety: straight-line steering, always sprinting, no local recoveries (only planning again). */
  urgent?: boolean;
  /** The journey is done when this says so (instead of on arriving). */
  until?: () => boolean;
}

export interface FollowOptions {
  /** Keep within this many blocks. Default: 2. */
  range?: number;
  /** Done the first time it is within range. Default: keep following until stopped or the entity is gone. */
  once?: boolean;
}

export interface AwayOptions {
  /** Done once this far from the threat. */
  distance: number;
  /** A place to lean toward (e.g. home) when that is not toward the threat. */
  prefer?: Vec3;
  /** The journey is done when this says so (instead of on distance alone). */
  until?: () => boolean;
}

/** The head's say during a plain walk: where to look, given which way the legs are heading. Null leaves the head alone. */
export type HeadOverride = (travelYaw: number) => { yaw: number; pitch: number; keys: { forward: boolean; back: boolean; left: boolean; right: boolean } } | null;

/**
 * The locomotion controller: the one thing that travels. Higher layers give it short commands;
 * it produces the walking and swimming, corrects a stumble locally, and reports back.
 * One journey at a time: a new command replaces the current one. Every journey ends with the
 * body still and no keys held.
 */
export interface Locomotion {
  /** Travel to within range of a place. */
  goTo(place: Place, options: GoToOptions, signal: AbortSignal): Promise<SkillResult>;
  /** Keep within range of something that moves. */
  follow(entity: Entity, options: FollowOptions, signal: AbortSignal): Promise<SkillResult>;
  /** Get away from a threat. */
  awayFrom(threat: Entity, options: AwayOptions, signal: AbortSignal): Promise<SkillResult>;
  /** End travel now and release every key. */
  stop(): void;
  /** Faster, slower, more or less careful. Takes effect at once, also mid-journey. */
  setDrive(drive: Partial<Drive>): void;
  status(): LocomotionStatus;
  /** Keeps routes away from a spot for 5 minutes (somewhere that hurt). */
  avoid(spot: { x: number; y: number; z: number }): void;
  /** Forgets the stuck and avoid marks: they were for a place the bot is no longer in. */
  forget(): void;
  /** Lets something else (a held look) take the head during a plain walk; null gives it back. */
  setHeadOverride(override: HeadOverride | null): void;
}

/** What a journey is heading for, in the forms the patterns need. */
export interface Journey {
  kind: "goTo" | "follow" | "awayFrom";
  /** Where to head right now, or null to stand still. */
  aim(): Vec3 | null;
  /** Whether the journey is over. `walked`: the walk pattern says it reached its goal. `steering`: no pathfinder is in charge to say so. */
  arrived(walked: boolean, steering: boolean): boolean;
  /** The walk pattern's goal follows something that moves. */
  dynamic: boolean;
  /** Set a fresh goal this often (for a goal that keeps moving away), in ms. */
  replanMs?: number;
  /** No route at all ends the journey as failed (a moving goal just tries again). */
  failsWithoutPath: boolean;
  urgent: boolean;
  range: number;
  see: boolean;
  /** The entity being followed, if any. */
  entity?: Entity;
}
