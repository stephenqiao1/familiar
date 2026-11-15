import type { Changes } from "@familiar/contracts";

/**
 * What a primitive expects to change when it works, as one line of data: each entry is a change
 * that must be there ("turned"), or one that must have a value ("targetBlock=air").
 */
export type Expectation = readonly string[];

/** Whether the changes include everything expected. */
export function asExpected(expects: Expectation, changes: Changes): boolean {
  return expects.every((entry) => {
    const [key = "", value] = entry.split("=");
    if (!(key in changes)) return false;
    return value === undefined || String(changes[key]) === value;
  });
}
