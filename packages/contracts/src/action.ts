/** Run a skill, or keep doing the current one. */
export type Action = { skill: string; target?: string } | { keepGoing: true };
