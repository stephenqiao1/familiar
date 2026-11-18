import type { Bot } from "mineflayer";
import pathfinderPkg from "mineflayer-pathfinder";
import type { goals } from "mineflayer-pathfinder";
import type { Vec3 } from "vec3";
import type { Answer, Query, RouteQueries } from "../defence/routes.js";

const { Movements } = pathfinderPkg;
const { GoalNear } = pathfinderPkg.goals;

/** Each slice of a question may think for this long. */
export const SLICE_MS = 1;
/** A threat counts as able to reach the bot by a route up to this much longer than the straight line. */
const REACH_DETOUR = 16;
/** A way out leads to somewhere at least this far from the threat, without passing this close to it. */
export const ESCAPE = { distance: 16, clearOf: 3, detour: 24 };
/** The pathfinder treats a step costing over 100 as impossible. */
const FORBIDDEN = 200;

/**
 * Asks the pathfinder the defence circuit's two questions (can this threat get to the bot, and
 * has the bot a way out), a slice at a time, without touching
 * the journey under way (each question gets its own search). Both use rules that walk only: no
 * digging, no placing, no jumping gaps. So a threat behind a closed door, or a way out through
 * one, counts as no route.
 */
export function createRouteQueries(bot: Bot): RouteQueries {
  let keepClear: { of: Vec3; within: number } | null = null;
  const walking = (excluding: boolean) => {
    const rules = new Movements(bot);
    rules.canDig = false;
    rules.allow1by1towers = false;
    rules.scafoldingBlocks = [];
    rules.allowParkour = false;
    rules.allowEntityDetection = false;
    if (excluding) rules.exclusionAreasStep = [(block) => (keepClear && block.position && block.position.distanceTo(keepClear.of) < keepClear.within ? FORBIDDEN : 0)];
    return rules;
  };
  const walker = walking(false);
  const runner = walking(true);

  /** Runs one search a slice at a time. `before` sets up anything the rules read during a slice. */
  function search(rules: InstanceType<typeof Movements>, from: Vec3, goal: goals.Goal, searchRadius: number, before: () => void = () => {}): Query {
    const steps = bot.pathfinder.getPathFromTo(rules, from, goal, { timeout: 60_000, tickTimeout: SLICE_MS, searchRadius, optimizePath: false, resetEntityIntersects: false });
    return (): Answer | "more" => {
      before();
      const step = steps.next();
      if (step.done) return "unsure";
      const status: string = step.value.result.status;
      return status === "success" ? "yes" : status === "noPath" ? "no" : status === "partial" ? "more" : "unsure";
    };
  }

  return {
    reach(id) {
      const threat = bot.entities[id];
      if (!threat) return null;
      const me = bot.entity.position;
      return search(walker, threat.position.clone(), new GoalNear(me.x, me.y, me.z, 1.5), REACH_DETOUR);
    },
    escape(id) {
      const threat = bot.entities[id];
      if (!threat) return null;
      const at = threat.position.clone();
      const me = bot.entity.position.clone();
      // Never closer to it than the bot already is, up to 3 blocks.
      const clear = { of: at, within: Math.min(ESCAPE.clearOf, me.distanceTo(at) - 0.5) };
      const far = (node: { x: number; y: number; z: number }) => Math.hypot(node.x + 0.5 - at.x, node.y - at.y, node.z + 0.5 - at.z);
      const goal = { heuristic: (node: Vec3) => Math.max(0, ESCAPE.distance - far(node)), isEnd: (node: Vec3) => far(node) >= ESCAPE.distance, hasChanged: () => false, isValid: () => true } as unknown as goals.Goal;
      return search(runner, me, goal, ESCAPE.detour, () => (keepClear = clear));
    },
  };
}
