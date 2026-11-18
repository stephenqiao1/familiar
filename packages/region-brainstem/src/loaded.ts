import type { Goal, IfThen } from "@familiar/contracts";

/** A thing in view: its target id and its kind ("creeper", "chest"). */
export interface Thing {
  id: string;
  kind: string;
}

/** A loaded response fires at this urgency: above everything but a hard reflex. */
export const LOADED_URGENCY = 0.95;
/** At most one loaded response fires per this long. */
const MIN_GAP_MS = 3000;

export interface LoadedResponses {
  /**
   * Feed the goal and the things in view each tick. Returns the response to fire now (a matching
   * thing has just come into view), and any of the goal's responses that were dropped, with why
   * (reported once per goal).
   */
  observe(
    goal: Goal | null,
    inView: Thing[],
    now: number,
    sudden?: Thing | null,
    /** A full startle happened this tick: it may release a response the goal marked `onStartle`. */
    fullStartle?: boolean,
    /** Whether a prepared response can be started right now (one that cannot is not released: the body braces instead). Default: always. */
    canStart?: (rule: IfThen) => boolean,
  ): { fire: { rule: IfThen; thing: Thing | null; released?: boolean } | null; dropped?: { rule: IfThen; why: string }[] };
}

/**
 * Responses the planner loaded in advance. One fires when a thing of its kind comes into view
 * (it was not in view on the last tick), or is the source of a startle. A full startle also
 * releases the first response marked `onStartle`, whatever set it off: a prepared action goes
 * off faster when startled than it could be started on purpose. They belong to the goal:
 * a new goal replaces them. `problemWith` says why a skill may not be used (unknown, a primitive,
 * reflex-only), or null if it may.
 */
export function createLoadedResponses(problemWith: (skill: string) => string | null): LoadedResponses {
  let seen = new Set<string>();
  let lastFired = -Infinity;
  let checkedGoal: number | null = null;
  return {
    observe(goal, inView, now, sudden = null, fullStartle = false, canStart = () => true) {
      const fresh = inView.filter((t) => !seen.has(t.id));
      seen = new Set(inView.map((t) => t.id));
      const rules = goal?.ifThen ?? [];
      const usable = rules.filter((r) => problemWith(r.skill) === null);
      let dropped: { rule: IfThen; why: string }[] | undefined;
      if (goal && goal.setAt !== checkedGoal) {
        checkedGoal = goal.setAt;
        const bad = rules.filter((r) => !usable.includes(r)).map((rule) => ({ rule, why: problemWith(rule.skill)! }));
        if (bad.length) dropped = bad;
      }
      const candidates = sudden ? [sudden, ...fresh] : fresh;
      let fire: { rule: IfThen; thing: Thing | null; released?: boolean } | null = null;
      if (now - lastFired >= MIN_GAP_MS) {
        const prepared = fullStartle ? usable.find((r) => r.onStartle && canStart(r)) : undefined;
        if (prepared) {
          fire = { rule: prepared, thing: sudden, released: true };
          lastFired = now;
        }
      }
      if (!fire && now - lastFired >= MIN_GAP_MS) {
        for (const thing of candidates) {
          const rule = usable.find((r) => r.when === thing.kind);
          if (rule) {
            fire = { rule, thing };
            lastFired = now;
            break;
          }
        }
      }
      return { fire, ...(dropped ? { dropped } : {}) };
    },
  };
}
