// One bot's insula: how it feels. Each strength is 0 to 1; with all at 0 there is no feeling,
// and the deciding layers are told the body's numbers alone, as before.

export interface InsulaSettings {
  /** Above 0: the body's readings are turned into named feelings (`ws.feeling`). */
  feeling: number;
  /** How strongly a change in the body that nothing explains is felt as unease. */
  uneasy: number;
  /** Above 0: mood is kept (comfort and recent surprises, averaged over minutes). */
  mood: number;
  /** What the deciding layers are told: 0 the numbers alone, 1 the feeling line alone, anything between both. */
  tell: number;
}

export const DEFAULT_INSULA: InsulaSettings = { feeling: 1, uneasy: 1, mood: 1, tell: 0.5 };
/** Every part off: no feeling is read and nothing is told of one. */
export const NO_INSULA: InsulaSettings = { feeling: 0, uneasy: 0, mood: 0, tell: 0 };

/** What is wrong with the settings, or null. */
export function insulaProblem(settings: InsulaSettings): string | null {
  for (const key of Object.keys(DEFAULT_INSULA) as (keyof InsulaSettings)[]) {
    const value = settings[key];
    if (typeof value !== "number" || !(value >= 0 && value <= 1)) return `insula.${key} must be a number from 0 to 1, got ${JSON.stringify(value)}`;
  }
  return null;
}

/** What the deciding layers are told of the body, from the `tell` setting. */
export const told = (settings: Pick<InsulaSettings, "feeling" | "tell">) => ({ line: settings.feeling > 0 && settings.tell > 0, numbers: !(settings.feeling > 0 && settings.tell >= 1) });
