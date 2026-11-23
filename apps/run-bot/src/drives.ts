import type { NeedReading, Workspace } from "@familiar/contracts";

// How the hypothalamus's drives reach the rest of the brain where a line of wiring is not enough.

/** The planner is asked again for a change in what the body wants at most this often. */
const REPLAN_GAP_MS = 30_000;

/**
 * Says when the kind of need the body wants most has changed (hunger gave way to rest), so the
 * planner can be asked again. Not while danger presses (that is alarm's business, and the goal
 * is kept through it), not for the first need it ever sees, and at most once in 30 seconds.
 */
export function createDriveWatch(): { changed(ws: Workspace): boolean } {
  let kind: string | null = null;
  let askedAt = -Infinity;
  return {
    changed(ws) {
      const top = ws.needs?.top;
      if (!top || ws.needs!.readings.some((n) => n.rank > 0 && n.level > 0)) return false;
      const now = ws.state.timestamp;
      if (top.kind === kind || now - askedAt < REPLAN_GAP_MS) return false;
      const first = kind === null;
      kind = top.kind;
      if (first) return false;
      askedAt = now;
      return true;
    },
  };
}

/**
 * Stress as the outlook sees it: only the part the danger of the moment does not already account
 * for. While a threat is close the danger need darkens the outlook by itself (and alarm follows
 * it); stress adds what is left once the threat has gone. Nothing with no stress shared.
 */
export function stressOnOutlook(needs: readonly Pick<NeedReading, "level" | "rank">[], stress: number | undefined, weight = 1): { name: string; level: number; weight: number }[] {
  if (stress === undefined || weight <= 0) return [];
  const counted = Math.max(0, ...needs.filter((n) => n.rank > 0).map((n) => n.level));
  return [{ name: "stress", level: Math.max(0, stress - counted), weight }];
}

/** The mark of "this skill relieves that need" in a scorebook feature (see reliefOf). */
const RELIEVES = / ⇒ ([\w-]+)/;

/**
 * Which needs the bot has learned something relieves: any skill, anywhere, expected to pay for
 * that need. Read off the scorebook; looked up again only when the scorebook has grown or a
 * second has passed, so asking every tick costs nothing.
 */
export function createReliefIndex(scorebook: { entries(): { feature: string; expected: number }[] }, everyMs = 1000): { has(need: string): boolean } {
  let known = new Set<string>();
  let readAt = -Infinity;
  return {
    has(need) {
      const now = Date.now();
      if (now - readAt >= everyMs) {
        readAt = now;
        known = new Set(scorebook.entries().filter((e) => e.expected > 0).flatMap((e) => RELIEVES.exec(e.feature)?.[1] ?? []));
      }
      return known.has(need);
    },
  };
}
