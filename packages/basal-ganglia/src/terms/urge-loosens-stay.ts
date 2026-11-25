import type { Workspace } from "@familiar/contracts";
import type { Term } from "../term.js";

/** Works on `stay`: a body that is asking for something loosens the hold of whatever is running. */
export function urgeLoosensStay(options: { urgeOf(ws: Workspace): number }): Term {
  return { name: "urge-loosens-stay", kind: "no-go", on: "stay", amount: (_candidate, ws) => 1 - options.urgeOf(ws) };
}
