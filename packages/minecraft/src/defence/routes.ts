// The two route questions the defence circuit asks: can this threat get to the bot, and has the
// bot a way out? Each is real pathfinding, so they are capped hard: only the nearest two threats,
// each question at most once a second per threat, a little work per tick, and every answer is
// kept until a newer one replaces it. This file is the cap and the cache; the pathfinder is
// asked by locomotion/route-queries.ts.

export type Answer = "yes" | "no" | "unsure";
/** One question under way: each call does one small slice of work and says the answer, or "more". */
export type Query = () => Answer | "more";

/** Starts a question about one creature (by its entity id); null if it cannot be asked (the creature is gone). */
export interface RouteQueries {
  reach(id: number): Query | null;
  escape(id: number): Query | null;
}

/** Only this many threats, nearest first, are asked about. */
export const MAX_THREATS = 2;
/** Each question is asked at most this often for one threat. */
export const ASK_EVERY_MS = 1000;
/** At most this many slices of work each time the state is read (about a millisecond of thinking; the state is read about ten times a second). */
export const SLICES_PER_TICK = 1;
/** A question that has not answered after this many slices is dropped as unsure. */
export const MAX_SLICES = 16;
/** An answer about a creature not asked about for this long is forgotten. */
const FORGET_MS = 30_000;

type Kind = "reach" | "escape";
interface Slot {
  answer: boolean | null;
  askedAt: number;
  query: Query | null;
  slices: number;
}

export interface RouteChecks {
  /** Does this tick's share of work for the nearest threats. `busy`: the pathfinder is planning a journey, so nothing is asked. */
  work(nearest: readonly number[], now: number, busy: boolean): void;
  /** The last answer, or null if there is none yet. */
  canReach(id: number): boolean | null;
  escapable(id: number): boolean | null;
  /** How the checks have gone, for the log. */
  stats(): { asked: number; answered: number; unsure: number; skippedBusy: number };
}

export function createRouteChecks(queries: RouteQueries): RouteChecks {
  const slots = new Map<string, Slot>();
  const seen = new Map<number, number>();
  const counts = { asked: 0, answered: 0, unsure: 0, skippedBusy: 0 };
  let turn = 0;
  const slot = (kind: Kind, id: number) => {
    const key = `${kind}:${id}`;
    if (!slots.has(key)) slots.set(key, { answer: null, askedAt: -Infinity, query: null, slices: 0 });
    return slots.get(key)!;
  };

  return {
    work(nearest, now, busy) {
      const ids = nearest.slice(0, MAX_THREATS);
      for (const id of ids) seen.set(id, now);
      for (const [id, at] of seen) {
        if (now - at <= FORGET_MS) continue;
        seen.delete(id);
        slots.delete(`reach:${id}`);
        slots.delete(`escape:${id}`);
      }
      if (busy) return void (ids.length && counts.skippedBusy++);
      const jobs = ids.flatMap((id) => (["reach", "escape"] as const).map((kind) => ({ kind, id, slot: slot(kind, id) })));
      let slices = 0;
      // Take turns, so one slow question does not starve the others.
      for (let i = 0; i < jobs.length && slices < SLICES_PER_TICK; i++) {
        const job = jobs[(turn + i) % jobs.length]!;
        const s = job.slot;
        if (!s.query) {
          if (now - s.askedAt < ASK_EVERY_MS) continue;
          s.query = queries[job.kind](job.id);
          s.askedAt = now;
          s.slices = 0;
          if (!s.query) continue;
          counts.asked++;
        }
        slices++;
        s.slices++;
        const said = s.query();
        if (said === "more" && s.slices < MAX_SLICES) continue;
        s.query = null;
        if (said === "yes" || said === "no") {
          s.answer = said === "yes";
          counts.answered++;
        } else counts.unsure++;
      }
      turn++;
    },
    canReach: (id) => slots.get(`reach:${id}`)?.answer ?? null,
    escapable: (id) => slots.get(`escape:${id}`)?.answer ?? null,
    stats: () => ({ ...counts }),
  };
}
