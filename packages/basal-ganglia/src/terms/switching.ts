import type { Workspace } from "@familiar/contracts";
import type { Term } from "../term.js";

/** Works on `stay`: searching makes switching easier (a smaller stay bonus), settling makes it harder. */
export function switching(options: { factorOf(ws: Workspace): number }): Term {
  return { name: "switching", kind: "go", on: "stay", amount: (_candidate, ws) => options.factorOf(ws) };
}
