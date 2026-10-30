import type { Question } from "@familiar/contracts";

/** The questions asked every tick in M0. */
export const questions: Question[] = [
  { kind: "choice", id: "next_action", prompt: "What should I do next?", options: ["idle", "look_around"] },
];
