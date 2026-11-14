/** One bot's alarm and search temperament. Each effect is 0 (off) to 1 (full). */
export interface NoradrenalineSettings {
  /** How strongly triggers raise alarm: above 1 is jumpy, below 1 is steady. */
  alarmGain: number;
  /** How fast alarm fades once the cause is gone, in seconds: short shakes it off, long stays rattled. */
  alarmDecaySeconds: number;
  /** Where search rests with nothing pushing it (0.05 to 0.95): high is restless, low is settled. */
  searchResting: number;
  /** How slowly search moves, in seconds. */
  searchTimeConstantSeconds: number;
  /** Alarm effect a: high alarm takes the planner out of charge. */
  inCharge: number;
  /** Alarm effect b: a sudden jump cancels the plan and asks for a new one once calm. */
  interrupt: number;
  /** Alarm effect c: faster ticks and narrower attention as alarm rises. */
  focus: number;
  /** Alarm effect d: alarm stamps the strength of memories recorded around it. */
  memoryTag: number;
  /** Alarm effect e: a sudden jump cuts patience (replacing patience's own danger check). */
  patienceLink: number;
  /** Search effect a: high search makes it easier for a new option to replace the running skill. */
  switching: number;
  /** Search effect b: high search widens the options offered. */
  widerOptions: number;
  /** Search effect c: lasting high search tells the planner the goal isn't paying off. */
  tellPlanner: number;
}

export const DEFAULT_NORADRENALINE: NoradrenalineSettings = {
  alarmGain: 1,
  alarmDecaySeconds: 30,
  searchResting: 0.3,
  searchTimeConstantSeconds: 90,
  inCharge: 1,
  interrupt: 1,
  focus: 1,
  memoryTag: 1,
  patienceLink: 1,
  switching: 1,
  widerOptions: 1,
  tellPlanner: 1,
};

const EFFECTS = ["inCharge", "interrupt", "focus", "memoryTag", "patienceLink", "switching", "widerOptions", "tellPlanner"] as const;

/** What is wrong with the settings, or null if they are fine. */
export function noradrenalineProblem(s: NoradrenalineSettings): string | null {
  if (!(s.alarmGain >= 0)) return `noradrenaline.alarmGain must be 0 or more, got ${s.alarmGain}`;
  if (!(s.alarmDecaySeconds > 0)) return `noradrenaline.alarmDecaySeconds must be above 0, got ${s.alarmDecaySeconds}`;
  if (!(s.searchResting >= 0.05 && s.searchResting <= 0.95)) return `noradrenaline.searchResting must be 0.05 to 0.95, got ${s.searchResting}`;
  if (!(s.searchTimeConstantSeconds > 0)) return `noradrenaline.searchTimeConstantSeconds must be above 0, got ${s.searchTimeConstantSeconds}`;
  for (const effect of EFFECTS) if (!(s[effect] >= 0 && s[effect] <= 1)) return `noradrenaline.${effect} must be 0 to 1, got ${s[effect]}`;
  return null;
}
