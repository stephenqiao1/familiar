import type { State } from "@familiar/contracts";
import { SCHEMA_VERSION } from "./encode-state.js";
import type { MinecraftStateData } from "./state-data.js";

/** Every target id in the state (ores, hazards, mobs), nearest first. */
export function listTargets(state: State): string[] {
  if (state.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`listTargets needs schemaVersion ${SCHEMA_VERSION}, got ${state.schemaVersion}`);
  }
  const { ores, hazards, mobs } = (state.data as unknown as MinecraftStateData).nearby;
  return [...ores, ...hazards, ...mobs].sort((a, b) => a.dist - b.dist).map((t) => t.id);
}
