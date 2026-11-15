// Live check of looking one way while walking another: the bot walks east along the plaza with
// go_to while look_at (run alongside) holds its head on a point to the north. An observer bot
// checks that it kept heading east, that its head really pointed north for a while, and that it arrived.
import type { SkillEvent } from "@familiar/contracts";
import type { SkillExecutor } from "@familiar/core";
import { reset, sleep, type Observer } from "./world.ts";

const GOAL = { x: 76, y: 151, z: 40 };
/** Straight north of the path's middle: 90 degrees left of the direction of travel. */
const LOOK = "pos:66,152,10";

export interface WalkAndLook {
  ok: boolean;
  detail: string;
}

export async function walkAndLook(executor: SkillExecutor, seen: Observer, sideEvents: SkillEvent[]): Promise<WalkAndLook> {
  await reset();
  sideEvents.length = 0;
  const start = seen.position();
  void executor.start("go_to", `pos:${GOAL.x},${GOAL.y},${GOAL.z}`);
  await sleep(900);
  await executor.startAlongside("look_at", LOOK);
  // Watch for two seconds: where the head points, and how far off the straight line east the bot strays.
  let lookedNorth = 0;
  let samples = 0;
  let strayed = 0;
  const from = seen.position();
  for (let i = 0; i < 20; i++) {
    await sleep(100);
    const at = seen.position();
    if (!at) continue;
    samples++;
    // Facing north (-z) is yaw 0; east is -90 degrees.
    if (Math.abs(Math.atan2(Math.sin(seen.yaw()), Math.cos(seen.yaw()))) < 0.5) lookedNorth++;
    strayed = Math.max(strayed, Math.abs(at.z - 40.5));
  }
  const during = seen.position();
  const eastward = from && during ? during.x - from.x : 0;
  for (let i = 0; i < 80 && executor.current(); i++) await sleep(100);
  const end = seen.position();
  const arrived = end !== null && Math.hypot(end.x - (GOAL.x + 0.5), end.z - (GOAL.z + 0.5)) <= 3;
  const mainSkillKept = !executor.current() && arrived;
  const look = sideEvents.filter((e) => e.skill === "look_at").map((e) => e.type);
  const ok = lookedNorth >= 5 && eastward > 3 && strayed < 1.5 && mainSkillKept && look.includes("started") && look.includes("done");
  return {
    ok,
    detail:
      `head pointed north in ${lookedNorth} of ${samples} samples; meanwhile it went ${eastward.toFixed(1)} blocks east, straying ${strayed.toFixed(1)} off the line; ` +
      `arrived: ${arrived} (started at x=${start?.x.toFixed(0)}, ended at x=${end?.x.toFixed(0)}); look_at alongside: ${look.join(", ") || "never ran"}`,
  };
}
