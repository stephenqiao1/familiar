export interface ChoiceAnswer {
  kind: "choice";
  id: string;
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

export interface ScoreAnswer {
  kind: "score";
  id: string;
  score: number;
  confidence: number;
}

export interface NoulAnswer {
  kind: "noul";
  id: string;
  /** From 0 to 1. */
  value: number;
}

export type Answer = ChoiceAnswer | ScoreAnswer | NoulAnswer;
