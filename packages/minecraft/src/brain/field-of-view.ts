import type { State, Workspace } from "@familiar/contracts";
import type { MinecraftStateData, Nearby, Sighted } from "../encode/state-data.js";
import { minecraftDataOf, sightedOf } from "./read-state.js";

// Seeing only what is in view. With this on, the deciding layers (instinct, planner) are told
// only about what the bot can see or hear, what is touching distance, and what it saw a moment
// ago. The reflexes are not affected: they read the full state.

/** Within this many blocks a thing is felt, seen or not. */
const FELT_WITHIN = 2;
/** A thing stays known this long after it leaves view. */
const REMEMBERED_MS = 10_000;

type Thing = Nearby & Partial<Sighted>;

/** One bot's memory of what it just saw. `tell` gives the state as the deciding layers should see it. */
export interface FieldOfView {
  tell(state: State): State;
}

export function createFieldOfView(): FieldOfView {
  const lastSeen = new Map<string, { at: number; where: { x: number; y: number; z: number } }>();
  let told: { of: State; state: State } | null = null;

  return {
    tell(state) {
      if (told?.of === state) return told.state;
      const data = minecraftDataOf(state);
      if (!data) return state;
      const now = state.timestamp;
      const heard = new Set(data.nearby.heard.map((h) => `${h.position.x},${h.position.y},${h.position.z}`));
      const { x, y, z } = data.self.position;
      /** Roughly where a thing is, from its bearing and distance. */
      const whereIs = (t: Thing) => {
        const heading = ((data.self.gaze.yaw + sightedOf(t).bearing.angle) * Math.PI) / 180;
        return { x: Math.round(x - Math.sin(heading) * t.dist), y, z: Math.round(z - Math.cos(heading) * t.dist) };
      };
      const known = <T extends Thing>(things: T[]): T[] =>
        things.flatMap((t) => {
          const where = whereIs(t);
          // Heard: a sound came from where it is (which is how the stand-in for footsteps reports an unseen hostile).
          const isHeard = [...heard].some((key) => {
            const [hx, , hz] = key.split(",").map(Number);
            return Math.abs(hx! - where.x) <= 1 && Math.abs(hz! - where.z) <= 1;
          });
          if (sightedOf(t).seen || isHeard || t.dist <= FELT_WITHIN) {
            lastSeen.set(t.id, { at: now, where });
            return [t];
          }
          const seen = lastSeen.get(t.id);
          return seen && now - seen.at <= REMEMBERED_MS ? [{ ...t, lastSeen: { msAgo: now - seen.at, at: seen.where } }] : [];
        });
      const nearby = { ...data.nearby, mobs: known(data.nearby.mobs), players: known(data.nearby.players), blocks: known(data.nearby.blocks) };
      for (const [id, seen] of lastSeen) if (now - seen.at > REMEMBERED_MS) lastSeen.delete(id);
      const filtered: MinecraftStateData = { ...data, nearby };
      told = { of: state, state: { ...state, data: { ...filtered } } };
      return told.state;
    },
  };
}

/** A workspace that shows a different state: what a deciding layer is told. Everything else is the real workspace. */
export function toldView(ws: Workspace, state: State): Workspace {
  return Object.create(ws, { state: { get: () => state } }) as Workspace;
}
