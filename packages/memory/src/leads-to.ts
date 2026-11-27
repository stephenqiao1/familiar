import type { Fact, Memory } from "./memory.js";

// The order of events: when one kind of event has followed another often enough, that is a
// "leads to" fact ("a creeper close by is followed by heavy damage"). Built at rest from the
// links each memory keeps to the one before it.

/** What an event is, for counting what follows what: its kind and the first thing involved. */
export const eventLabel = (m: Pick<Memory, "kind" | "involved">) => `${m.kind}|${m.involved[0] ?? ""}`;
/** The two labels of a "leads to" fact's pair ("sign>what follows|feeling"). */
export const pairOf = (after: string): [string, string] => {
  const [sign = "", rest = ""] = after.split(">");
  return [sign, rest.slice(0, rest.lastIndexOf("|"))];
};
const words = (kind: string, thing: string) => `${thing ? `${thing.replace(/_/g, " ")} ` : ""}(${kind.replace("_", " ")})`;

/** The sign an event is, if it has been found to lead to something: its label, or null. */
export function signOf(event: Pick<Memory, "kind" | "involved">, facts: readonly Fact[]): string | null {
  const sign = eventLabel(event);
  return facts.some((f) => f.after?.startsWith(`${sign}>`)) ? sign : null;
}

/**
 * Writes or updates a "leads to" fact for every pair of event kinds where the second followed
 * the first `support` times or more and had a good or bad outcome. Returns how many it wrote.
 * `confidenceFor` is the memory's own rule for confidence from support.
 */
export function buildLeadsTo(memories: readonly Memory[], facts: Fact[], support: number, confidenceFor: (count: number, needed: number) => number): number {
  const byId = new Map(memories.map((m) => [m.id, m]));
  const pairs = new Map<string, { first: Memory; then: Memory; count: number }>();
  for (const then of memories) {
    const first = then.previous === undefined ? undefined : byId.get(then.previous);
    if (!first || then.outcome.feeling === "neutral" || eventLabel(first) === eventLabel(then)) continue;
    const key = `${eventLabel(first)}>${eventLabel(then)}|${then.outcome.feeling}`;
    pairs.set(key, { first, then, count: (pairs.get(key)?.count ?? 0) + 1 });
  }
  let written = 0;
  for (const [key, { first, then, count }] of pairs) {
    if (count < support) continue;
    const existing = facts.find((f) => f.after === key);
    if (existing && count <= existing.support) continue;
    const fact: Fact = {
      id: existing?.id ?? `l${facts.length + 1}`,
      text: `${words(first.kind, first.involved[0] ?? "")} is often followed by ${words(then.kind, then.involved[0] ?? "")}`,
      kind: then.kind,
      involved: first.involved[0] ?? first.kind,
      feeling: then.outcome.feeling as "good" | "bad",
      context: [],
      support: count,
      confidence: confidenceFor(count, support),
      after: key,
    };
    if (existing) Object.assign(existing, fact);
    else facts.push(fact);
    written++;
  }
  return written;
}
