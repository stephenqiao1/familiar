import { Vec3 } from "vec3";

/** Failing as stuck this many times, within this long and this close together, marks the spot. */
const STRIKES = 3;
const WITHIN_MS = 60_000;
const SAME_SPOT = 2;
/** A marked spot is avoided for this long, out to this many blocks. */
const AVOID_MS = 300_000;
const AVOID_RADIUS = 1.5;

/** Remembers places to keep away from for a while (where the bot keeps getting stuck, or was hurt), so routes can go round. */
export interface StuckSpots {
  /** Marks a spot to avoid at once (somewhere that hurt). */
  mark(pos: { x: number; y: number; z: number }, now: number): void;
  /** Notes a failure as stuck; returns true if this marks the spot to avoid. */
  failedAt(pos: Vec3, now: number): boolean;
  /** Whether a position is on a spot being avoided. */
  avoid(pos: { x: number; y: number; z: number }, now: number): boolean;
}

export function createStuckSpots(): StuckSpots {
  let failures: { pos: Vec3; at: number }[] = [];
  let marked: { pos: Vec3; until: number }[] = [];
  const near = (a: { x: number; y: number; z: number }, b: Vec3, d: number) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) <= d;
  return {
    mark(pos, now) {
      marked.push({ pos: new Vec3(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z)), until: now + AVOID_MS });
    },
    failedAt(pos, now) {
      failures = [...failures.filter((f) => now - f.at <= WITHIN_MS), { pos: pos.clone(), at: now }];
      if (failures.filter((f) => near(f.pos, pos, SAME_SPOT)).length < STRIKES) return false;
      failures = failures.filter((f) => !near(f.pos, pos, SAME_SPOT));
      marked.push({ pos: pos.floored(), until: now + AVOID_MS });
      return true;
    },
    avoid(pos, now) {
      marked = marked.filter((m) => m.until > now);
      return marked.some((m) => near(pos, m.pos, AVOID_RADIUS));
    },
  };
}
