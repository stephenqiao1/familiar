import type { Workspace } from "@familiar/contracts";
import type { Term } from "../term.js";

/** Works on `restraint`: a desperate need loosens the brake, by up to `most` of it. */
export function desperateEasesRestraint(options: { desperateOf(ws: Workspace): number; most: number }): Term {
  return { name: "desperate-eases-restraint", kind: "go", on: "restraint", amount: (_candidate, ws) => 1 - options.most * options.desperateOf(ws) };
}
