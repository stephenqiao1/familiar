import type { BodyPart, Changes } from "@familiar/contracts";
import { createTiming, giveUpBase, learnedExpectations, LIMIT_BOUNDS, predict, type CerebellumSettings, type ModelStore, type Movement } from "@familiar/region-cerebellum";
import type { LearnedPace } from "../locomotion/learned-pace.js";
import type { LearnedCheck, MovementFacts } from "../movements.js";
import { changeList, keysOf, TODAY_GIVE_UP_SECONDS } from "./cerebellum.js";

// What the rest of the player takes from the cerebellum's models. One function per reader; each
// answers with the bot's fixed rule while its strength is 0 or the model is not trusted. The
// cerebellum chooses nothing here: it only supplies the numbers.

export interface TimingSources {
  /** The last event the bot remembered, by label, and when. */
  latest(): { label: string; at: number } | null;
  /** The known "leads to" pairs: [the sign, what follows it]. */
  leadsTo(): [string, string][];
}

export interface PlayerCerebellum {
  /** For the locomotion controller: the pace on each kind of ground. */
  pace: LearnedPace;
  /** For the give-up clock: a skill's own base, in ms, and the most that can be. */
  giveUpBaseMs(skill: string, now: number): number;
  mostBaseMs: number;
  /** For the motor area's stuck clock: how long a skill usually takes, in ms, or null while that is not known. */
  usualMs(skill: string, now: number): number | null;
  /** For the primitives: what to expect of a movement here instead of its written list. */
  expects(name: string, facts: MovementFacts, parts: readonly BodyPart[], written: readonly string[]): LearnedCheck | null;
  /** The delays between events known to follow each other, as movements to learn from. Call once a tick. */
  timings(): Movement[];
  /** For the defence: whether harm from this kind of thing is due about now. */
  due(kind: string, now: number): boolean;
  /** For the log: what is due soon. */
  notes(now: number): Record<string, unknown>;
}

const thingOf = (label: string) => label.split("|")[1] ?? "";

export function playerCerebellum(parts: { store: ModelStore; settings: CerebellumSettings; timing?: TimingSources }): PlayerCerebellum {
  const { store, settings } = parts;
  const timing = createTiming({ store, settings, pairs: () => parts.timing?.leadsTo() ?? [] });
  let lastEvent = 0;
  return {
    pace: {
      pace: (pattern, facts) => predict(store, "pace", pattern, keysOf({ kind: "pace", facts }), "secondsPerBlock", Date.now(), settings),
      strengths: () => settings,
    },
    giveUpBaseMs: (skill, now) => giveUpBase(store, skill, TODAY_GIVE_UP_SECONDS * 1000, now, settings).ms,
    mostBaseMs: LIMIT_BOUNDS.most * TODAY_GIVE_UP_SECONDS * 1000,
    usualMs(skill, now) {
      const usual = predict(store, "skill", skill, [""], "seconds", now, settings);
      return usual ? usual.value * 1000 : null;
    },
    expects(name, facts, bodyParts, written) {
      const learned = learnedExpectations(store, "primitive", name, keysOf({ kind: "primitive", facts, parts: bodyParts }), written, Date.now(), settings);
      return learned && { expects: learned.expects, why: learned.why, met: (changes: Changes) => learned.expects.every((c) => changeList(changes).includes(c)) };
    },
    timings() {
      const event = parts.timing?.latest();
      if (!event || event.at <= lastEvent) return [];
      lastEvent = event.at;
      return timing.event(event.label, event.at);
    },
    due: (kind, now) => timing.due(now).some((d) => thingOf(d.sign) === kind || thingOf(d.what) === kind),
    notes(now) {
      const due = timing.due(now);
      return due.length ? { due } : {};
    },
  };
}
