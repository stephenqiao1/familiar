import { Vec3 } from "vec3";
import type { Direction } from "./target.js";

/** The parts of a bot's entity that say where it is and which way it faces. */
export interface Facing {
  position: Vec3;
  /** Radians, counter-clockwise; 0 faces north (-z). */
  yaw: number;
}

/** The compass direction (a unit step along x or z) the bot faces most nearly. */
export function forwardOf(yaw: number): Vec3 {
  const [x, z] = [-Math.sin(yaw), -Math.cos(yaw)];
  return Math.abs(x) > Math.abs(z) ? new Vec3(Math.sign(x), 0, 0) : new Vec3(0, 0, Math.sign(z));
}

/** One block's step in a direction relative to where the bot faces. */
export function stepOf(yaw: number, dir: Direction): Vec3 {
  const f = forwardOf(yaw);
  switch (dir) {
    case "forward":
      return f;
    case "back":
      return new Vec3(0 - f.x, 0, 0 - f.z);
    case "left":
      return new Vec3(f.z, 0, 0 - f.x);
    case "right":
      return new Vec3(0 - f.z, 0, f.x);
    case "up":
      return new Vec3(0, 1, 0);
    case "down":
      return new Vec3(0, -1, 0);
  }
}

/**
 * The neighbouring block in a direction: beside the bot's feet for forward, back, left and
 * right; the one above its head for up; the one it stands on for down.
 */
export function neighbour(entity: Facing, dir: Direction): Vec3 {
  const feet = entity.position.floored();
  if (dir === "up") return feet.offset(0, 2, 0);
  return feet.plus(stepOf(entity.yaw, dir));
}
