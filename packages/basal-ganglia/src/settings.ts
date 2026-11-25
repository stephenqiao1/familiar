// The bot's own settings for how choices are made: the strength of each part, 0 to 1. With all
// of them at 0 the basal ganglia choose exactly as the plain list of terms does.

export interface SelectionSettings {
  /** How strongly a request of the body holds back the deciders' rivals. */
  bodyFirst: number;
  /** How wide a near tie is (as a share of the full margin) before the choice is waited on. */
  wait: number;
  /** Above 0: one contest for each part of the body that can act by itself. */
  channels: number;
  /** How fast habits form (0: none form and none are used). */
  habits: number;
  habit: {
    /** How far a habit ignores a change in what the body wants most (1: always). */
    blind: number;
  };
}

export const DEFAULT_SELECTION: SelectionSettings = { bodyFirst: 1, wait: 1, channels: 1, habits: 1, habit: { blind: 0 } };
/** Every part off: who wins is decided by the list of terms alone. */
export const NO_SELECTION: SelectionSettings = { bodyFirst: 0, wait: 0, channels: 0, habits: 0, habit: { blind: 0 } };

/** What is wrong with the settings, or null. */
export function selectionProblem(settings: SelectionSettings): string | null {
  const named: [string, unknown][] = [["bodyFirst", settings.bodyFirst], ["wait", settings.wait], ["channels", settings.channels], ["habits", settings.habits], ["habit.blind", settings.habit?.blind]];
  for (const [name, value] of named) if (typeof value !== "number" || !(value >= 0 && value <= 1)) return `selection.${name} must be a number from 0 to 1, got ${JSON.stringify(value)}`;
  return null;
}
