/** An input stuck at 0, or silent, for this long is worth a warning. */
const STUCK_MS = 300_000;
/** The same input warns at most this often. */
const REPEAT_MS = 60_000;

/**
 * Guardrail: watches each outlook input on its own, so a broken one is named instead of being
 * averaged away. Warns when an input
 *   - returns something that is not a number (at once),
 *   - has read 0 for 5 minutes straight, or
 *   - used to give a value and has given none for 5 minutes.
 * An input can honestly sit at 0 that long (a night spent in the dark), so the wording is "check".
 */
export interface InputHealth {
  /** Feed one input's raw reading (null = no value); returns a warning to log now, or null. */
  check(name: string, value: number | null, now: number): string | null;
}

export function createInputHealth(): InputHealth {
  const inputs = new Map<string, { zeroSince: number | null; silentSince: number | null; seen: boolean; warnedAt: number }>();

  return {
    check(name, value, now) {
      const input = inputs.get(name) ?? { zeroSince: null, silentSince: null, seen: false, warnedAt: -Infinity };
      inputs.set(name, input);
      const invalid = value !== null && !Number.isFinite(value);
      const hasValue = value !== null && !invalid;
      if (hasValue) input.seen = true;
      input.zeroSince = value === 0 ? (input.zeroSince ?? now) : null;
      input.silentSince = !hasValue && input.seen ? (input.silentSince ?? now) : null;

      let problem: string | null = null;
      if (invalid) problem = `returned ${value}`;
      else if (input.zeroSince !== null && now - input.zeroSince >= STUCK_MS) problem = `has been 0 for ${minutes(now - input.zeroSince)} minutes`;
      else if (input.silentSince !== null && now - input.silentSince >= STUCK_MS) problem = `has had no value for ${minutes(now - input.silentSince)} minutes`;
      if (problem === null || now - input.warnedAt < REPEAT_MS) return null;
      input.warnedAt = now;
      return `check outlook input "${name}": it ${problem}`;
    },
  };
}

const minutes = (ms: number) => Math.floor(ms / 60_000);
