import type { DecisionEngine } from "@familiar/contracts";
import { EchoEngine } from "@familiar/engine-echo";
import { JevEngine } from "@familiar/engine-jev";
import type { EngineName } from "./args.js";

export function createEngine(name: EngineName): DecisionEngine {
  return name === "jev" ? new JevEngine() : new EchoEngine();
}
