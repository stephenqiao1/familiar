import type { Workspace } from "@familiar/contracts";

// Conditions: what a step's "done when" and "give up when" are written in. The game side says
// which kinds there are (each a few words the planner can write, and how to read them from the
// state); this file reads a condition's text, and adds "not". A condition is only ever read from
// the workspace: it changes nothing.

/** One kind of condition. To add one, add an entry to the game side's list. */
export interface ConditionKind {
  /** How it is written, as the planner is shown it (e.g. "carrying <count> <item>"). */
  form: string;
  /** The check for this text if it is of this kind, else null. The text is in lower case, with single spaces. */
  read(text: string): ((ws: Workspace) => boolean) | null;
}

/** A condition that was understood. */
export interface Condition {
  text: string;
  holds(ws: Workspace): boolean;
}

export interface Conditions {
  /** The condition this text says, or null if it is not in the vocabulary. */
  parse(text: string | null | undefined): Condition | null;
  /** How each kind is written, for the planner. */
  forms: string[];
}

const NOT = "not ";
/** How "not" is written, for the planner. */
export const NOT_FORM = "not <condition>";

/** The vocabulary made of these kinds, and "not" of any of them. What a text says is worked out once and kept. */
export function createConditions(kinds: readonly ConditionKind[]): Conditions {
  const known = new Map<string, Condition | null>();
  const read = (text: string): ((ws: Workspace) => boolean) | null => {
    if (text.startsWith(NOT)) {
      const inner = read(text.slice(NOT.length).trim());
      return inner && ((ws) => !inner(ws));
    }
    for (const kind of kinds) {
      const check = kind.read(text);
      if (check) return check;
    }
    return null;
  };
  return {
    parse(text) {
      const tidy = (text ?? "").trim().toLowerCase().replace(/\s+/g, " ");
      if (!tidy) return null;
      if (!known.has(tidy)) {
        const check = read(tidy);
        known.set(tidy, check && { text: tidy, holds: check });
      }
      return known.get(tidy)!;
    },
    forms: [...kinds.map((k) => k.form), NOT_FORM],
  };
}

/** A vocabulary with nothing in it: no condition is understood. */
export const NO_CONDITIONS: Conditions = { parse: () => null, forms: [] };
