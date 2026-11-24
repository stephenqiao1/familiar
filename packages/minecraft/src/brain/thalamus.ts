import type { State } from "@familiar/contracts";
import type { ThalamusOptions } from "@familiar/region-thalamus";
import type { MinecraftStateData } from "../encode/state-data.js";
import { createFieldOfView } from "./field-of-view.js";
import { minecraftDataOf } from "./read-state.js";
import { createSizes, splitState } from "./thalamus-channels.js";

// What the thalamus needs from the player: how a state is cut down for a deciding layer. The
// thalamus itself knows nothing about Minecraft.

/** The lists of nearby things a view is cut by (each is nearest first). */
const COUNTED = ["hazards", "mobs", "blocks", "players"] as const;

/**
 * The state with only the nearest `count` of each kind of nearby thing. What the state says
 * elsewhere about a thing that was cut (it just appeared, how the defence sized it up) goes
 * with it, so the view is what a state of the nearest `count` would have been. The same state
 * if nothing is cut.
 */
export function nearest(state: State, count: number): State {
  const data = minecraftDataOf(state);
  if (!data || COUNTED.every((list) => data.nearby[list].length <= count)) return state;
  const cut = new Set<string>();
  const nearby = { ...data.nearby };
  for (const list of COUNTED) {
    for (const thing of data.nearby[list].slice(count)) cut.add(thing.id);
    (nearby[list] as unknown[]) = data.nearby[list].slice(0, count);
  }
  nearby.sudden = data.nearby.sudden.filter((event) => !cut.has(event.id));
  // The stand-in for footsteps (an unseen hostile close by is "heard") is made from the mobs: one that was cut is not heard either.
  const unheard = data.nearby.mobs.slice(count).filter((m) => m.hostile && m.seen === false && m.bearing);
  nearby.heard = data.nearby.heard.filter((sound) => {
    if (sound.type !== "presence") return true;
    const from = unheard.findIndex((m) => m.dist === sound.dist && m.bearing!.angle === sound.bearing.angle);
    if (from < 0) return true;
    unheard.splice(from, 1);
    return false;
  });
  const defence = data.defence && { ...data.defence, threats: data.defence.threats.filter((threat) => !cut.has(threat.id)) };
  const kept: MinecraftStateData = { ...data, nearby, ...(defence ? { defence } : {}) };
  return { ...state, data: { ...kept } };
}

/** The player's part of the thalamus: the cut by count, and the field of view (one memory of what was just seen per bot). */
export function playerThalamus(): Pick<ThalamusOptions, "trim" | "inView" | "split"> {
  const view = createFieldOfView();
  // Sizes are remembered from tick to tick: a form is measured afresh only every few states.
  const sizes = createSizes();
  return { trim: nearest, inView: (state) => view.tell(state), split: (state) => splitState(state, sizes) };
}
