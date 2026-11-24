import type { State } from "@familiar/contracts";

// What the thalamus is handed by the game: the state split into channels, each a list of items.
// The thalamus knows nothing about what an item is; it only weighs, chooses a form and counts.

/** The form an item is passed in: whole, as id / kind / distance / bearing only, or only counted. */
export type Form = "full" | "brief" | "counted";

/** One thing in the state that can be passed on, shortened or held back. */
export interface Item {
  id: string;
  kind: string;
  /** Blocks away, if it has a place. */
  dist?: number;
  /** A rough place, so that the same kind of thing in the same spot is one piece of news (a sound: each one heard has its own id). Default: none. */
  place?: string;
  /** It is new or just changed. */
  fresh?: boolean;
  /** How pressing a threat it is: 0 none, 1 seen, 2 coming or on the body. Default: 0. */
  threat?: number;
  /** Never held back whatever the budget (a hazard within reach of the body). Default: false. */
  vital?: boolean;
  /** What each form costs, in characters of JSON. Counted costs nothing. */
  cost: { full: number; brief: number };
}

export interface Channel {
  name: string;
  /** Where its items start from, 0 to 1: the message itself, before anything raises it. */
  base: number;
  /** Nearest (or most recent) first. */
  items: Item[];
}

/** A state taken apart. */
export interface Split {
  channels: Channel[];
  /** What is always passed whole (the body and whatever is not a list), in characters of JSON. */
  fixed: number;
  /** Puts the kept forms back together as a state of the same shape, with what was held back noted beside it. */
  assemble(forms: ReadonlyMap<string, Form>, note: Told): State;
}

/** What a view says about itself: nothing is silently missing. */
export interface Told {
  /** How many items of each channel were held back (only counted). */
  heldBack: Record<string, number>;
  /** Items passed this once because they are news in a channel that was turned down. */
  new: string[];
}
