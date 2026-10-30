/** A parsed target string. One format for every skill. */
export type Target =
  | { kind: "nearest"; name: string }
  | { kind: "pos"; x: number; y: number; z: number }
  | { kind: "entity"; id: number }
  | { kind: "player"; username: string };

const NAME = /^[a-z0-9_]+$/;
const USERNAME = /^[A-Za-z0-9_]{1,16}$/;

/**
 * Parses "nearest:<name>", "pos:x,y,z", "entity:<id>" or "player:<username>".
 * Returns null for anything else.
 */
export function parseTarget(str: string): Target | null {
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
    default:
      return null;
  }
}
