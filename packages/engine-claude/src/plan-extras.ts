import { z } from "zod";

// What more a plan may say once the cortex can use it: steps in full (for the motor area), hold-backs
// with a strength and an end, and a priority. Each is switched on by the bot's `cortex` settings;
// with none on, the planner is asked exactly what it was asked before.

export interface PlannerExtras {
  /** Steps may name a skill, a target, a "done when" and a "give up when". */
  steps?: boolean;
  /** A hold-back has a strength and may have an end. */
  holdBack?: boolean;
  /** The goal has a priority. */
  priority?: boolean;
  /** The plan may say what to expect. */
  expect?: boolean;
  /** The planner keeps notes between plans. */
  notes?: boolean;
}

export const fullSteps = z
  .array(
    z.object({
      text: z.string().describe("The step in a few words."),
      skill: z.string().optional().describe("The name of one of the listed abilities that does this step. Leave out if no single ability does it: the agent's faster part then chooses how."),
      target: z.string().optional().describe("What the ability is aimed at: an id from the situation (for example a chest's pos:x,y,z). Leave out if it needs none."),
      doneWhen: z.string().optional().describe("When the step is finished, written in the condition vocabulary the situation gives. It is checked many times a second, and the step ends the moment it is true."),
      giveUpWhen: z.string().optional().describe("When to stop trying this step and plan again, in the same vocabulary. Leave out if there is no such moment."),
    }),
  )
  .describe("A few short steps toward the goal, in order. Give each a doneWhen wherever the vocabulary can say it: steps with one are carried out and finished without waiting for you.");

export const fullHoldBack = z
  .array(
    z.object({
      name: z.string().describe("A reflex from the list the situation gives."),
      strength: z.number().describe("How far to hold it back, from 0 (not at all) to 1 (as far as it can be)."),
      untilStepDone: z.boolean().optional().describe("True to hold it back only until the step now under way is finished."),
      forSeconds: z.number().optional().describe("Hold it back for this many seconds only. Leave out (and untilStepDone too) to hold it back for as long as the goal."),
    }),
  )
  .describe("Reflexes to hold back while pursuing this goal, each with how strongly and until when. Life-saving reflexes cannot be held back. Empty unless the goal needs it.");

export const PRIORITY = z.number().describe("How much this goal matters, from 0 to 1. 0.5 is an ordinary goal. The agent's body and its faster parts still decide moment to moment: a higher priority makes the steps you give win more often.");

export const EXPECT = z
  .array(
    z.object({
      what: z.string().describe("What should be so, as a condition in the vocabulary the situation gives (for example: sees chest)."),
      when: z.string().optional().describe("When it should be so, as a condition in the same vocabulary (for example: within 6 of base chest). Leave out if it should always be so."),
    }),
  )
  .describe("Up to 3 things you expect to find while pursuing this goal. If one turns out not to be so, you are told at once. Empty if there is nothing in particular.");

export const NOTES = z
  .array(z.object({ key: z.string().describe("A word or two to name the note by. Use the same key to keep or change a note you were shown."), text: z.string().describe("One short line.") }))
  .describe("The notes you want to have next time, at most 5: repeat each note you were shown that you still need (same key; same text to keep it, new text to change it), and add any new one. A note you leave out three plans running is dropped. Empty if you need none.");

export const DROP_NOTES = z.array(z.string()).describe("Keys of notes you no longer need, to drop at once. Empty if none.");

/** A hold-back as the model wrote it (a name, or a name with a strength and an end), in the plan's own form. */
export function asHoldBack(held: string | { name: string; strength: number; untilStepDone?: boolean | undefined; forSeconds?: number | undefined }) {
  if (typeof held === "string") return held;
  const { name, strength, untilStepDone, forSeconds } = held;
  return { name, strength, ...(untilStepDone ? { until: "step" as const } : forSeconds && forSeconds > 0 ? { until: forSeconds } : {}) };
}

/** What the planner is told about each extra, added to its role. */
export const CORTEX_ROLE = {
  steps:
    "A step can name the ability that does it and a doneWhen condition: such a step is carried out for you and finished the moment its condition is true, " +
    "so do not count it in stepsDone. A step with no doneWhen is left to the agent's faster part and judged by you, as before. If you are told a step is stuck, plan another way.",
  holdBack: "A hold-back has a strength, and can end when the current step is done or after some seconds: hold a reflex back no more and no longer than the goal needs.",
  priority: "Give the goal a priority: it is what your steps are worth against everything else the agent could be doing.",
  notes:
    "You keep a few notes between plans (notes): you remember nothing else from one plan to the next. Use them for what you have tried and how it went, what you are waiting for, and what you decided and why. " +
    "They are few (5 at the most) and short, so keep only what will change a later plan, and drop a note once it no longer matters. Read your notes before you plan: do not repeat what a note says failed.",
  expect: "You can say what you expect to find (expect). You are told at once when an expectation does not hold, or when a place the agent knows well is not as it usually is.",
};
