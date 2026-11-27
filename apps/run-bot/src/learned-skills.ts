import type { LearnedSkill } from "@familiar/core";
import type { Chain } from "@familiar/region-motor";

// The skills the bot has saved for itself: chains of abilities it already has, kept as data in
// learned-skills.json in the format the loader reads. One that fails three times running is
// retired: taken off the menu and marked so in the file, never deleted.

/** A learned skill that fails this many times running is retired. */
export const RETIRE_AFTER = 3;
/** A learned skill's description is cut to this length. */
const DESCRIPTION_LENGTH = 140;

export interface LearnedStore {
  /** The skills in use (not retired). */
  skills(): LearnedSkill[];
  /** Everything for the file: in use and retired. */
  entries(): LearnedSkill[];
  /** Every name that is taken: the bot's own abilities and every learned skill, retired or not. */
  taken(): string[];
  /** A learned skill's test of success: undefined if it has none, null if this is not a learned skill in use. */
  testOf(name: string): string | undefined | null;
  /** Makes a chain into a skill under the name given (made safe and unique), or under a name built from its links. Returns the skill. */
  add(chain: Pick<Chain, "doneWhen" | "links">, given: { name: string; description: string } | null): LearnedSkill;
  /** A learned skill just ran: `ok` is whether it finished and its test came true. Returns true if this retired it. */
  ran(name: string, ok: boolean): boolean;
}

/** A name of lowercase letters, digits and underscores, from whatever was given. */
export const wordOf = (given: string) => given.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);

export function createLearnedStore(options: { saved?: { skills: LearnedSkill[]; retired: LearnedSkill[] }; builtIn: readonly string[]; onLearn?(skill: LearnedSkill): void; onRetire?(skill: LearnedSkill): void }): LearnedStore {
  const all: LearnedSkill[] = [...(options.saved?.skills ?? []), ...(options.saved?.retired ?? [])].map((s) => ({ ...s }));
  const taken = () => [...options.builtIn, ...all.map((s) => s.name)];
  return {
    skills: () => all.filter((s) => !s.retired).map((s) => ({ ...s })),
    entries: () => all.map((s) => ({ ...s })),
    taken,
    testOf(name) {
      const skill = all.find((s) => s.name === name && !s.retired);
      return skill ? skill.doneWhen : null;
    },
    add(chain, given) {
      const made = chain.links.map((l) => l.skill).join("_then_");
      const base = wordOf(given?.name ?? "") || wordOf(made);
      let name = taken().includes(base) ? wordOf(made) : base;
      for (let n = 2; taken().includes(name); n++) name = `${base}_${n}`;
      const told = chain.links.map((l) => `${l.skill}${l.target ? ` ${l.target}` : ""}`).join(", then ");
      const description = (given?.description ?? "").trim().replace(/\s+/g, " ").slice(0, DESCRIPTION_LENGTH) || `A routine that worked: ${told}.`;
      const skill: LearnedSkill = { name, description, steps: chain.links.map((l) => ({ primitive: l.skill, ...(l.target === undefined ? {} : { target: l.target }) })), doneWhen: chain.doneWhen };
      all.push(skill);
      options.onLearn?.({ ...skill });
      return { ...skill };
    },
    ran(name, ok) {
      const skill = all.find((s) => s.name === name && !s.retired);
      if (!skill) return false;
      if (ok) {
        delete skill.fails;
        return false;
      }
      skill.fails = (skill.fails ?? 0) + 1;
      if (skill.fails < RETIRE_AFTER) return false;
      skill.retired = true;
      options.onRetire?.({ ...skill });
      return true;
    },
  };
}
