import type { SkillEvent } from "@familiar/contracts";
import type { Aim } from "./scorebook.js";

/** One run of a skill: the situation it started in, and the rewards it collected while running. */
export interface Episode {
  skill: string;
  /** The kind of thing the skill was aimed at (e.g. "chest"), if it had a known target. */
  toward?: string;
  /** Which one, if it is a thing that stays where it is (e.g. that chest's id). */
  towardId?: string;
  situation: string;
  outcome: number;
  /** The positive rewards alone: what the run earned, before anything bad is taken off. */
  gained: number;
  /** The work put in so far, in reward units: what it costs if the run comes to nothing. */
  effort: number;
  /** The bot died during this run. */
  fatal?: boolean;
  /** How pressing each need was when the run started, if known. */
  needs?: Record<string, number>;
}

export interface EndedEpisode extends Episode {
  ended: Exclude<SkillEvent["type"], "started">;
}

/** Follows the running skill from its start event to its end event, adding up its rewards. */
export interface EpisodeTracker {
  /**
   * Adds a reward to the running skill's episode (marking it fatal if asked); false if no skill
   * is running. `gained` is the positive part of it. Default: the amount itself, if positive.
   */
  credit(amount: number, fatal?: boolean, gained?: number): boolean;
  /** Adds work done to the running skill's episode; nothing if no skill is running. */
  spend(effort: number): void;
  /**
   * Applies skill events in order. A start opens an episode in `situation`, aimed at
   * `aimOf(target)` if the start has a target; else at what the event that ends it says. Returns the episodes that ended.
   */
  apply(events: readonly SkillEvent[], situation: string, aimOf?: (target: string) => Aim | undefined): EndedEpisode[];
  /**
   * One tick: applies the skill events of the stretch of time `from`..`to` (ms), and gives what
   * the stretch earned and cost to the skill that ran for the most of it. A tick often holds the
   * end of one skill and the start of the next, or a whole short run: this decides between them
   * by the events' own times. An event with no time inside the stretch counts as happening at
   * its end, so a skill that only just started gets nothing and one already running gets it all;
   * a run that both started and ended inside the stretch with nothing else running gets it.
   * Returns the episodes that ended, and whether any skill was there to take the credit.
   */
  advance(tick: {
    events: readonly SkillEvent[];
    from: number;
    to: number;
    situation: string;
    aimOf?: (target: string) => Aim | undefined;
    /** How pressing each need is as the stretch starts: kept by every run that starts in it. */
    needs?: Record<string, number>;
    /** What the stretch earned in all (may be negative), the positive part of it, and the work done. */
    amount?: number;
    gained?: number;
    effort?: number;
    fatal?: boolean;
    /** Rewards that are about one skill's run (it failed, it finished): they go to that run, however little of the stretch it ran. */
    about?: { skill: string; amount: number }[];
  }): { ended: EndedEpisode[]; credited: boolean };
}

export function createEpisodeTracker(): EpisodeTracker {
  let running: Episode | null = null;
  type AimOf = ((target: string) => Aim | undefined) | undefined;
  /**
   * Settles what a run is aimed at, if not known yet: from its start event, else from the event
   * that ends it (the thing a skill chose itself, or a target that was out of sight at the start).
   */
  const aim = (episode: Episode, event: SkillEvent, aimOf: AimOf): Episode => {
    const target = event.aimedAt ?? event.target;
    const found = episode.toward === undefined && target !== undefined ? aimOf?.(target) : undefined;
    if (found) Object.assign(episode, { toward: found.kind, ...(found.id === undefined ? {} : { towardId: found.id }) });
    return episode;
  };
  const start = (event: SkillEvent, situation: string, aimOf: AimOf, needs?: Record<string, number>): Episode =>
    aim({ skill: event.skill, situation, outcome: 0, gained: 0, effort: 0, ...(needs ? { needs } : {}) }, event, aimOf);
  return {
    advance({ events, to, situation, aimOf, needs, amount = 0, gained = Math.max(0, amount), effort = 0, fatal = false, about = [], ...tick }) {
      const from = Math.min(tick.from, to - 1); // a stretch of no length still has someone in it
      const when = (at: number) => (at > from && at <= to ? at : to);
      type Alive = { episode: Episode; ran: number; ended?: EndedEpisode["ended"]; whole?: boolean };
      const alive: Alive[] = [];
      let current: Alive | null = running ? { episode: running, ran: 0 } : null;
      if (current) alive.push(current);
      let at = from;
      for (const event of events) {
        const then = Math.max(at, when(event.timestamp));
        if (event.type === "started") {
          if (current) current.ran += then - at;
          current = { episode: start(event, situation, aimOf, needs), ran: 0, whole: true };
          alive.push(current);
          at = then;
        } else if (current?.episode.skill === event.skill) {
          current.ran += then - at;
          current.ended = event.type;
          aim(current.episode, event, aimOf);
          current = null;
          at = then;
        }
      }
      if (current) current.ran += to - at;
      // The one that ran for the most of the stretch (the earlier, if equal); failing any, a whole run inside it.
      const longest = alive.reduce<Alive | null>((best, a) => (a.ran > (best?.ran ?? 0) ? a : best), null) ?? alive.find((a) => a.whole && a.ended) ?? null;
      if (longest) {
        longest.episode.outcome += amount;
        longest.episode.gained += gained;
        longest.episode.effort += Math.max(0, effort);
        if (fatal) longest.episode.fatal = true;
      }
      // What is about one skill goes to the run of that skill that ended in this stretch, else the one still going.
      for (const reward of about) {
        const run = alive.filter((a) => a.episode.skill === reward.skill);
        const episode = (run.find((a) => a.ended) ?? run.at(-1))?.episode;
        if (!episode) continue;
        episode.outcome += reward.amount;
        episode.gained += Math.max(0, reward.amount);
      }
      running = current?.episode ?? null;
      return { ended: alive.filter((a) => a.ended).map((a) => ({ ...a.episode, ended: a.ended! })), credited: longest !== null };
    },
    credit(amount, fatal = false, gained = Math.max(0, amount)) {
      if (!running) return false;
      running.outcome += amount;
      running.gained += gained;
      if (fatal) running.fatal = true;
      return true;
    },
    spend(effort) {
      if (running) running.effort += Math.max(0, effort);
    },
    apply(events, situation, aimOf) {
      const ended: EndedEpisode[] = [];
      for (const event of events) {
        if (event.type === "started") {
          running = start(event, situation, aimOf);
        } else if (running?.skill === event.skill) {
          ended.push({ ...aim(running, event, aimOf), ended: event.type });
          running = null;
        }
      }
      return ended;
    },
  };
}

/** What an episode was aimed at, as the scorebook files it. */
export function aimOf(e: Pick<Episode, "toward" | "towardId">): Aim | undefined {
  return e.toward === undefined ? undefined : { kind: e.toward, ...(e.towardId === undefined ? {} : { id: e.towardId }) };
}
