import type { Action, Candidate, Skill, Workspace } from "@familiar/contracts";
import { ONE_CONTEST, type Body, type Channel } from "@familiar/basal-ganglia";
import { headFree, usesNothing } from "@familiar/minecraft";

/**
 * The parts of the body that can act by themselves, each with a contest of its own in the basal
 * ganglia. The first is the main one: its winner is the action, the others' winners run alongside.
 * To add a channel, add an entry (the executor has one place beside the main skill, so with a
 * third channel only the most urgent of the two runs alongside until it has more).
 */
export const CHANNELS: Channel[] = [
  { name: "body", parts: ["legs", "hands"] },
  { name: "head", parts: ["head"] },
];

/** The body parts an action would use: a skill's own; keeping going (or stopping) is about whatever is running. */
export function partsOf<Ctx>(skills: readonly Skill<Ctx>[]) {
  const named = (name: string | undefined) => skills.find((s) => s.name === name);
  return (action: Action, ws: Workspace): readonly string[] | undefined => {
    if ("skill" in action) return named(action.skill)?.parts;
    return ws.current ? named(ws.current.skill)?.parts : [];
  };
}

/** A reflex that claims no part of the body (a flinch) runs beside whatever is under way. */
const flinch = <Ctx>(skills: readonly Skill<Ctx>[]) => (c: Candidate) => {
  const skill = "skill" in c.action ? skills.find((s) => s.name === (c.action as { skill: string }).skill) : undefined;
  return skill?.reflexOnly === true && skill.parts?.length === 0;
};

/**
 * The body as the basal ganglia see it. With channels on: a contest for each channel. With them
 * off: one contest, and the rule from before channels for what runs alongside it (a flinch
 * always; a head-only movement beside idling, or with `sameTime` beside a skill that leaves the head free).
 */
export function bodyOf<Ctx>(skills: readonly Skill<Ctx>[], options: { channels: number; sameTime?: boolean }): Body {
  const isFlinch = flinch(skills);
  if (options.channels > 0) return { channels: CHANNELS, partsOf: partsOf(skills), free: isFlinch };
  const named = (name: string | undefined) => skills.find((s) => s.name === name);
  return {
    ...ONE_CONTEST,
    free(c, ws) {
      if (isFlinch(c)) return true;
      const parts = "skill" in c.action ? named(c.action.skill)?.parts : undefined;
      const running = named(ws.current?.skill);
      return parts?.length === 1 && parts[0] === "head" && (usesNothing(running) || ((options.sameTime ?? false) && headFree(running)));
    },
  };
}
