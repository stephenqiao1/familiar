import type { Skill } from "@familiar/contracts";
import type { ReticularOptions } from "@familiar/region-brainstem";
import { defenceOf } from "./defence.js";
import { minecraftDataOf } from "./read-state.js";

// What the reticular formation needs from the player: what the moment is like (night, safe,
// idle, still, in bed), and which skill is going to bed.
// Change what counts as restful, or which skill is bed, here.

const MAX_HEALTH = 20;
/** A threat at least this pressing (seen) means the moment is not safe. */
const SEEN = 0.5;
/** With nothing running, or one of these, there is nothing to do. */
const RESTING = new Set(["idle", "sleep", "recuperate"]);
const BED_SKILL = "sleep";
/** A state made without a clock is taken to be the middle of the night. */
const MID_NIGHT = 0.5;

/**
 * `whyNoSleep` says in words why the bed skill cannot start right now (no bed in reach, it is
 * day); without it the reason is just that it cannot.
 */
export function playerReticular<Ctx>(skills: Skill<Ctx>[], ctx: Ctx, whyNoSleep: () => string | null = () => null): Pick<ReticularOptions, "moment" | "bed"> {
  const find = (name: string | undefined) => skills.find((s) => s.name === name);
  const bed = find(BED_SKILL);
  return {
    moment(ws) {
      const data = minecraftDataOf(ws.state);
      if (!data) return null;
      const running = find(ws.current?.skill);
      return {
        // The body clock says what time it is; with no hypothalamus (or its clock off), the state does.
        night: ws.needs?.clock?.night ?? data.time.isNight,
        ...(ws.needs?.clock ? { nightness: ws.needs.clock.night ? 1 - ws.needs.clock.dawn : ws.needs.clock.dusk } : {}),
        nightProgress: ws.needs?.clock?.night ? ws.needs.clock.nightProgress : (data.time.nightProgress ?? MID_NIGHT),
        safe: defenceOf(data).choice.threat < SEEN,
        idle: ws.current === null || RESTING.has(ws.current.skill),
        still: !data.self.locomotion.moving,
        asleep: data.self.asleep,
        demanding: running?.demanding ?? false,
        risky: running?.risky ?? false,
        health: data.self.health / MAX_HEALTH,
      };
    },
    ...(bed
      ? {
          bed: {
            skill: BED_SKILL,
            // Already on the way to bed: keep speaking for it.
            problem: (ws) => (ws.current?.skill === BED_SKILL || bed.canRun(ctx) ? null : (whyNoSleep() ?? "sleep is not possible right now")),
          },
        }
      : {}),
  };
}
