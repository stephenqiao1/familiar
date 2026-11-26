import type { Association, Associations } from "@familiar/region-amygdala";
import { MEALS_TO_LEARN } from "../gut.js";
import { INCIDENTS_TO_LEARN } from "../pain.js";
import { bornThreat, type ThreatEntries } from "../defence/threat-record.js";
import type { DefenceSettings } from "../defence/settings.js";
import { CUE_OF } from "./amygdala.js";

// Moving what the older rules learned over to the amygdala, once: the threat record's danger and
// learned threats, the blocks that hurt and the foods that made the bot ill become associations.
// Pure: the files are read and backed up by whoever calls this.

/** What a block or food the old rule had learned is taken to predict; one it had only begun to suspect, this much per incident. */
const LEARNED = { known: 0.5, suspected: 0.05 };

export interface OldLearning {
  threats: ThreatEntries;
  hurts: Record<string, number>;
  badFoods: Record<string, number>;
}

/**
 * The associations the old files amount to. A kind that is a threat (born or learned) predicts
 * its recorded danger; a block or food counted often enough to be known predicts a fair harm.
 * `hostile`: the game flags this kind hostile.
 */
export function associationsFrom(old: OldLearning, settings: Pick<DefenceSettings, "innateThreats">, hostile: (kind: string) => boolean, now: number): Associations {
  const out: Associations = {};
  const of = (harm: number): Association => ({ harm: Math.min(1, Math.max(0, harm)), good: 0, sure: 1, at: now });
  for (const [kind, c] of Object.entries(old.threats)) if (c.threat || bornThreat(settings, kind, hostile(kind))) out[CUE_OF.kind(kind)] = of(c.danger);
  const counted = (counts: Record<string, number>, needed: number, cue: (name: string) => string) => {
    for (const [name, n] of Object.entries(counts)) if (n > 0) out[cue(name)] = of(n >= needed ? LEARNED.known : LEARNED.suspected * n);
  };
  counted(old.hurts, INCIDENTS_TO_LEARN, CUE_OF.block);
  counted(old.badFoods, MEALS_TO_LEARN, CUE_OF.food);
  return out;
}

/** Lays the moved associations over what is already held: the stronger harm stands, and what a cue was born with is kept. */
export function moveOver(held: Associations, moved: Associations): Associations {
  const out = { ...held };
  for (const [cue, a] of Object.entries(moved)) {
    const was = held[cue];
    out[cue] = was ? { ...was, harm: Math.max(was.harm, a.harm) } : a;
  }
  return out;
}
