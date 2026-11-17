import type { Proposal, Region, Workspace } from "@familiar/contracts";

/** A soft reflex can never reach full urgency, so it always competes and never wins outright. */
export const SOFT_CAP = 0.95;
/** The highest urgency any reflex proposed this tick: 0 if none fired, 1 if a hard one did. */
export const REFLEX_SIGNAL = "reflex";

/**
 * One wired-in reaction: look at the workspace, and propose an action or nothing.
 * - hard: life-saving. Always proposed at urgency 1; never scaled, never held back.
 * - soft: tunable. The rule gives a base urgency; the region multiplies it by a gain and caps it
 *   below 1, so the rest of the brain can outvote it.
 */
export interface ReflexRule {
  name: string;
  kind: "hard" | "soft";
  check(ws: Workspace): Proposal | null;
}

/** One fired rule, as logged. */
export interface FiredReflex {
  rule: string;
  kind: "hard" | "soft";
  skill: string | null;
  /** The urgency the rule itself gave. */
  base: number;
  gain: number;
  /** The urgency proposed. */
  urgency: number;
}

export interface ReflexOptions {
  rules: ReflexRule[];
  /** How strongly a soft rule fires right now (e.g. set by the brainstem). Default: 1. Ignored for hard rules. */
  gainOf?(rule: ReflexRule, ws: Workspace, proposal: Proposal): number;
  /** Default: "reflex". */
  name?: string;
  /** Default: 0 (the fastest layer). */
  layer?: number;
}

/**
 * Checks each rule once and scales what fires: a hard rule to urgency 1, a soft rule to its base
 * urgency times its gain, capped below 1. A rule that throws is skipped and named in `errors`.
 * Any region that runs reflex-like rules uses this, so they all behave the same.
 */
export function fireRules(rules: readonly ReflexRule[], ws: Workspace, gainOf: NonNullable<ReflexOptions["gainOf"]> = () => 1): { proposals: Proposal[]; fired: FiredReflex[]; errors: Record<string, string> } {
  const proposals: Proposal[] = [];
  const fired: FiredReflex[] = [];
  const errors: Record<string, string> = {};
  for (const rule of rules) {
    try {
      const proposal = rule.check(ws);
      if (!proposal) continue;
      const gain = rule.kind === "hard" ? 1 : gainOf(rule, ws, proposal);
      const urgency = rule.kind === "hard" ? 1 : Math.min(SOFT_CAP, Math.max(0, proposal.urgency * gain));
      proposals.push({ ...proposal, urgency });
      fired.push({ rule: rule.name, kind: rule.kind, skill: "skill" in proposal.action ? proposal.action.skill : null, base: proposal.urgency, gain, urgency });
    } catch (error) {
      errors[rule.name] = error instanceof Error ? error.message : String(error);
    }
  }
  return { proposals, fired, errors };
}

/**
 * The fastest region: plain rules checked every tick, no model involved. Each rule that fires
 * adds one proposal. A rule that throws is skipped and named in the trace.
 */
export function createReflexRegion({ rules, gainOf = () => 1, name = "reflex", layer = 0 }: ReflexOptions): Region {
  return {
    name,
    layer,
    everyMs: 0,
    run(ws) {
      const { proposals, fired, errors } = fireRules(rules, ws, gainOf);
      ws.setSignal(REFLEX_SIGNAL, Math.max(0, ...fired.map((f) => f.urgency)));
      return { proposals, trace: { fired: fired.map((f) => f.rule), rules: fired, ...(Object.keys(errors).length ? { errors } : {}) } };
    },
  };
}
