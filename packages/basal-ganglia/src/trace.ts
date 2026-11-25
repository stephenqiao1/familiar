import type { Candidate } from "@familiar/contracts";
import type { Contests } from "./channels.js";
import type { Settled } from "./choose.js";
import type { Effect, Scored } from "./score.js";
import type { Conflict } from "./wait.js";

// What a choice weighed, in the shape that goes in the tick log.

export const round = (x: number) => Math.round(x * 1000) / 1000;
export const say = (e: Effect) => `${e.term} ${e.kind === "go" ? (e.effect < 0 ? "−" : "+") : "×"}${Math.abs(e.effect).toFixed(2)}`;
export const who = (c: Candidate) => ({ region: c.region, layer: c.layer, ...("skill" in c.action ? { skill: c.action.skill, ...(c.action.target === undefined ? {} : { target: c.action.target }) } : {}), urgency: round(c.urgency) });

const one = (s: Scored, winner: Candidate | null) => ({ ...who(s.candidate), terms: s.effects.map((e) => ({ term: e.term, kind: e.kind, effect: round(e.effect) })), go: round(s.go), noGo: round(s.noGo), score: round(s.score), ...(s.candidate === winner ? { won: true } : {}) });
const scoredOf = (result: Settled, winner: Candidate | null) => result.scored.map((s) => one(s, winner));

export const conflictOf = (c: Conflict) => ({ channel: c.channel, between: c.between.map(who), closeness: round(c.closeness), ms: Math.round(c.ms), state: c.state, ...(c.how ? { how: c.how } : {}), ...(c.kept ? { kept: who(c.kept) } : {}) });

export interface Outcome {
  result: Contests;
  /** Who goes ahead in each channel, after waiting. */
  winners: (Candidate | null)[];
  conflicts: Conflict[];
  decided: string[];
  alongside: Candidate[];
  /** A winner of another channel that became the action, because nothing else would use the body. */
  promoted: Candidate | null;
}

/** The first channel's contest at the top (as with one contest); every other channel under `channels`. */
export function traceOf({ result, winners, conflicts, decided, alongside, promoted }: Outcome): Record<string, unknown> {
  const [main, ...others] = result.byChannel;
  const { removed, recalled } = result.entered;
  return {
    ...(main?.result.urgent ? { urgent: true } : {}),
    candidates: main ? scoredOf(main.result, winners[0] ?? null) : [],
    // Settled outright: who the full-urgency winner went ahead of (nobody was scored).
    ...(main?.result.urgent ? { rivals: [...result.uses].filter(([c, channels]) => c !== winners[0] && channels.includes(main.channel)).map(([c]) => who(c)) } : {}),
    ...(removed.length ? { removed: removed.map((r) => ({ ...who(r.candidate), by: r.by })) } : {}),
    ...(recalled.length ? { recalled: recalled.map(who) } : {}),
    ...(decided.length ? { decidedBy: decided } : {}),
    ...(others.length ? { channels: Object.fromEntries(others.map((o, at) => [o.channel, { ...(o.result.urgent ? { urgent: true } : {}), candidates: scoredOf(o.result, winners[at + 1] ?? null), ...(winners[at + 1] ? { winner: who(winners[at + 1]!) } : {}) }])) } : {}),
    // A candidate that won one channel and lost another is in neither contest above: here is how it scored where it lost.
    ...(result.dropped.length ? { dropped: result.dropped.map((d) => ({ ...(d.scored ? one(d.scored, null) : who(d.candidate)), lost: d.lost, ...(d.to ? { to: who(d.to) } : {}) })) } : {}),
    ...(conflicts.length ? { conflicts: conflicts.map(conflictOf) } : {}),
    ...(alongside.length ? { alongside: alongside.map(who) } : {}),
    ...(promoted ? { promoted: who(promoted) } : {}),
  };
}
