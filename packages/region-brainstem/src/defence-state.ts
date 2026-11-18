import type { Choice } from "./defence.js";

// What defending leaves behind in the body: pain is dulled while it flees or fights and comes
// back afterwards, and a body left badly hurt rests until it has mended.

/** Pain is dulled by up to this much while fleeing or fighting. */
export const MAX_ANALGESIA = 0.7;
/** It builds with this time constant while defending, and fades with this one after (about gone in 10 seconds). */
const RISE_TAU_SECONDS = 1;
const FADE_TAU_SECONDS = 3.3;
/** Resting to recover starts below this share of health and ends above this one. */
export const RECOVER = { below: 0.5, until: 0.75 };
/** Recovery follows a fight or flight this recent. */
const AFTER_DEFENDING_MS = 60_000;
/** A threat at least this pressing (coming) puts recovery off. */
const PRESSING = 0.8;

export interface DefenceState {
  /**
   * Feed the tick's choice and health (a share of full); returns the levels to share. `acting`:
   * a flight or a fight is still under way, whatever the mode chosen this tick (a body outrunning
   * its threat is still fleeing).
   */
  step(choice: Pick<Choice, "mode" | "threat">, health: number, now: number, acting?: boolean): { analgesia: number; recovering: boolean; active: boolean };
}

/** `strengths`: analgesia scales how far pain is dulled (0 never); recuperate above 0 turns recovery on. */
export function createDefenceState(strengths: { analgesia: number; recuperate: number } = { analgesia: 1, recuperate: 1 }): DefenceState {
  let analgesia = 0;
  let at: number | null = null;
  let defendedAt = -Infinity;
  let recovering = false;
  return {
    step({ mode, threat }, health, now, acting = false) {
      const dt = at === null ? 0 : Math.max(0, now - at) / 1000;
      at = now;
      const active = mode === "flee" || mode === "fight" || acting;
      const max = MAX_ANALGESIA * strengths.analgesia;
      analgesia = active ? max - (max - analgesia) * Math.exp(-dt / RISE_TAU_SECONDS) : analgesia * Math.exp(-dt / FADE_TAU_SECONDS);
      if (active) defendedAt = now;
      const clear = !active && threat < PRESSING;
      if (!clear || health > RECOVER.until || strengths.recuperate <= 0) recovering = false;
      else if (!recovering) recovering = health < RECOVER.below && now - defendedAt <= AFTER_DEFENDING_MS;
      return { analgesia, recovering, active };
    },
  };
}
