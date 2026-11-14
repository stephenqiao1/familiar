import type { Region, State, Workspace } from "@familiar/contracts";
import { createInputHealth } from "./input-health.js";
import { createPatience, OUTLOOK_SIGNAL, PATIENCE_SIGNAL } from "./patience.js";
import type { PatienceSettings } from "./settings.js";

/** One thing the outlook is made of: how good it looks right now (0 to 1), or null if unknown. */
export interface OutlookInput {
  name: string;
  read(ws: Workspace): number | null;
}

export interface PatienceOptions {
  /** The outlook is the average of these. Add or remove one to change what patience follows. */
  inputs: OutlookInput[];
  settings: Pick<PatienceSettings, "resting" | "timeConstantSeconds">;
  /** Sudden danger (a big threat, heavy damage) between two states cuts patience at once. Default: never. */
  isShock?(before: State, after: State, ws: Workspace): boolean;
  /** Extra notes for the log, e.g. which patience effect last changed a decision. */
  effects?(): Record<string, unknown>;
  /** Default: "serotonin". */
  name?: string;
  /** Default: 0 (runs inside every tick). */
  layer?: number;
}

/**
 * Serotonin: each tick it reads the outlook inputs, averages them into the outlook (0 to 1), and
 * moves patience toward it. It shares both as signals and logs every input, with a warning for
 * any input that looks broken (see input-health.ts). It never proposes an action: the arbiter,
 * the planner and the persistence check read patience (see effects.ts).
 */
export function createPatienceRegion(options: PatienceOptions): Region {
  const { inputs, settings, isShock = () => false, effects, name = "serotonin", layer = 0 } = options;
  const patience = createPatience(settings);
  const health = createInputHealth();
  let before: State | null = null;

  return {
    name,
    layer,
    everyMs: 0,
    run(ws) {
      const now = ws.state.timestamp;
      const read: Record<string, number> = {};
      const warnings: string[] = [];
      for (const input of inputs) {
        const value = input.read(ws);
        const warning = health.check(input.name, value, now);
        if (warning) warnings.push(warning);
        if (value !== null && Number.isFinite(value)) read[input.name] = Math.min(1, Math.max(0, value));
      }
      const values = Object.values(read);
      const outlook = values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null;

      const shock = before !== null && isShock(before, ws.state, ws);
      before = ws.state;
      if (shock) patience.shock();
      const level = patience.update(outlook, now);
      ws.setSignal(PATIENCE_SIGNAL, level);
      if (outlook !== null) ws.setSignal(OUTLOOK_SIGNAL, outlook);

      return {
        proposals: [],
        trace: {
          patience: level,
          outlook,
          inputs: read,
          ...(shock ? { shock: true } : {}),
          ...(warnings.length ? { warnings } : {}),
          ...effects?.(),
        },
      };
    },
  };
}
