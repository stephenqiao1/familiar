import type { Action, Candidate, Workspace } from "@familiar/contracts";
import { acted, enter, settle, without, type Entered, type Settled } from "./choose.js";
import type { Scored } from "./score.js";
import type { Term } from "./term.js";

// Channels: one contest for each part of the body that can act by itself. A candidate is in the
// contest of every channel it would use, and goes ahead only if it wins them all.

/** One part of the body with a contest of its own. To add one, add an entry to the list. */
export interface Channel {
  name: string;
  /** The body parts it stands for. */
  parts: readonly string[];
}

/** The body parts an action would use. undefined: the whole body. Empty: none. */
export type PartsOf = (action: Action, ws: Workspace) => readonly string[] | undefined;

export interface Body {
  /** In order: the first is the main one (its winner is the action; the others' run alongside). */
  channels: readonly Channel[];
  partsOf: PartsOf;
  /** A candidate that needs no contest: it runs beside whatever wins (a flinch). Default: none. */
  free?(candidate: Candidate, ws: Workspace): boolean;
}

/** The channels a candidate competes in: every one it would use a part of; the main one if it uses none. */
export function channelsOf(parts: readonly string[] | undefined, channels: readonly Channel[]): string[] {
  if (parts === undefined) return channels.map((c) => c.name);
  const used = channels.filter((c) => c.parts.some((p) => parts.includes(p))).map((c) => c.name);
  return used.length ? used : channels.slice(0, 1).map((c) => c.name);
}

/** Whether two sets of body parts overlap (undefined is the whole body, which overlaps with anything but nothing). */
export function share(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  if (a === undefined) return b === undefined || b.length > 0;
  if (b === undefined) return a.length > 0;
  return a.some((p) => b.includes(p));
}

/** A candidate that won one of its channels and lost another, so it has neither. */
export interface Dropped {
  candidate: Candidate;
  lost: string;
  to: Candidate | null;
  /** How it scored in the contest it lost (left out when a full-urgency candidate settled that one). */
  scored?: Scored;
}

export interface Contests {
  /** Who is in the vote (those that need no contest are never in it). */
  entered: Entered;
  /** Those that need no contest. */
  free: Candidate[];
  /** One contest for each channel, in the channels' order. */
  byChannel: { channel: string; result: Settled }[];
  dropped: Dropped[];
  /** The channels each candidate in the vote competes in. */
  uses: Map<Candidate, string[]>;
}

/** Runs every channel's contest, dropping (and running again without) any candidate that won one of its channels but not all. */
export function contests(candidates: readonly Candidate[], terms: readonly Term[], ws: Workspace, body: Body): Contests {
  const free = candidates.filter((c) => body.free?.(c, ws) ?? false);
  const entered = enter(free.length ? candidates.filter((c) => !free.includes(c)) : candidates, terms, ws);
  const uses = new Map(entered.pool.map((c) => [c, channelsOf(body.partsOf(c.action, ws), body.channels)] as const));
  const dropped: Dropped[] = [];
  const out = new Set<Candidate>();
  for (;;) {
    const byChannel = body.channels.map(({ name }) => ({ channel: name, result: settle([...uses.keys()].filter((c) => !out.has(c) && uses.get(c)!.includes(name)), terms, ws) }));
    const winnerOf = (channel: string) => byChannel.find((b) => b.channel === channel)!.result.winner;
    const torn = byChannel.map((b) => b.result.winner).find((w) => w !== null && uses.get(w)!.some((channel) => winnerOf(channel) !== w));
    if (!torn) return { entered, free, byChannel, dropped, uses };
    const lost = uses.get(torn)!.find((channel) => winnerOf(channel) !== torn)!;
    const scored = byChannel.find((b) => b.channel === lost)!.result.scored.find((sc) => sc.candidate === torn);
    dropped.push({ candidate: torn, lost, to: winnerOf(lost), ...(scored ? { scored } : {}) });
    out.add(torn);
  }
}

/** The terms without which some channel would have had another winner. */
export function decidedAcross(candidates: readonly Candidate[], terms: readonly Term[], ws: Workspace, body: Body, result: Contests): string[] {
  const winners = (r: Contests) => r.byChannel.map((b) => b.result.winner);
  const now = winners(result);
  if (now.every((w) => w === null) || result.byChannel.every((b) => b.result.urgent || !b.result.winner)) return [];
  return acted(terms, result.entered, result.byChannel.map((b) => b.result))
    .filter((term) => winners(contests(candidates, without(terms, term), ws, body)).some((w, at) => w !== now[at]))
    .map((term) => term.name);
}
