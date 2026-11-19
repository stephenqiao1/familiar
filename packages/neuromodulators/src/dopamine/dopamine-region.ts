import type { Region, SkillEvent, State, Workspace } from "@familiar/contracts";
import { cueProposals, towardKey, type Thing } from "./cues.js";
import { createEpisodeTracker, type EndedEpisode } from "./episodes.js";
import { createMood } from "../mood.js";
import { createHabituation } from "./habituation.js";
import { checkRules, type RewardRule } from "./rewards.js";
import { createScorebook, type Scorebook } from "./scorebook.js";
import { BAD_SURPRISE_SIGNAL, createTonicDopamine, DOPAMINE_SIGNAL, NOVELTY_SIGNAL, RESTING_DA, REWARD_SIGNAL, SURPRISE_SIGNAL } from "./tonic.js";

export interface DopamineOptions {
  rules: RewardRule[];
  /** A short label for the state's rough situation, e.g. "night/safe/fed/surface/alone". */
  situationOf(state: State): string;
  /** Default: a new, empty one. */
  scorebook?: Scorebook;
  /** How far each surprise moves the scorebook. Default: 0.1. */
  learningRate?: number;
  /**
   * How long a learning window stays open after a notable event, in ms. With a window, skill values
   * are fully updated only inside one and much less outside: the window says when to learn, the
   * surprise how much. Default: no window (always learn in full).
   */
  learningWindowMs?: number;
  /** Something else notable happened this tick (e.g. an alarm jump or a cue): it opens a window too. Default: never. */
  notable?(ws: Workspace): boolean;
  /** Where DA rests with no recent reward. Default: 0.5. */
  restingDA?: number;
  /** Everything in view the bot could aim a skill at, nearest first. Default: nothing (no cues). */
  thingsOf?(state: State): Thing[];
  /** The things in view worth heading toward (cues fire only for these, never for threats). Default: everything from `thingsOf`. */
  cueThingsOf?(state: State): Thing[];
  /** Asleep: cues propose nothing (a cue is not a wake event). Default: never. */
  asleep?(ws: Workspace): boolean;
  /** The skills that would head toward a thing right now (e.g. ["go_to"]). Default: none. */
  skillsToward?(thing: Thing): string[];
  /** Default: "dopamine". */
  name?: string;
  /** Default: 0 (runs inside every tick). */
  layer?: number;
}

/** A reward at least this big (good or bad) is a notable event: it opens a learning window. */
const NOTABLE_REWARD = 0.1;
/** Outside a learning window, skill values move this much of the usual step. */
const OUTSIDE_WINDOW = 0.2;

/** Guardrail: an episode that ended in death learns from this outcome (or worse), a large negative surprise. */
export const DEATH_OUTCOME = -5;
/** A death with no skill running is blamed on a skill that ended at most this long before. */
export const BLAME_WINDOW_MS = 10_000;

/**
 * Dopamine, steps 1 to 7. Each tick it:
 *   1. runs every reward rule on what changed since the last tick (repeated rewards from the
 *      same rule shrink), and adds the rewards to the running skill's episode;
 *   2. shares the tonic DA level (0..1, a fading measure of recent reward) as the "dopamine" signal,
 *      and this tick's positive reward, novelty reward and biggest surprise as signals;
 *   3. when a skill ends (done, failed or interrupted), teaches the scorebook from the surprise:
 *      the episode's outcome minus what it expected for that skill (and for that skill aimed at
 *      that kind of thing) in the situation it started in, and counts the run as a success
 *      (done) or not (failed). A death makes the outcome at most
 *      DEATH_OUTCOME; with no skill running, the skill that ended just before takes the blame;
 *   4. proposes heading toward things in view that paid off before (cues);
 *   5. logs mood, a running average of recent surprises (only logged for now).
 * The arbiter reads DA and the scorebook. A rule that throws is skipped and named in the trace.
 */
export function createDopamineRegion(options: DopamineOptions): Region {
  const { rules, situationOf, scorebook = createScorebook(), learningRate = 0.1, thingsOf = () => [], skillsToward = () => [] } = options;
  const { restingDA = RESTING_DA, name = "dopamine", layer = 0 } = options;
  const episodes = createEpisodeTracker();
  const tonic = createTonicDopamine(restingDA);
  const habituation = createHabituation();
  const mood = createMood();
  /** The latest episode that ended, and when, for blaming a death between skills. */
  let lastEnded: { episode: EndedEpisode; at: number } | null = null;
  let before: State | null = null;
  const seen = new WeakSet<SkillEvent>();

  /** Teaches the scorebook from one ended episode, also under the kind of thing it was aimed at. */
  /** The learning step right now: full inside a learning window (or with none), reduced outside. */
  let step = learningRate;
  let windowUntil = -Infinity;

  function learn(e: EndedEpisode) {
    const outcome = e.fatal ? Math.min(e.outcome, DEATH_OUTCOME) : e.outcome;
    const surprise = scorebook.learn(e.situation, e.skill, outcome, step);
    if (e.toward !== undefined) scorebook.learn(e.situation, towardKey(e.skill, e.toward), outcome, step);
    mood.feel(surprise, before?.timestamp ?? 0);
    return { ...e, outcome, surprise, ...scorebook.get(e.situation, e.skill) };
  }

  return {
    name,
    layer,
    everyMs: 0,
    run(ws) {
      const after = ws.state;
      const events = ws.recentEvents.filter((e) => !seen.has(e));
      for (const e of events) seen.add(e);
      const moment = before && { before, after, events };
      before = after;
      if (!moment) {
        ws.setSignal(DOPAMINE_SIGNAL, tonic.update(0, after.timestamp));
        return { proposals: [] };
      }

      const { rewards, errors } = checkRules(rules, moment, habituation);
      const total = rewards.reduce((sum, r) => sum + r.amount, 0);
      const fatal = rewards.some((r) => r.fatal);
      const opened = options.learningWindowMs !== undefined && (Math.abs(total) >= NOTABLE_REWARD || fatal || (options.notable?.(ws) ?? false));
      if (opened) windowUntil = after.timestamp + options.learningWindowMs!;
      const inWindow = options.learningWindowMs === undefined || after.timestamp <= windowUntil;
      step = learningRate * (inWindow ? 1 : OUTSIDE_WINDOW);
      const credited = episodes.credit(total, fatal);
      const blamed = fatal && !credited && lastEnded && after.timestamp - lastEnded.at <= BLAME_WINDOW_MS ? learn({ ...lastEnded.episode, fatal: true }) : null;
      const da = tonic.update(total, after.timestamp);
      ws.setSignal(DOPAMINE_SIGNAL, da);
      ws.setSignal(REWARD_SIGNAL, total);
      ws.setSignal(NOVELTY_SIGNAL, rewards.reduce((sum, r) => (r.need === "curiosity" ? sum + r.amount : sum), 0));
      // A skill starts after the tick that chose it, so it belongs to that tick's situation.
      const kinds = new Map(thingsOf(moment.before).map((t) => [t.id, t.kind]));
      const ended = episodes.apply(events, situationOf(moment.before), (target) => kinds.get(target));
      for (const e of ended) if (e.ended !== "interrupted") scorebook.record(e.situation, e.skill, e.ended === "done");
      const learned = ended.map(learn);
      ws.setSignal(SURPRISE_SIGNAL, Math.max(0, ...learned.map((e) => Math.abs(e.surprise))));
      ws.setSignal(BAD_SURPRISE_SIGNAL, Math.max(0, ...learned.map((e) => -e.surprise)));
      if (learned.length) lastEnded = { episode: learned.at(-1)!, at: after.timestamp };
      const situation = situationOf(after);
      const { cues, proposals } = cueProposals({ things: (options.cueThingsOf ?? thingsOf)(after), situation, da, scorebook, skillsToward });
      return {
        proposals: options.asleep?.(ws) ? [] : proposals,
        trace: {
          situation,
          rewards,
          total,
          mood: mood.level(after.timestamp),
          ...(opened ? { learningWindow: "opened" } : {}),
          ...(learned.length && !inWindow ? { learnedOutsideWindow: true } : {}),
          ...(learned.length ? { episodes: learned } : {}),
          ...(blamed ? { blamedForDeath: blamed } : {}),
          ...(cues.length ? { cues } : {}),
          ...(Object.keys(errors).length ? { errors } : {}),
        },
      };
    },
  };
}
