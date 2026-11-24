// Priority: salience plus what the bot wants. Salience is physical only; what kind of thing it
// is may enter here and nowhere else, as one boost with two sources: the goal is watching for
// that kind, or the bot wants that kind right now (how much, 0 to 1, is dopamine's to say).

/** A watched or fully wanted kind gets this much added. */
export const WATCH_BOOST = 0.4;

export interface Boost {
  boost: number;
  /** Where it came from, or null for none. */
  from: "watched" | "wanted" | null;
}

/** The boost for one kind: WATCH_BOOST × the larger of "watched" (0 or 1) and "wanted" (0 to 1). */
export function boostOf(watched: boolean, wanted: number, strengths: { topDown: number; wants: number }): Boost {
  const want = strengths.wants * Math.min(1, Math.max(0, wanted));
  const share = Math.max(watched ? 1 : 0, want);
  const boost = WATCH_BOOST * strengths.topDown * share;
  return { boost, from: boost <= 0 ? null : watched ? "watched" : "wanted" };
}
