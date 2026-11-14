/** What was in one chest the last time the bot opened it. */
export interface ChestRecord {
  /** Item name → count. */
  contents: Record<string, number>;
  /** When it was seen (ms). */
  seenAt: number;
}

/**
 * What the bot remembers about each chest it has opened, keyed by its target id ("pos:x,y,z").
 * Updated whenever a storage skill closes a chest; may be out of date if someone else used it.
 */
export interface ChestMemory {
  remember(chest: string, contents: Record<string, number>, seenAt: number): void;
  recall(chest: string): ChestRecord | undefined;
  /** Every remembered chest, for describing and saving. */
  entries(): Record<string, ChestRecord>;
}

export function createChestMemory(saved: Record<string, ChestRecord> = {}): ChestMemory {
  const chests = new Map(Object.entries(saved).map(([id, r]) => [id, { contents: { ...r.contents }, seenAt: r.seenAt }]));
  return {
    remember(chest, contents, seenAt) {
      chests.set(chest, { contents: { ...contents }, seenAt });
    },
    recall: (chest) => chests.get(chest),
    entries: () => Object.fromEntries(chests),
  };
}

/** A remembered value that was looked up: whether it was used, or rejected as too old to trust. */
export interface RememberedLookup {
  what: string;
  used: boolean;
}

/** Guardrail: this many re-checks of one chest within the window that found nothing changed... */
const POINTLESS_RECHECKS = 3;
const RECHECK_WINDOW_MS = 300_000;
/** ...make the chest trusted without question for this long. */
const SETTLED_MS = 300_000;

/**
 * A view of chest memory that only gives out what is still trusted. An untrusted chest reads as
 * unknown, so the bot goes and checks it. `isTrusted` decides from when the chest was last seen
 * (e.g. trust that fades with age, compared with focus). Every lookup is reported.
 *
 * Guardrail against a checking loop: a chest re-opened more than 3 times in 5 minutes with nothing
 * changed is trusted without question for the next 5 minutes.
 */
export function withTrust(
  chests: ChestMemory,
  isTrusted: (seenAt: number) => boolean,
  report: (lookup: RememberedLookup) => void = () => {},
  now: () => number = Date.now,
): ChestMemory {
  const rechecks = new Map<string, number[]>();
  const settledUntil = new Map<string, number>();
  const trusted = (id: string, record: ChestRecord) => {
    const settled = now() < (settledUntil.get(id) ?? -Infinity);
    const used = settled || isTrusted(record.seenAt);
    report({ what: `chest ${id}`, used });
    return used;
  };
  return {
    remember(chest, contents, seenAt) {
      const old = chests.recall(chest);
      if (old && JSON.stringify(old.contents) === JSON.stringify(contents)) {
        const recent = [...(rechecks.get(chest) ?? []).filter((at) => seenAt - at <= RECHECK_WINDOW_MS), seenAt];
        rechecks.set(chest, recent);
        if (recent.length > POINTLESS_RECHECKS) {
          settledUntil.set(chest, seenAt + SETTLED_MS);
          rechecks.set(chest, []);
          report({ what: `chest ${chest} re-checked ${recent.length} times with nothing changed: trusting it for 5 minutes`, used: true });
        }
      } else rechecks.delete(chest);
      chests.remember(chest, contents, seenAt);
    },
    recall(chest) {
      const record = chests.recall(chest);
      return record && trusted(chest, record) ? record : undefined;
    },
    entries: () => Object.fromEntries(Object.entries(chests.entries()).filter(([id, record]) => trusted(id, record))),
  };
}
