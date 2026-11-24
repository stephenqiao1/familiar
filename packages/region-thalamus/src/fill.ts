import type { Form } from "./item.js";

// The fill: hand out the forms in order of priority until the limit is reached. Each item gets
// its full form while there is room; when full no longer fits, brief; when brief no longer
// fits, it is only counted. Pure: the same input always gives the same result.

/** One item as the fill sees it. */
export interface Candidate {
  id: string;
  channel: string;
  priority: number;
  cost: { full: number; brief: number };
  /** Its channel is open: it may be given in full. */
  open: boolean;
  /** Never held back: it gets a form whatever the budget (full if its channel is open). */
  must: boolean;
  /** Never only counted: it gets its brief form at the least, whatever the budget (a threat in view). Default: false. */
  floor?: boolean;
}

export interface FillInput {
  /** In any order: the fill sorts by priority, and by the order given among equals. */
  items: Candidate[];
  /** Characters of JSON for the whole view. */
  limit: number;
  /** What is always passed whole. */
  fixed: number;
  /** The share of the room that may go to full forms (see budget.ts). Default: all of it. */
  fullShare?: number;
  /** Whether brief forms may use only their own share of the room (a shape is set). Default: no, they may use whatever is left. */
  shaped?: boolean;
  /** At most this many items that are not "must" get any form. Default: no cap. */
  most?: number;
}

export interface Filled {
  forms: Map<string, Form>;
  /** What the view costs: the fixed part and every form given. */
  spent: number;
  /** How many items of each channel were only counted. */
  heldBack: Record<string, number>;
  /** By how much what may never be held back (or never only counted) took the view over the limit, or 0. */
  over: number;
}

export function fill(input: FillInput): Filled {
  const { limit, fixed, most = Infinity } = input;
  const order = input.items.map((item, at) => ({ item, at })).sort((a, b) => b.item.priority - a.item.priority || a.at - b.at).map((x) => x.item);
  const forms = new Map<string, Form>();
  let spent = fixed;
  // What may never be held back comes first, whatever it costs.
  for (const item of order.filter((i) => i.must)) {
    const form: Form = item.open ? "full" : "brief";
    forms.set(item.id, form);
    spent += item.cost[form];
  }
  const room = Math.max(0, limit - spent);
  const fullRoom = room * (input.fullShare ?? 1);
  let [full, brief, given] = [0, 0, 0];
  for (const item of order) {
    if (forms.has(item.id)) continue;
    const left = room - full - brief;
    const mayFull = item.open && given < most && item.cost.full <= left && full + item.cost.full <= fullRoom;
    // With a shape set, brief forms keep to their own share plus whatever the full ones left unused at the end; without, they take what is left.
    const briefRoom = input.shaped ? room - fullRoom - brief : left;
    const mayBrief = given < most && item.cost.brief <= left && item.cost.brief <= briefRoom;
    const form: Form = mayFull ? "full" : mayBrief || item.floor ? "brief" : "counted";
    forms.set(item.id, form);
    if (form === "full") full += item.cost.full;
    if (form === "brief") brief += item.cost.brief;
    if (form !== "counted") given++;
  }
  spent += full + brief;
  // Only what may never be held back (or never only counted) can take the view past its limit.
  const over = Math.max(0, spent - limit);
  const heldBack: Record<string, number> = {};
  for (const item of order) if (forms.get(item.id) === "counted") heldBack[item.channel] = (heldBack[item.channel] ?? 0) + 1;
  return { forms, spent, heldBack, over };
}

/**
 * Makes room for one more brief form by giving the lowest-priority full item (not a "must") its
 * brief form instead. Returns that item's id, or null if nothing could give way.
 */
export function makeRoom(filled: Filled, items: readonly Candidate[]): string | null {
  const lowest = items.filter((i) => !i.must && filled.forms.get(i.id) === "full").sort((a, b) => a.priority - b.priority)[0];
  if (!lowest) return null;
  filled.forms.set(lowest.id, "brief");
  filled.spent += lowest.cost.brief - lowest.cost.full;
  return lowest.id;
}
