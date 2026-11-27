import type { BodyPart } from "@familiar/contracts";

/** What each primitive is, by name: its body parts and written expectations (filled in as each is defined). */
export const SPECS = new Map<string, { parts: readonly BodyPart[]; expects: readonly string[]; settleMs?: number }>();
