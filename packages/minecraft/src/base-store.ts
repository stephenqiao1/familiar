import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Vec3 } from "vec3";
import type { Base } from "./base.js";

export const DEFAULT_BASE_FILE = "data/base.json";

type Point = { x: number; y: number; z: number };

/** The saved base, or null if there is none (or it is unreadable). */
export async function loadBase(file = DEFAULT_BASE_FILE): Promise<Base | null> {
  try {
    const raw = JSON.parse(await readFile(file, "utf8")) as { chest?: Point; bed?: Point };
    if (!isPoint(raw.chest) || !isPoint(raw.bed)) return null;
    return { chest: toVec3(raw.chest), bed: toVec3(raw.bed) };
  } catch {
    return null;
  }
}

export async function saveBase(base: Base, file = DEFAULT_BASE_FILE): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const plain = { chest: toPoint(base.chest), bed: toPoint(base.bed) };
  await writeFile(file, JSON.stringify(plain, null, 2) + "\n");
}

function isPoint(p: unknown): p is Point {
  const o = p as Partial<Point> | undefined;
  return typeof o?.x === "number" && typeof o.y === "number" && typeof o.z === "number";
}

const toVec3 = (p: Point) => new Vec3(p.x, p.y, p.z);
const toPoint = (v: Vec3): Point => ({ x: v.x, y: v.y, z: v.z });
