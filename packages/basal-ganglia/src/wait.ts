import type { Candidate, Workspace } from "@familiar/contracts";
import type { Settled } from "./choose.js";
import type { Scored } from "./score.js";
import { sameAction, skillOf } from "./term.js";

// Waiting on a near tie. When the top two in a contest are different actions with scores almost
// the same, choosing at once is a coin toss that the next tick may toss the other way. So whatever
// is running is kept for a moment; if the tie is still there when the time is up, it is settled
// by rule, and the settlement stands for as long as the same two stay that close.

export const WAIT = {
  /** Scores this close are a near tie (at full strength). */
  margin: 0.05,
  /** A wait never lasts longer, in ms. */
  mostMs: 300,
  /** A request of the body above this urgency is never held back by a wait. */
  bodyAbove: 0.8,
};

export type How = "faster layer" | "already running" | "higher go total" | "higher score";

/** One near tie, for the log. */
export interface Conflict {
  channel: string;
  between: [Candidate, Candidate];
  /** 0 to 1: 1 with the scores equal. */
  closeness: number;
  /** How long this near tie has lasted. */
  ms: number;
  state: "waiting" | "settled";
  how?: How;
  /** Who was given the go-ahead (waiting: whatever is running, or nobody). */
  kept: Candidate | null;
}

export interface WaiterOptions {
  /** 0 to 1: how wide a near tie is, as a share of the full margin (0: never wait). */
  strength: number;
  /** Something is on the bot right now: nothing waits. Default: never. */
  pressing?(ws: Workspace): boolean;
}

export interface Waiter {
  /** The winner of one channel's contest after waiting has had its say, and the near tie if there is one. */
  decide(channel: string, result: Settled, ws: Workspace): { winner: Candidate | null; conflict: Conflict | null };
  /** In how many ms the longest-running wait must be settled, or null with none. */
  dueInMs(now: number): number | null;
}

const key = (c: Candidate) => `${c.region}|${skillOf(c) ?? "-"}|${"target" in c.action ? (c.action.target ?? "") : ""}`;
const running = (c: Candidate, ws: Workspace) => ws.current !== null && skillOf(c) === ws.current.skill && ("target" in c.action ? c.action.target : undefined) === ws.current.target;

/** The top two by score (ties to the faster layer, then the first listed). */
function topTwo(scored: readonly Scored[]): [Scored, Scored] | null {
  const order = scored.map((s, at) => ({ s, at })).sort((a, b) => b.s.score - a.s.score || a.s.candidate.layer - b.s.candidate.layer || a.at - b.at);
  return order.length >= 2 ? [order[0]!.s, order[1]!.s] : null;
}

/** Faster layer; then the one already running; then the higher go total; then the higher score. */
export function settleTie(top: Scored, second: Scored, ws: Workspace): { winner: Scored; how: How } {
  if (top.candidate.layer !== second.candidate.layer) return { winner: top.candidate.layer < second.candidate.layer ? top : second, how: "faster layer" };
  const [a, b] = [running(top.candidate, ws), running(second.candidate, ws)];
  if (a !== b) return { winner: a ? top : second, how: "already running" };
  if (top.go !== second.go) return { winner: top.go > second.go ? top : second, how: "higher go total" };
  return { winner: top, how: "higher score" };
}

export function createWaiter({ strength, pressing }: WaiterOptions): Waiter {
  /** The near tie under way in each channel: between whom, since when, and who was given it once settled. */
  const episodes = new Map<string, { pair: string; since: number; settled?: { winner: string; how: How } }>();
  return {
    decide(channel, result, ws) {
      const two = strength > 0 && !result.urgent ? topTwo(result.scored) : null;
      const gap = two ? two[0].score - two[1].score : Infinity;
      const margin = WAIT.margin * strength;
      const bodyAsks = two?.some((s) => s.candidate.layer === 0 && s.candidate.urgency > WAIT.bodyAbove) ?? false;
      if (!two || gap >= margin || sameAction(two[0].candidate, two[1].candidate) || bodyAsks || pressing?.(ws)) {
        episodes.delete(channel);
        return { winner: result.winner, conflict: null };
      }
      const now = ws.state.timestamp;
      const pair = two.map((s) => key(s.candidate)).sort().join(" / ");
      let episode = episodes.get(channel);
      if (episode?.pair !== pair) episodes.set(channel, (episode = { pair, since: now }));
      const ms = now - episode.since;
      const conflict = { channel, between: [two[0].candidate, two[1].candidate] as [Candidate, Candidate], closeness: 1 - gap / margin, ms };
      if (!episode.settled && ms >= WAIT.mostMs) {
        const { winner, how } = settleTie(two[0], two[1], ws);
        episode.settled = { winner: key(winner.candidate), how };
      }
      if (episode.settled) {
        const kept = two.find((s) => key(s.candidate) === episode.settled!.winner)!.candidate;
        return { winner: kept, conflict: { ...conflict, state: "settled", how: episode.settled.how, kept } };
      }
      // Waiting: whatever is running keeps going. If it is in the vote it is the winner; otherwise nobody is.
      const kept = result.scored.find((s) => running(s.candidate, ws))?.candidate ?? null;
      return { winner: kept, conflict: { ...conflict, state: "waiting", kept } };
    },
    dueInMs(now) {
      const waits = [...episodes.values()].filter((e) => !e.settled).map((e) => Math.max(0, e.since + WAIT.mostMs - now));
      return waits.length ? Math.min(...waits) : null;
    },
  };
}
