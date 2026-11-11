import { describe, expectTypeOf, it } from "vitest";
import type {
  Action,
  Answer,
  Choice,
  ChoiceAnswer,
  DecisionEngine,
  Noul,
  NoulAnswer,
  Question,
  Score,
  ScoreAnswer,
  State,
  TickLog,
} from "./index.js";

const state = {
  schemaVersion: 1,
  tick: 0,
  timestamp: 0,
  data: { anything: true },
} satisfies State;

const choice = { kind: "choice", id: "q1", prompt: "Next?", options: ["mine", "flee"] } satisfies Choice;
const score = { kind: "score", id: "q2", prompt: "Danger?", min: 0, max: 10 } satisfies Score;
const noul = { kind: "noul", id: "q3", statement: "I am hungry" } satisfies Noul;
const questions: Question[] = [choice, score, noul];

const choiceAnswer = {
  kind: "choice",
  id: "q1",
  choice: "mine",
  probabilities: { mine: 0.9, flee: 0.1 },
  confidence: 0.9,
} satisfies ChoiceAnswer;
const scoreAnswer = { kind: "score", id: "q2", score: 3, confidence: 0.7 } satisfies ScoreAnswer;
const noulAnswer = { kind: "noul", id: "q3", value: 0.2 } satisfies NoulAnswer;
const answers: Answer[] = [choiceAnswer, scoreAnswer, noulAnswer];

const engine: DecisionEngine = {
  name: "sample",
  decide: async () => answers,
};

const actions: Action[] = [{ skill: "mine", target: "stone" }, { skill: "idle" }, { keepGoing: true }];

const log = {
  tick: 0,
  timestamp: 0,
  state,
  encodeMs: 1,
  decideMs: 1,
  regions: [{ region: "instinct", layer: 1, ms: 1, proposals: [{ action: { skill: "mine" }, urgency: 0.5, reason: "ore nearby" }] }],
  winner: null,
  action: { keepGoing: true },
  goal: null,
  signals: {},
} satisfies TickLog;

describe("contracts", () => {
  it("accepts a sample of each type", () => {
    expectTypeOf(state).toExtend<State>();
    expectTypeOf(questions).toEqualTypeOf<Question[]>();
    expectTypeOf(answers).toEqualTypeOf<Answer[]>();
    expectTypeOf(engine.decide).returns.toEqualTypeOf<Promise<Answer[]>>();
    expectTypeOf(actions).toEqualTypeOf<Action[]>();
    expectTypeOf(log).toExtend<TickLog>();
  });

  it("rejects malformed values", () => {
    // @ts-expect-error unknown question kind
    const badQuestion: Question = { kind: "pick", id: "x", prompt: "?" };
    // @ts-expect-error keepGoing must be true
    const badAction: Action = { keepGoing: false };
    // @ts-expect-error noul answers have no confidence
    const badNoul: NoulAnswer = { kind: "noul", id: "x", value: 1, confidence: 1 };
    void [badQuestion, badAction, badNoul];
  });
});
