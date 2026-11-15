/** A direction relative to where the bot faces. */
export type Direction = "forward" | "back" | "left" | "right" | "up" | "down";
export const DIRECTIONS: readonly Direction[] = ["forward", "back", "left", "right", "up", "down"];

/** A parsed target string. One format for every skill. */
export type Target =
  | { kind: "nearest"; name: string }
  | { kind: "pos"; x: number; y: number; z: number }
  | { kind: "entity"; id: number }
  | { kind: "player"; username: string }
  /** Whatever the bot is looking at, within reach. Needs no name. */
  | { kind: "ahead" }
  /** The neighbouring block in a direction relative to where the bot faces. Needs no name. */
  | { kind: "dir"; dir: Direction }
  /** The item in hand. Needs no name. */
  | { kind: "held" }
  /** An item by name; `way` says into or out of an open container (for move_item). */
  | { kind: "item"; name: string; way?: "in" | "out" };

const NAME = /^[a-z0-9_]+$/;
const USERNAME = /^[A-Za-z0-9_]{1,16}$/;

/**
 * Parses "nearest:<name>", "pos:x,y,z", "entity:<id>", "player:<username>", "ahead",
 * "dir:<forward|back|left|right|up|down>", "held", or "item:<name>" (optionally "item:<name>:in"
 * or ":out"). Returns null for anything else.
 */
export function parseTarget(str: string): Target | null {
  const whole = str.trim();
  if (whole === "ahead" || whole === "held") return { kind: whole };
  const sep = str.indexOf(":");
  if (sep < 0) return null;
  const kind = str.slice(0, sep);
  const rest = str.slice(sep + 1).trim();

  switch (kind) {
    case "nearest":
      return NAME.test(rest) ? { kind, name: rest } : null;
    case "pos": {
      const parts = rest.split(",").map((p) => p.trim());
      if (parts.length !== 3 || parts.some((p) => p === "")) return null;
      const [x, y, z] = parts.map(Number) as [number, number, number];
      return [x, y, z].every(Number.isFinite) ? { kind, x, y, z } : null;
    }
    case "entity":
      return /^\d+$/.test(rest) ? { kind, id: Number(rest) } : null;
    case "player":
      return USERNAME.test(rest) ? { kind, username: rest } : null;
    case "dir":
      return DIRECTIONS.includes(rest as Direction) ? { kind, dir: rest as Direction } : null;
    case "item": {
      const [name = "", way, ...more] = rest.split(":");
      if (!NAME.test(name) || more.length > 0) return null;
      if (way === undefined) return { kind, name };
      return way === "in" || way === "out" ? { kind, name, way } : null;
    }
    default:
      return null;
  }
}
