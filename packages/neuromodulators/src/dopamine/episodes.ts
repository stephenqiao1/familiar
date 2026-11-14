import type { SkillEvent } from "@familiar/contracts";

/** One run of a skill: the situation it started in, and the rewards it collected while running. */
export interface Episode {
  skill: string;
  /** The kind of thing the skill was aimed at (e.g. "chest"), if it had a known target. */
  toward?: string;
  situation: string;
  outcome: number;
  /** The bot died during this run. */
  fatal?: boolean;
}

export interface EndedEpisode extends Episode {
  ended: Exclude<SkillEvent["type"], "started">;
}

/** Follows the running skill from its start event to its end event, adding up its rewards. */
export interface EpisodeTracker {
  /** Adds a reward to the running skill's episode (marking it fatal if asked); false if no skill is running. */
  credit(amount: number, fatal?: boolean): boolean;
  /**
   * Applies skill events in order. A start opens an episode in `situation`, aimed at
   * `kindOf(target)` if the start has a target. Returns the episodes that ended.
   */
  apply(events: readonly SkillEvent[], situation: string, kindOf?: (target: string) => string | undefined): EndedEpisode[];
}

export function createEpisodeTracker(): EpisodeTracker {
  let running: Episode | null = null;
  return {
    credit(amount, fatal = false) {
      if (!running) return false;
      running.outcome += amount;
      if (fatal) running.fatal = true;
      return true;
    },
    apply(events, situation, kindOf) {
      const ended: EndedEpisode[] = [];
      for (const event of events) {
        if (event.type === "started") {
          const toward = event.target === undefined ? undefined : kindOf?.(event.target);
          running = { skill: event.skill, ...(toward === undefined ? {} : { toward }), situation, outcome: 0 };
        } else if (running?.skill === event.skill) {
          ended.push({ ...running, ended: event.type });
          running = null;
        }
      }
      return ended;
    },
  };
}
