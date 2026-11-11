import type { DecisionEngine, Planner, Region, Skill } from "@familiar/contracts";
import { describeSituation, minerInstinct, minerReflexes } from "@familiar/minecraft";
import { createInstinctRegion } from "@familiar/region-instinct";
import { createNeocortexRegion } from "@familiar/region-neocortex";
import { createReflexRegion } from "@familiar/region-reflex";

/** What the regions are built from. */
export interface BrainParts<Ctx> {
  /** Answers the instinct region's questions. */
  engine: DecisionEngine;
  /** Makes the neocortex region's plans. */
  planner: Planner;
  skills: Skill<Ctx>[];
  ctx: Ctx;
}

/**
 * THE BRAIN: every region, in one list. Regions never call each other; they share the workspace,
 * and the arbiter picks among their proposals (highest urgency; ties go to the faster layer).
 *
 * To add a region: write it (its own package, or a file), then add one line here.
 * To run without some regions (a lesion experiment): --regions reflex,instinct
 */
export function createBrain<Ctx>({ engine, planner, skills, ctx }: BrainParts<Ctx>, only?: string[]): Region[] {
  const all: Region[] = [
    createReflexRegion({ rules: minerReflexes }), //                                       layer 0, every tick
    createInstinctRegion({ engine, ...minerInstinct(skills, ctx) }), //                     layer 1, every tick
    createNeocortexRegion({ planner, describe: (ws) => describeSituation(ws, skills) }), // layer 2, every 15 s
  ];
  if (!only) return all;
  const unknown = only.filter((name) => !all.some((r) => r.name === name));
  if (unknown.length) throw new Error(`Unknown region(s): ${unknown.join(", ")}. Use: ${all.map((r) => r.name).join(", ")}`);
  return all.filter((r) => only.includes(r.name));
}
