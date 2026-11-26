import type { NeedReading, Region, SkillEvent, State, Workspace } from "@familiar/contracts";
import { aimAt, cueProposals, type Cue, type Thing } from "./cues.js";
import { aimOf, createEpisodeTracker, type EndedEpisode } from "./episodes.js";
import { createMood } from "../mood.js";
import { needChangeReward } from "./need-change.js";
import { checkRules, needLevels, type LoggedReward, type RewardMoment, type RewardRule } from "./rewards.js";
import { type Aim, createScorebook, type Scorebook } from "./scorebook.js";
import { effortOf, reliefIsTelling, reliefOf, retryAfter, trustAfter, withTheRest, type NeedLevels } from "./wanting.js";
import { WASTED_EFFORT_RULE, wastedEffort } from "./wasted.js";
import { BAD_SURPRISE_SIGNAL, createTonicDopamine, DOPAMINE_SIGNAL, NOVELTY_SIGNAL, RESTING_DA, REWARD_SIGNAL, SURPRISE_SIGNAL, WANT_SIGNAL } from "./tonic.js";

export interface DopamineOptions {
  rules: RewardRule[];
  /** A short label for the state's rough situation, e.g. "night/safe/fed/surface/alone". */
  situationOf(state: State): string;
  /** Default: a new, empty one. */
  scorebook?: Scorebook;
  /** How far each surprise moves the scorebook. Default: 0.1. */
  learningRate?: number;
  /**
   * How far the size of a surprise sets how fast it is learned from (0 to 1). At 1 a run that
   * went about as expected moves the scorebook a fifth as far as the usual step, and one that
   * was a real surprise the whole step (see attentionTo): noise is shrugged off, news is taken
   * in. Default: 0 (always learn in full).
   */
  surpriseLearning?: number;
  /**
   * Something notable just happened, 0 to 1 (the colliculus's `orienting`: a thing stood out,
   * before anything knew what it was). A run that ends within `NOTICED_MS` of it is learned from
   * at no less than this share of the usual step, so what the bot was just doing is linked to
   * the event. It is not a reward: it pays nothing and moves no expectation by itself.
   * Default: never.
   */
  noticed?(ws: Workspace): number;
  /** Told each tick what is wanted in view and how much (the cues), for whoever else needs it: wanting is worked out once, here. Default: nobody. */
  onCues?(cues: Cue[]): void;
  /**
   * The body's needs, as read this tick (by the hypothalamus; or worked out from the state with
   * it left out). With this, a need is not a rule: each is paid the signed change in its level
   * since the last tick (see needChangeReward), and its level and how hard it presses are used
   * for learning what relieves it and for wanting. Default: none (only rules that read a level
   * of their own count as needs).
   */
  needs?: {
    now(ws: Workspace): Pick<NeedReading, "name" | "kind" | "level" | "pressing">[];
    /** No need is compared across this moment (a new life: nothing the bot achieved). Default: never. */
    fresh?(moment: RewardMoment): boolean;
    /** What a change in one need is called in the log ("food 5 → 10"). Default: the need's name. */
    say?(name: string, moment: RewardMoment): string;
  };
  /**
   * The work the body did between two ticks, in reward units: what that stretch costs if the
   * running skill comes to nothing (see wastedEffort). Default: none, so nothing is ever wasted.
   */
  effortOf?(moment: RewardMoment): number;
  /**
   * How much of the change in a situation's worth is counted for or against the skill that ran
   * through it (0 to 1). A skill is then judged on the difference it made, not on trouble it
   * started in. Default: 1. At 0, a skill is paid and charged for whatever happened while it ran.
   */
  situationWorth?: number;
  /** How strongly a wanted thing in view pulls: scales the urgency of cues (0: none). Default: 1. */
  wanting?: number;
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

/** A run that went exactly as expected is learned from at this share of the usual step... */
const LEAST_ATTENTION = 0.2;
/** ...rising to the whole step for a surprise this big or bigger. */
const FULL_ATTENTION_AT = 0.3;

/**
 * How much of the usual learning step a surprise of this size gets (0.2 to 1). The surprise
 * itself says how much there is to learn: nothing else has to have happened first.
 */
/** A notable event counts for the runs that end within this long of it. */
export const NOTICED_MS = 2000;

export function attentionTo(surprise: number): number {
  return LEAST_ATTENTION + (1 - LEAST_ATTENTION) * Math.min(1, Math.abs(surprise) / FULL_ATTENTION_AT);
}

/** The scorebook's name for a situation by itself, whatever skill is running: what tends to follow from being in it. */
export const SITUATION = "(situation)";
/** What follows a situation counts for half as much this long afterwards, in ms. */
const WORTH_HALF_LIFE_MS = 10_000;
/**
 * A surprise is also put down to the situations just before the one it happened in, for half as
 * much this long ago, in ms. The harm of a fall shows a moment after the fall is over; without
 * this it would be blamed on standing still.
 */
const TRACE_HALF_LIFE_MS = 1000;
/** Situations fainter than this in the trace are dropped. */
const FAINT = 0.05;

/** Guardrail: an episode that ended in death learns from this outcome (or worse), a large negative surprise. */
export const DEATH_OUTCOME = -5;
/** A death with no skill running is blamed on a skill that ended at most this long before. */
export const BLAME_WINDOW_MS = 10_000;

/**
 * Dopamine, steps 1 to 7. Each tick it:
 *   1. runs every reward rule on what changed since the last tick, and adds the rewards (a need
 *      that fell pays, one that rose costs) to the running skill's episode;
 *   2. shares the tonic DA level (0..1, a fading measure of recent reward) as the "dopamine" signal,
 *      and this tick's positive reward, novelty reward and biggest surprise as signals;
 *   3. when a skill ends (done, failed or interrupted), teaches the scorebook from the surprise:
 *      the episode's outcome minus what it expected for that skill, in the situation it started
 *      in, aimed at that thing (see the scorebook's levels), and counts the run as a success
 *      (done) or not (failed). A death makes the outcome at most
 *      DEATH_OUTCOME; with no skill running, the skill that ended just before takes the blame.
 *      A run that was expected to pay and earned less than the work it took is charged the
 *      difference (wasted effort), which is logged as a reward and lowers DA like any other;
 *      A skill is judged on the difference it made. The region also learns what each situation
 *      is worth by itself (what tends to follow from it, whatever is running), and a skill is
 *      credited with the change in that worth from where it started to where it ended: one that
 *      starts in trouble is not blamed for the harm already coming, and one that walks into
 *      trouble is. A run cut short is taken to have been going to earn the rest of what was
 *      expected, so only what actually happened to it is learned; but each time in a row it is
 *      cut short with no finished run between, that is trusted less (see trustAfter), so a run
 *      that never gets to finish is given up on. A tick's rewards go to the skill that ran for
 *      the most of that tick;
 *   4. learns what each run did to each need (how far its level fell from the run's start to its
 *      end: its relief) and the work it took, each filed like a skill of its own (see reliefOf);
 *   5. proposes heading toward the things in view that would pay right now (cues): each thing is
 *      weighed by itself, by the relief learned for it, how pressing each need is, and the work of getting there (see cueProposals);
 *   6. logs mood, a running average of recent surprises (only logged for now).
 * The arbiter reads DA and the scorebook. A rule that throws is skipped and named in the trace.
 */
export function createDopamineRegion(options: DopamineOptions): Region {
  const { rules, situationOf, scorebook = createScorebook(), learningRate = 0.1, thingsOf = () => [], skillsToward = () => [] } = options;
  const { restingDA = RESTING_DA, name = "dopamine", layer = 0, situationWorth = 1 } = options;
  const worthOf = (situation: string) => scorebook.get(situation, SITUATION).expected;
  /** The situations the bot has just been in, and how fresh each still is (1 = this tick). */
  let trace = new Map<string, number>();
  const episodes = createEpisodeTracker();
  const tonic = createTonicDopamine(restingDA);
  const mood = createMood();
  /** The latest episode that ended, and when, for blaming a death between skills. */
  let lastEnded: { episode: EndedEpisode; at: number } | null = null;
  let before: State | null = null;
  /** How pressing each need was at the last tick. */
  let levels: NeedLevels = {};
  const seen = new WeakSet<SkillEvent>();

  const surpriseLearning = Math.min(1, Math.max(0, options.surpriseLearning ?? 0));
  /** Learns one outcome at the step its own surprise calls for; returns the surprise and the share of the usual step it got. */
  /** The strongest notable event lately, and when. */
  let noticed = { strength: 0, at: -Infinity };
  let clock = 0;
  function learnAt(situation: string, skill: string, outcome: number, aim: Aim | undefined) {
    const event = clock - noticed.at <= NOTICED_MS ? noticed.strength : 0;
    const bySurprise = attentionTo(outcome - scorebook.get(situation, skill, aim).expected);
    const attention = 1 - surpriseLearning * (1 - Math.max(event, bySurprise));
    return { surprise: scorebook.learn(situation, skill, outcome, learningRate * attention, aim), attention, ...(event > bySurprise ? { noticed: event } : {}) };
  }

  /** Wants that are waiting to be tried again (see retryAfter), by skill and thing, and until when. */
  const heldUntil = new Map<string, number>();
  const wantKey = (skill: string, thingId: string | undefined) => `${skill}\n${thingId ?? ""}`;

  /** The effort a run wasted: charged only if the run (this skill, here, aimed at this thing) was expected to pay. */
  function wasteOf(e: EndedEpisode): number {
    return wastedEffort(e, scorebook.get(e.situation, e.skill, aimOf(e)).expected);
  }

  /**
   * What the run did to each need: how far its level fell from the run's start to `now`. Each is
   * learned as the relief to expect of this skill, here, aimed at this thing. A need that could
   * not have shown the expected relief (it was not pressing enough to begin with) teaches nothing.
   */
  function learnReliefs(e: EndedEpisode, now: NeedLevels, cut: boolean, trust: number): Record<string, number> {
    const reliefs: Record<string, number> = {};
    if (e.fatal) return reliefs; // a respawn refills everything: nothing the run did
    for (const [need, atStart] of Object.entries(e.needs ?? {})) {
      if (now[need] === undefined) continue;
      const got = atStart - now[need];
      const expected = scorebook.get(e.situation, reliefOf(e.skill, need), aimOf(e)).expected;
      if (got === 0 && expected === 0) continue;
      const relief = cut ? withTheRest(got, expected, trust) : got;
      if (!reliefIsTelling(atStart, relief, expected)) continue;
      learnAt(e.situation, reliefOf(e.skill, need), relief, aimOf(e));
      if (got !== 0) reliefs[need] = Math.round(got * 1000) / 1000;
    }
    return reliefs;
  }

  /** Teaches the scorebook from one ended episode; `endedIn` is the situation it ended in, `now` how pressing each need is at its end. */
  function learn(e: EndedEpisode, endedIn: string, now: NeedLevels) {
    const expected = scorebook.get(e.situation, e.skill, aimOf(e)).expected;
    // The difference it made to the situation: better or worse off than where it started.
    const shift = e.fatal ? 0 : situationWorth * (worthOf(endedIn) - worthOf(e.situation));
    const earned = e.fatal ? Math.min(e.outcome, DEATH_OUTCOME) : e.outcome + shift;
    const wasted = wasteOf(e);
    // Cut short: what it was expected to earn and had not yet is taken as still to come, and
    // trusted less each time in a row this happens.
    // Not finished: cut short, or failed before its job was done. Neither shows what the thing gives.
    const cut = e.ended !== "done" && !e.fatal;
    const inARow = cut ? scorebook.cutShort(e.skill, aimOf(e)) : 0;
    const trust = cut ? trustAfter(inARow) : 1;
    // The same want is not acted on again at once: it waits, longer each time in a row; a finished run ends the wait.
    if (cut) heldUntil.set(wantKey(e.skill, e.towardId), (before?.timestamp ?? 0) + retryAfter(inARow));
    else heldUntil.delete(wantKey(e.skill, e.towardId));
    const unfinished = cut ? withTheRest(e.gained, expected, trust) - e.gained : 0;
    const outcome = earned - wasted + unfinished;
    const reliefs = learnReliefs(e, now, cut, trust);
    // The work it took (a run cut short took at least what such runs usually take).
    const usualWork = scorebook.get(e.situation, effortOf(e.skill), aimOf(e)).expected;
    if (e.effort > 0 || usualWork !== 0) learnAt(e.situation, effortOf(e.skill), cut ? Math.max(e.effort, usualWork) : e.effort, aimOf(e));
    const { surprise, attention, noticed: byEvent } = learnAt(e.situation, e.skill, outcome, aimOf(e));
    mood.feel(surprise, before?.timestamp ?? 0);
    return {
      ...e,
      outcome,
      surprise,
      ...(shift !== 0 ? { shift } : {}),
      ...(unfinished > 0 ? { unfinished } : {}),
      ...(cut && trust < 1 ? { trust } : {}),
      ...(attention < 1 ? { attention: Math.round(attention * 100) / 100 } : {}),
      ...(byEvent === undefined ? {} : { noticed: Math.round(byEvent * 100) / 100 }),
      ...(wasted > 0 ? { wasted } : {}),
      ...(Object.keys(reliefs).length ? { reliefs } : {}),
      ...scorebook.get(e.situation, e.skill, aimOf(e)),
    };
  }

  return {
    name,
    layer,
    everyMs: 0,
    run(ws) {
      const after = ws.state;
      clock = after.timestamp;
      const event = Math.min(1, options.noticed?.(ws) ?? 0);
      if (event > 0 && (event >= noticed.strength || clock - noticed.at > NOTICED_MS)) noticed = { strength: event, at: clock };
      const events = ws.recentEvents.filter((e) => !seen.has(e));
      for (const e of events) seen.add(e);
      const moment = before && { before, after, events, ws };
      before = after;
      const readings = options.needs?.now(ws);
      const [was, now] = [levels, readings ? Object.fromEntries(readings.map((r) => [r.name, r.level])) : needLevels(rules, after)];
      levels = now;
      if (!moment) {
        ws.setSignal(DOPAMINE_SIGNAL, tonic.update(0, after.timestamp));
        return { proposals: [] };
      }

      const { rewards, errors } = checkRules(rules, moment);
      // A need pays the signed change in its level (one that a rule pays for itself is left to the rule).
      if (readings && !(options.needs?.fresh?.(moment) ?? false)) {
        const changed = readings.filter((r) => was[r.name] !== undefined && was[r.name] !== r.level && !rules.some((rule) => rule.name === r.name));
        rewards.unshift(...changed.map((r) => ({ rule: r.name, need: r.kind, amount: needChangeReward(was[r.name]!, r.level), reason: options.needs?.say?.(r.name, moment) ?? r.name })));
      }
      // Rewards about one skill go to that skill; the rest are whoever's was running.
      const about = rewards.filter((r): r is LoggedReward & { skill: string } => r.skill !== undefined);
      const anyones = rewards.filter((r) => r.skill === undefined);
      const earned = anyones.reduce((sum, r) => sum + r.amount, 0);
      const fatal = rewards.some((r) => r.fatal);
      let effort = 0;
      try {
        effort = options.effortOf?.(moment) ?? 0;
      } catch (error) {
        errors.effort = error instanceof Error ? error.message : String(error);
      }
      // This tick's rewards and work belong to the skill that ran for the most of it. A skill
      // starts after the tick that chose it, so it belongs to that tick's situation.
      const [here, there] = [situationOf(moment.before), situationOf(after)];
      const inView = new Map([...thingsOf(after), ...thingsOf(moment.before)].map((t) => [t.id, t]));
      const { ended, credited } = episodes.advance({
        events,
        from: moment.before.timestamp,
        to: after.timestamp,
        situation: here,
        aimOf: (target) => {
          const thing = inView.get(target);
          return thing && aimAt(thing);
        },
        needs: was,
        amount: earned,
        gained: anyones.reduce((sum, r) => sum + Math.max(0, r.amount), 0),
        effort,
        fatal,
        about,
      });
      // Effort that came to nothing is a reward like the rest: it lowers DA.
      for (const e of ended) {
        const wasted = wasteOf(e);
        if (wasted > 0) rewards.push(wastedReward(e, wasted));
      }
      const total = rewards.reduce((sum, r) => sum + r.amount, 0);
      const blamed = fatal && !credited && lastEnded && after.timestamp - lastEnded.at <= BLAME_WINDOW_MS ? learn({ ...lastEnded.episode, fatal: true }, there, now) : null;
      const da = tonic.update(total, after.timestamp);
      ws.setSignal(DOPAMINE_SIGNAL, da);
      ws.setSignal(REWARD_SIGNAL, total);
      ws.setSignal(NOVELTY_SIGNAL, Math.max(0, rewards.reduce((sum, r) => (r.need === "curiosity" ? sum + r.amount : sum), 0)));
      for (const e of ended) if (e.ended !== "interrupted") scorebook.record(e.situation, e.skill, e.ended === "done", aimOf(e));
      const learned = ended.map((e) => learn(e, there, now));
      // What this situation is worth: what it just paid, plus what the one it led to is worth
      // (counted for less the longer it took; nothing follows a death).
      const elapsed = Math.max(0, after.timestamp - moment.before.timestamp);
      const unforeseen = earned + (fatal ? 0 : 0.5 ** (elapsed / WORTH_HALF_LIFE_MS) * worthOf(there)) - worthOf(here);
      const stale = 0.5 ** (elapsed / TRACE_HALF_LIFE_MS);
      trace = new Map([...trace].map(([s, fresh]): [string, number] => [s, fresh * stale]).filter(([, fresh]) => fresh >= FAINT));
      trace.set(here, 1);
      for (const [recent, fresh] of trace) scorebook.learn(recent, SITUATION, worthOf(recent) + fresh * unforeseen, learningRate);
      if (fatal) trace.clear();
      ws.setSignal(SURPRISE_SIGNAL, Math.max(0, ...learned.map((e) => Math.abs(e.surprise))));
      ws.setSignal(BAD_SURPRISE_SIGNAL, Math.max(0, ...learned.map((e) => -e.surprise)));
      if (learned.length) lastEnded = { episode: learned.at(-1)!, at: after.timestamp };
      const situation = there;
      const { cues, proposals } = cueProposals({ things: (options.cueThingsOf ?? thingsOf)(after), situation, da, needs: readings ? Object.fromEntries(readings.map((r) => [r.name, r.pressing])) : now, scorebook, skillsToward: (thing) => skillsToward(thing).filter((skill) => !((heldUntil.get(wantKey(skill, thing.id)) ?? -Infinity) > after.timestamp)), strength: options.wanting ?? 1 });
      options.onCues?.(cues);
      const asleep = options.asleep?.(ws) ?? false;
      ws.setSignal(WANT_SIGNAL, asleep || !proposals.length ? 0 : Math.min(1, Math.max(...cues.map((c) => c.want))));
      return {
        proposals: asleep ? [] : proposals,
        trace: {
          situation,
          rewards,
          total,
          mood: mood.level(after.timestamp),
          ...(learned.length ? { episodes: learned } : {}),
          ...(blamed ? { blamedForDeath: blamed } : {}),
          ...(cues.length ? { cues } : {}),
          ...(Object.keys(errors).length ? { errors } : {}),
        },
      };
    },
  };
}

/** Wasted effort as it is logged beside the tick's other rewards. */
function wastedReward(e: EndedEpisode, wasted: number): LoggedReward {
  const aim = e.toward === undefined ? e.skill : `${e.skill} to the ${e.toward}`;
  return { rule: WASTED_EFFORT_RULE, need: "progress", amount: -wasted, reason: `${aim} came to nothing (effort ${e.effort.toFixed(3)}, earned ${e.gained.toFixed(3)})` };
}
