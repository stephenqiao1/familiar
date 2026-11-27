// Working memory: a few short notes the planner keeps between plans. Each plan it is shown them
// and says which to keep, change or drop. A note it has not kept for three plans in a row is
// dropped, so what it stops caring about clears itself.

/** One note: a short key to name it by, and a line of text. */
export interface Note {
  key: string;
  text: string;
  /** How many plans in a row have not kept it. */
  unkept: number;
}

/** A note as the planner writes it. */
export type NoteGiven = Pick<Note, "key" | "text">;

/** The most notes held at once. */
export const MOST_NOTES = 5;
/** A note not kept for this many plans in a row is dropped. */
export const UNKEPT_PLANS = 3;
/** A note's key and text are cut to these lengths: notes are short. */
export const NOTE_LENGTH = { key: 40, text: 200 };

/** What one plan did to the notes, by key. */
export interface NotesChange {
  kept: string[];
  changed: string[];
  added: string[];
  /** Dropped because the plan said so. */
  dropped: string[];
  /** Dropped because no plan kept it three times running. */
  lapsed: string[];
  /** Not added: there were five already. */
  refused: string[];
}

export interface Notes {
  /** The notes as they stand, oldest first. */
  list(): Note[];
  /** One plan's word on the notes: those it keeps (as they are, or with new text) or adds, and those it drops. */
  plan(keep: readonly NoteGiven[], drop?: readonly string[]): NotesChange;
  entries(): Note[];
}

const tidy = (text: unknown, most: number) => (typeof text === "string" ? text.trim().replace(/\s+/g, " ").slice(0, most) : "");

/** The notes in a saved file that are well formed (at most five). */
export function parseNotes(raw: unknown): Note[] {
  if (!Array.isArray(raw)) return [];
  const notes: Note[] = [];
  for (const n of raw as Partial<Note>[]) {
    const [key, text] = [tidy(n?.key, NOTE_LENGTH.key), tidy(n?.text, NOTE_LENGTH.text)];
    if (key && text && !notes.some((had) => had.key === key)) notes.push({ key, text, unkept: Number.isInteger(n?.unkept) && n!.unkept! >= 0 ? n!.unkept! : 0 });
  }
  return notes.slice(0, MOST_NOTES);
}

export function createNotes(saved: unknown = []): Notes {
  let notes = parseNotes(saved);
  return {
    list: () => notes.map((n) => ({ ...n })),
    plan(keep, drop = []) {
      const change: NotesChange = { kept: [], changed: [], added: [], dropped: [], lapsed: [], refused: [] };
      // The last word on a key counts; a note given no text is one to drop.
      const given = new Map<string, string>();
      for (const n of keep) given.set(tidy(n.key, NOTE_LENGTH.key), tidy(n.text, NOTE_LENGTH.text));
      const dropping = new Set([...drop.map((key) => tidy(key, NOTE_LENGTH.key)), ...[...given].filter(([, text]) => !text).map(([key]) => key)]);
      const next: Note[] = [];
      for (const note of notes) {
        const text = given.get(note.key);
        if (dropping.has(note.key)) change.dropped.push(note.key);
        else if (text) {
          (text === note.text ? change.kept : change.changed).push(note.key);
          next.push({ key: note.key, text, unkept: 0 });
        } else if (note.unkept + 1 >= UNKEPT_PLANS) change.lapsed.push(note.key);
        else next.push({ ...note, unkept: note.unkept + 1 });
      }
      for (const [key, text] of given) {
        if (!key || !text || dropping.has(key) || notes.some((n) => n.key === key)) continue;
        if (next.length >= MOST_NOTES) change.refused.push(key);
        else {
          next.push({ key, text, unkept: 0 });
          change.added.push(key);
        }
      }
      notes = next;
      return change;
    },
    entries: () => notes.map((n) => ({ ...n })),
  };
}
