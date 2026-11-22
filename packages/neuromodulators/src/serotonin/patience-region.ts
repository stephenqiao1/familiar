import type { Region, Workspace } from "@familiar/contracts";
import { createPatience, OUTLOOK_SIGNAL, outlookFrom, PATIENCE_SIGNAL, type OutlookNeed } from "./patience.js";
import type { PatienceSettings } from "./settings.js";

export interface PatienceOptions {
  /** The bot's needs right now (the same ones dopamine is paid for): the outlook is worked out from them. */
  needs(ws: Workspace): (OutlookNeed & { name: string })[];
  settings: Pick<PatienceSettings, "resting" | "timeConstantSeconds">;
  /** Extra notes for the log, e.g. which patience effect last changed a decision. */
  effects?(): Record<string, unknown>;
  /** Default: "serotonin". */
  name?: string;
  /** Default: 0 (runs inside every tick). */
  layer?: number;
}

/**
 * Serotonin: each tick it reads the bot's needs, works the outlook out from them (see
 * outlookFrom), and moves patience toward it. It shares both as signals and logs every need. It
 * never proposes an action: the arbiter, the planner and the persistence check read patience
 * (see effects.ts). There is one opinion of how things stand: a need added for dopamine is
 * followed by patience with no further code.
 */
export function createPatienceRegion(options: PatienceOptions): Region {
  const { settings, effects, name = "serotonin", layer = 0 } = options;
  const patience = createPatience(settings);

  return {
    name,
    layer,
    everyMs: 0,
    run(ws) {
      const needs = options.needs(ws);
      const outlook = outlookFrom(needs);
      const level = patience.update(outlook, ws.state.timestamp);
      ws.setSignal(PATIENCE_SIGNAL, level);
      if (outlook !== null) ws.setSignal(OUTLOOK_SIGNAL, outlook);
      return { proposals: [], trace: { patience: level, outlook, needs: Object.fromEntries(needs.map((n) => [n.name, n.level])), ...effects?.() } };
    },
  };
}
