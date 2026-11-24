// One bot's thalamus: what the deciding layers are told. Each strength is 0 to 1; with `gate`
// at 0 a view is the nearest few of each kind of thing (the attention budget), as it was
// before there was a gate.

export interface ThalamusSettings {
  /** The deciding layers are told only what the body sees, hears or just saw (off by default). */
  fieldOfView: number;
  /** The gate itself: views are filled to a size limit by priority, channel by channel. At 0 they are cut by count only. */
  gate: number;
  /** The attended thing and the running skill's target are raised, and open their channel. */
  spotlight: number;
  /** What the bot wants right now is raised, and opens its channel. */
  wants: number;
  /** Threats the defence circuit has seen are raised; a pressing one opens its channel. */
  threats: number;
  /** News in a turned-down channel is passed once, in brief, marked as new. */
  burst: number;
  /** Focus sets the shape: high, few things in full; low, many things in brief. */
  shape: number;
  /** Arousal sets the size: drowsy, about a third; over-aroused, only the top few items. */
  size: number;
  /** The planner's asks (`detail` in a goal) are raised, and open their channel. */
  detail: number;
  /** The size limit of each reader's view, in characters of JSON. A reader not named here gets `DEFAULT_LIMIT`. */
  limits: Record<string, number>;
}

/** The limit for a reader with none of its own. */
export const DEFAULT_LIMIT = 4000;

export const DEFAULT_THALAMUS: ThalamusSettings = { fieldOfView: 0, gate: 1, spotlight: 1, wants: 1, threats: 1, burst: 1, shape: 1, size: 1, detail: 1, limits: { instinct: 1500, prefrontal: 4000 } };

export const STRENGTHS = ["fieldOfView", "gate", "spotlight", "wants", "threats", "burst", "shape", "size", "detail"] as const;

/** Every strength at 0: the views are those of the attention budget alone. */
export const THALAMUS_OFF: ThalamusSettings = { ...DEFAULT_THALAMUS, ...(Object.fromEntries(STRENGTHS.map((key) => [key, 0])) as Record<(typeof STRENGTHS)[number], number>) };

/** What is wrong with the settings, or null if they are fine. */
export function thalamusProblem(s: ThalamusSettings): string | null {
  for (const key of STRENGTHS) if (!(s[key] >= 0 && s[key] <= 1)) return `thalamus.${key} must be 0 to 1, got ${s[key]}`;
  for (const [reader, limit] of Object.entries(s.limits ?? {})) if (!(limit > 0)) return `thalamus.limits.${reader} must be above 0, got ${limit}`;
  return null;
}
