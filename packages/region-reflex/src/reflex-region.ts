import type { Proposal, Region, Workspace } from "@familiar/contracts";

/** One hard-wired reaction: look at the workspace, and propose an action or nothing. */
export interface ReflexRule {
  name: string;
  check(ws: Workspace): Proposal | null;
}

export interface ReflexOptions {
  rules: ReflexRule[];
  /** Default: "reflex". */
  name?: string;
  /** Default: 0 (the fastest layer). */
  layer?: number;
}

/**
 * The fastest region: plain rules checked every tick, no model involved. Each rule that fires
 * adds one proposal. A rule that throws is skipped and named in the trace.
 */
export function createReflexRegion({ rules, name = "reflex", layer = 0 }: ReflexOptions): Region {
  return {
    name,
    layer,
    everyMs: 0,
    run(ws) {
      const proposals: Proposal[] = [];
      const fired: string[] = [];
      const errors: Record<string, string> = {};
      for (const rule of rules) {
        try {
          const proposal = rule.check(ws);
          if (proposal) {
            proposals.push(proposal);
            fired.push(rule.name);
          }
        } catch (error) {
          errors[rule.name] = error instanceof Error ? error.message : String(error);
        }
      }
      return { proposals, trace: { fired, ...(Object.keys(errors).length ? { errors } : {}) } };
    },
  };
}
