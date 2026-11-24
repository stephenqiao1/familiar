// Priority: how much an item matters right now, 0 to 1. The channel gives the base (the driver:
// the message itself); modulators raise or lower it, each with a weight in one table. A
// modulator never makes a message, it only sets how much of one passes.

/** What is known about one item, in plain numbers. */
export interface Facts {
  /** Its channel's base, 0 to 1. */
  base: number;
  /** It is the thing being attended to. */
  attended?: boolean;
  /** It is what the running skill is aimed at. */
  target?: boolean;
  /** How pressing a threat: 0 none, 1 seen, 2 coming or on the body. */
  threat?: number;
  /** The planner asked to be told of it. */
  asked?: boolean;
  /** How much it is wanted right now, 0 to 1. */
  wanted?: number;
  /** The goal is watching for its kind. */
  watched?: boolean;
  /** New or just changed. */
  fresh?: boolean;
  /** Blocks away. */
  dist?: number;
  /** How far it has been got used to, 0 (not at all) to 1. */
  usedTo?: number;
}

/** How much each modulator adds at full strength. Change what matters to a decider here. */
export const WEIGHTS = { attended: 0.5, target: 0.5, threatSeen: 0.35, threatComing: 0.6, asked: 0.3, wanted: 0.3, watched: 0.25, fresh: 0.2, near: 0.15, usedTo: -0.25 };
/** Nearness fades to nothing at this distance. */
export const NEAR_WITHIN = 16;

/** How strong each steerable modulator is, 0 to 1 (the bot's settings). */
export interface Strengths {
  spotlight: number;
  threats: number;
  wants: number;
  detail: number;
}

const clamp = (n: number) => Math.min(1, Math.max(0, n));

/** An item's priority, and which modulators moved it (in the order of the table). */
export function priorityOf(facts: Facts, strengths: Strengths): { priority: number; by: string[] } {
  const by: string[] = [];
  let priority = facts.base;
  const move = (name: string, amount: number) => {
    if (amount === 0) return;
    priority += amount;
    by.push(name);
  };
  move("attended", facts.attended ? WEIGHTS.attended * strengths.spotlight : 0);
  move("target", facts.target ? WEIGHTS.target * strengths.spotlight : 0);
  move("threat", ((facts.threat ?? 0) >= 2 ? WEIGHTS.threatComing : (facts.threat ?? 0) >= 1 ? WEIGHTS.threatSeen : 0) * strengths.threats);
  move("asked", facts.asked ? WEIGHTS.asked * strengths.detail : 0);
  move("wanted", WEIGHTS.wanted * clamp(facts.wanted ?? 0) * strengths.wants);
  move("watched", facts.watched ? WEIGHTS.watched : 0);
  move("fresh", facts.fresh ? WEIGHTS.fresh : 0);
  move("near", facts.dist === undefined ? 0 : WEIGHTS.near * clamp(1 - facts.dist / NEAR_WITHIN));
  move("used to", WEIGHTS.usedTo * clamp(facts.usedTo ?? 0));
  return { priority: clamp(priority), by };
}
