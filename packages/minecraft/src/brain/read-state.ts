import type { Workspace } from "@familiar/contracts";
import { SCHEMA_VERSION } from "../encode/encode-state.js";
import type { MinecraftStateData } from "../encode/state-data.js";

/** The workspace's Minecraft state data, or null before the first Minecraft state arrives. */
export function minecraftData(ws: Workspace): MinecraftStateData | null {
  return ws.state.schemaVersion === SCHEMA_VERSION ? (ws.state.data as unknown as MinecraftStateData) : null;
}
