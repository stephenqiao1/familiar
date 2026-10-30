/** Pick one of up to 255 options. */
export interface Choice {
  kind: "choice";
  id: string;
  prompt: string;
  options: string[];
}

/** Rate something on a numeric scale from `min` to `max`. */
export interface Score {
  kind: "score";
  id: string;
  prompt: string;
  min: number;
  max: number;
}

/** Judge how true a statement is. */
export interface Noul {
  kind: "noul";
  id: string;
  statement: string;
}

export type Question = Choice | Score | Noul;
