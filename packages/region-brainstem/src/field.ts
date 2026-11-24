// Where on the map a thing sits, up and down: the map has two dimensions, and the upper and
// lower fields mean different things (see lean.ts). Change what counts as overhead here.

/** The part of the view a thing is in. */
export type Field = "upper" | "lower" | "level";

/** More than this many degrees above eye level is the upper field; more than this many below, the lower. */
export const FIELD_BEYOND = { up: 20, down: 20 };

/** The field for an elevation in degrees (above eye level is positive). */
export function fieldOf(elevation: number): Field {
  return elevation > FIELD_BEYOND.up ? "upper" : elevation < -FIELD_BEYOND.down ? "lower" : "level";
}

/** The jump the head would make to a thing: degrees sideways (left is positive) and up or down from where it points now. */
export function jumpTo(thing: { angle: number; elevation: number }, pitch: number): { sideways: number; upDown: number } {
  return { sideways: Math.round(thing.angle), upDown: Math.round(thing.elevation - pitch) };
}
