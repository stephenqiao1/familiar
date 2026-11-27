// Chunks: with practice, a sequence that works becomes a single unit. The motor area notes the
// chain of abilities that got each step finished; when the same chain has finished the same kind
// of step three times it is ready to be saved as a skill of its own.

/** One link of a chain: an ability by name, and what it was aimed at, written as a kind of thing. */
export interface Link {
  skill: string;
  target?: string;
}

/** The same chain must finish the same kind of step this many times to become a skill. */
export const TIMES_TO_CHUNK = 3;
/** A chain has at least this many links (one ability alone is already a skill) and at most this many. */
export const CHAIN_LENGTH = { least: 2, most: 8 };

/** A chain that has finished a kind of step, and how often. */
export interface Chain {
  /** The kind of step it finishes: the step's "done when". */
  doneWhen: string;
  links: Link[];
  seen: number;
  /** The name of the skill it was made into, once it has one. */
  skill?: string;
}

export interface Chunks {
  /** A step with this "done when" was just finished by this chain. Returns the chain's record, or why it is not kept. */
  finished(doneWhen: string, links: readonly Link[]): Chain | string;
  /** The chains seen often enough that have not been made into a skill yet, most seen first. */
  ready(): Chain[];
  /** Says a chain has been made into a skill. */
  made(chain: Pick<Chain, "doneWhen" | "links">, skill: string): void;
  entries(): Chain[];
}

const linkKey = (l: Link) => `${l.skill}${l.target === undefined ? "" : ` ${l.target}`}`;
export const chainKey = (doneWhen: string, links: readonly Link[]) => `${doneWhen} <- ${links.map(linkKey).join(" > ")}`;

/** The chain with the same link twice running counted once (a skill run again straight away is one link). */
export const tidied = (links: readonly Link[]): Link[] => links.filter((l, i) => i === 0 || linkKey(l) !== linkKey(links[i - 1]!));

/** The chains in a saved file that are well formed. */
export function parseChains(raw: unknown): Chain[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Partial<Chain>[]).flatMap((c) => {
    const links = Array.isArray(c?.links) ? c.links.filter((l) => typeof l?.skill === "string" && (l.target === undefined || typeof l.target === "string")) : [];
    if (typeof c?.doneWhen !== "string" || !Number.isInteger(c.seen) || links.length !== c.links?.length || links.length < CHAIN_LENGTH.least) return [];
    return [{ doneWhen: c.doneWhen, links: links.map((l) => ({ skill: l.skill, ...(l.target === undefined ? {} : { target: l.target }) })), seen: c.seen!, ...(typeof c.skill === "string" ? { skill: c.skill } : {}) }];
  });
}

export function createChunks(saved: unknown = []): Chunks {
  const chains = new Map(parseChains(saved).map((c) => [chainKey(c.doneWhen, c.links), c]));
  return {
    finished(doneWhen, raw) {
      const links = tidied(raw);
      if (links.length < CHAIN_LENGTH.least) return links.length ? "one ability alone is already a skill" : "nothing a decider chose ran";
      if (links.length > CHAIN_LENGTH.most) return `longer than ${CHAIN_LENGTH.most} links`;
      const key = chainKey(doneWhen, links);
      const chain = chains.get(key) ?? { doneWhen, links, seen: 0 };
      chain.seen++;
      chains.set(key, chain);
      return { ...chain };
    },
    ready: () => [...chains.values()].filter((c) => c.seen >= TIMES_TO_CHUNK && c.skill === undefined).sort((a, b) => b.seen - a.seen).map((c) => ({ ...c })),
    made(chain, skill) {
      const kept = chains.get(chainKey(chain.doneWhen, chain.links));
      if (kept) kept.skill = skill;
    },
    entries: () => [...chains.values()].map((c) => ({ ...c, links: c.links.map((l) => ({ ...l })) })),
  };
}
