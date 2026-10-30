/** A change in a skill's lifecycle. */
export interface SkillEvent {
  skill: string;
  target?: string;
  type: "started" | "done" | "failed" | "interrupted";
  reason?: string;
  timestamp: number;
}
