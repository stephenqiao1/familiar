import type { Arbiter, Candidate, Workspace } from "@familiar/contracts";
import { channelsOf, contests, decidedAcross, share, type Body } from "./channels.js";
import { mostUrgent } from "./choose.js";
import { CONFLICT_SIGNAL } from "./signals.js";
import { skillOf, type Term } from "./term.js";
import { round, say, traceOf, who } from "./trace.js";
import { createWaiter, type Conflict, type WaiterOptions } from "./wait.js";

/** Everything one choice came to. */
export interface Choice {
  /** Everyone who proposed something this tick. */
  candidates: readonly Candidate[];
  winner: Candidate | null;
  alongside: Candidate[];
  conflicts: Conflict[];
}

export interface BasalGangliaOptions {
  /** Every rule about who wins, in order. */
  terms: Term[];
  /** The channels of the body, each with a contest of its own. Default: one contest for the whole body. */
  body?: Body;
  /** Waiting on a near tie. Default: never. */
  wait?: WaiterOptions;
  /** Told what each choice came to (the striatum learns its habits from this). It may not change anything. */
  onChoice?(choice: Choice, ws: Workspace): void;
}

/** The whole body as one channel: a single contest, as before there were channels. */
export const ONE_CONTEST: Body = { channels: [{ name: "body", parts: [] }], partsOf: () => undefined };

/** The same term, remembering what it said of each candidate for the length of one choice. */
function askedOnce(term: Term): Term {
  if (term.byVote) return term;
  const said = new Map<Candidate, number>();
  return {
    ...term,
    amount(candidate, ws, vote) {
      if (!said.has(candidate)) said.set(candidate, term.amount(candidate, ws, vote));
      return said.get(candidate)!;
    },
  };
}

/** The most urgent, the first listed on a tie. */
const first = (candidates: readonly Candidate[]) => candidates.reduce<Candidate | null>((best, c) => (!best || c.urgency > best.urgency ? c : best), null);

/**
 * The basal ganglia: the one place that decides which proposal goes ahead. Every candidate is
 * held back by default and one is released in each channel: the highest (urgency + go terms) ×
 * no-go terms, ties to the faster layer. A full-urgency candidate always wins its channel at
 * once, whatever the terms say. They only choose: they never change a proposal's action or invent one.
 */
export function createBasalGanglia({ terms, body = ONE_CONTEST, wait, onChoice }: BasalGangliaOptions): Arbiter {
  const waiter = wait && wait.strength > 0 ? createWaiter(wait) : null;
  let trace: Record<string, unknown> | undefined;
  let worstMs = 0;
  let dueInMs: number | null = null;
  /** Those that compete to be the action itself (the main channel). */
  const mainOnly = (candidates: readonly Candidate[], ws: Workspace) => candidates.filter((c) => !(body.free?.(c, ws) ?? false) && channelsOf(body.partsOf(c.action, ws), body.channels).includes(body.channels[0]!.name));

  function choose(candidates: Candidate[], shared: Workspace, early: Candidate | null = null) {
    const started = performance.now();
    // The signals are read many times in one choice, and the workspace copies them on every read: read them once.
    const ws: Workspace = Object.create(shared, { signals: { value: shared.signals } });
    // Each term is asked once for each candidate, however often a contest is run again below.
    const once = terms.map(askedOnce);
    const result = contests(candidates, once, ws, body);
    const decided = decidedAcross(candidates, once, ws, body, result);
    const decisions = result.byChannel.map((b) => waiter?.decide(b.channel, b.result, ws) ?? { winner: b.result.winner, conflict: null });
    const conflicts = decisions.flatMap((d) => (d.conflict ? [d.conflict] : []));
    // After waiting, a candidate still goes ahead only if it has every channel it would use.
    const held = decisions.map((d) => d.winner);
    const at = (channel: string) => result.byChannel.findIndex((b) => b.channel === channel);
    const winners = held.map((w) => (w && result.uses.get(w)!.every((channel) => held[at(channel)] === w) ? w : null));
    let main = early ?? winners[0] ?? null;
    const others = [...new Set(winners.slice(1))].filter((w): w is Candidate => w !== null && w !== main);
    // Nobody wants the main channel and nothing waits there: a winner elsewhere that needs what the running skill uses (or with nothing running) is the action.
    const partsNow = ws.current ? body.partsOf({ skill: ws.current.skill, ...(ws.current.target === undefined ? {} : { target: ws.current.target }) }, ws) : [];
    const promoted = main === null && decisions[0]?.conflict?.state !== "waiting" ? (others.find((w) => ws.current === null || share(body.partsOf(w.action, ws), partsNow)) ?? null) : null;
    if (promoted) main = promoted;
    // What will have the body: the action if it starts a skill, otherwise whatever is running.
    const busy = main && skillOf(main) !== null ? body.partsOf(main.action, ws) : partsNow;
    const alongside = [...others.filter((w) => w !== promoted && !share(body.partsOf(w.action, ws), busy)), ...result.free];
    const beside = first(alongside);

    if (!early) for (const term of terms) term.settled?.(main, ws);
    if (waiter) shared.setSignal(CONFLICT_SIGNAL, Math.max(0, ...conflicts.filter((c) => c.state === "waiting").map((c) => c.closeness)));
    dueInMs = waiter?.dueInMs(ws.state.timestamp) ?? null;
    onChoice?.({ candidates, winner: main, alongside: beside ? [beside] : [], conflicts }, shared);

    const ms = performance.now() - started;
    worstMs = Math.max(worstMs, ms);
    trace = early
      ? { urgent: true, early: true, candidates: [{ ...who(early), won: true }], rivals: [...result.uses.keys()].filter((c) => c !== early && result.uses.get(c)!.includes(body.channels[0]!.name)).map(who), ...(beside ? { alongside: [who(beside)] } : {}) }
      : { ...traceOf({ result, winners: [main, ...winners.slice(1)], conflicts, decided, alongside: beside ? [beside] : [], promoted }), ms: round(ms), worstMs: round(worstMs) };
    return { winner: early ?? reasoned(main, result, decided, conflicts), alongside: beside ? [beside] : [] };
  }

  /** The winner with what decided it written into its reason. */
  function reasoned(winner: Candidate | null, result: ReturnType<typeof contests>, decided: string[], conflicts: Conflict[]): Candidate | null {
    const won = result.byChannel.flatMap((b) => b.result.scored).find((s) => s.candidate === winner);
    if (!winner || !won || skillOf(winner) === null) return winner;
    const effects = won.effects.map(say).join(", ");
    const why = decided.length ? `; decided by ${decided.join(", ")}` : "";
    const tie = conflicts.find((c) => c.kept === winner);
    const waited = tie ? `; ${tie.state === "waiting" ? "kept while a near tie is waited on" : `near tie settled: ${tie.how}`}` : "";
    return { ...winner, reason: `${winner.reason}${effects ? `; ${effects}` : ""}${why}${waited}` };
  }

  return {
    name: "basal-ganglia",
    pick: (candidates, ws) => choose(candidates, ws).winner,
    choose,

    // Nothing still running can beat a full-urgency candidate for the main channel unless it is from a faster layer.
    settledEarly(candidates, pendingLayers, ws) {
      const best = mostUrgent(mainOnly(candidates, ws));
      if (!best || best.urgency < 1) return null;
      if (!pendingLayers.every((layer) => layer >= best.layer)) return null;
      trace = { urgent: true, early: true, candidates: [{ ...who(best), won: true }] };
      return best;
    },

    trace: () => trace,
    againInMs: () => dueInMs,
  };
}
