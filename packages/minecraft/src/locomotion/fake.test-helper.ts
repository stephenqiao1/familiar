import { EventEmitter } from "node:events";
import type { Bot } from "mineflayer";
import type { goals } from "mineflayer-pathfinder";
import { Vec3 } from "vec3";
import { vi } from "vitest";
import { createLocomotion } from "./controller.js";
import type { RuleSets } from "./rules.js";

const TICK_MS = 50;
const SPEED = { walk: 4.3, sprint: 5.6 };
const NOT_SOLID = new Set(["air", "water", "lava"]);

/**
 * A bot with a stand-in pathfinder and a flat world, for testing the locomotion controller. Time
 * is faked: `run(ms)` advances it one game tick at a time, moving the bot as the real game
 * would. The stand-in pathfinder walks straight at its goal, pressing forward (and sprint, as
 * the real one does) each tick.
 */
export function fakeTraveller(options: { blocks?: Record<string, string>; food?: number } = {}) {
  const events = new EventEmitter();
  const keys = new Set<string>();
  const blocks = new Map(Object.entries(options.blocks ?? {}));
  const calls: string[] = [];
  const logged: string[] = [];
  const nameAt = (p: Vec3) => blocks.get(`${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`) ?? (Math.floor(p.y) <= 62 ? "stone" : "air");
  let goal: (goals.Goal & { x?: number; y?: number; z?: number; entity?: { position: Vec3 } }) | null = null;
  let dynamic = false;
  const world = { blocked: false, noPath: false, pathLength: null as number | null, failSetGoal: false };

  const state = {
    entity: { id: 1, position: new Vec3(0.5, 63, 0.5), yaw: 0, pitch: 0, height: 1.8, isValid: true, onGround: true, isCollidedHorizontally: false, isInWater: false },
    food: options.food ?? 20,
    targetDigBlock: null as unknown,
    entities: {} as Record<number, unknown>,
    registry: { blocksArray: [] },
    world: {},
    on: (name: string, fn: (...args: unknown[]) => void) => events.on(name, fn),
    off: (name: string, fn: (...args: unknown[]) => void) => events.off(name, fn),
    prependListener: (name: string, fn: (...args: unknown[]) => void) => events.prependListener(name, fn),
    blockAt: (p: Vec3) => ({ name: nameAt(p), position: p.floored(), boundingBox: NOT_SOLID.has(nameAt(p)) ? "empty" : "block", getProperties: () => ({}) }),
    findBlocks: () => [] as Vec3[],
    setControlState: (k: string, down: boolean) => void (down ? keys.add(k) : keys.delete(k)),
    getControlState: (k: string) => keys.has(k),
    clearControlStates: () => keys.clear(),
    stopDigging: () => calls.push("stopDigging"),
    async lookAt(point: Vec3) {
      const d = point.minus(state.entity.position.offset(0, state.entity.height, 0));
      state.entity.yaw = Math.atan2(-d.x, -d.z);
    },
    pathfinder: {
      thinkTimeout: 0,
      tickTimeout: 0,
      movements: null as unknown,
      setMovements(rules: { name: string }) {
        this.movements = rules;
        calls.push(`rules ${rules.name}`);
      },
      setGoal(next: typeof goal, isDynamic = false) {
        if (world.failSetGoal && next) throw new Error("pathfinder broke");
        goal = next;
        dynamic = isDynamic;
        calls.push(next ? "goal set" : "goal cleared");
        if (!next) return keys.clear(); // as the real one's full stop does
        const to = target();
        const path = world.noPath ? [] : Array.from({ length: world.pathLength ?? Math.ceil(to?.distanceTo(state.entity.position) ?? 0) }, () => ({}));
        queueMicrotask(() => events.emit("path_update", { status: world.noPath ? "noPath" : "success", path, time: 5 }));
      },
      isMoving: () => goal !== null && !goal.isEnd(state.entity.position.floored() as never),
      isMining: () => false,
      isBuilding: () => false,
    },
  };
  const target = () => (goal?.entity ? goal.entity.position : goal ? new Vec3(goal.x!, goal.y!, goal.z!) : null);

  // The stand-in pathfinder's tick: registered first, so the controller's tick runs after it.
  events.on("physicsTick", () => {
    if (!goal) return;
    goal.hasChanged(); // as the real one does each tick: a goal that follows something catches up with it
    if (goal.isEnd(state.entity.position.floored() as never)) {
      if (dynamic) return keys.delete("forward");
      goal = null;
      keys.clear();
      events.emit("goal_reached");
      return;
    }
    const d = target()!.minus(state.entity.position);
    state.entity.yaw = Math.atan2(-d.x, -d.z);
    keys.add("forward");
    keys.add("sprint");
  });

  /** One game tick: the tick listeners run, then the body moves by what keys are held. */
  function physics(): void {
    events.emit("physicsTick");
    state.entity.isInWater = nameAt(state.entity.position) === "water";
    if (world.blocked) return;
    const speed = ((keys.has("sprint") ? SPEED.sprint : SPEED.walk) * TICK_MS) / 1000;
    const ahead = new Vec3(-Math.sin(state.entity.yaw), 0, -Math.cos(state.entity.yaw));
    const left = new Vec3(ahead.z, 0, -ahead.x);
    const push = ahead.scaled(Number(keys.has("forward")) - Number(keys.has("back"))).plus(left.scaled(Number(keys.has("left")) - Number(keys.has("right"))));
    if (push.x || push.z) state.entity.position = state.entity.position.plus(push.scaled(speed / Math.hypot(push.x, push.z)));
  }

  const bot = state as unknown as Bot;
  const rules = { normal: { name: "normal" }, careful: { name: "careful" } } as unknown as RuleSets;
  let avoiding: (pos: { x: number; y: number; z: number }) => boolean = () => false;
  const locomotion = createLocomotion(bot, {
    log: (msg) => logged.push(msg),
    rules(avoid) {
      avoiding = avoid;
      return rules;
    },
  });
  return {
    bot,
    state,
    locomotion,
    world,
    calls,
    logged,
    keysDown: () => [...keys].sort(),
    /** Whether routes are being kept away from a spot. */
    avoided: (x: number, z: number, y = 63) => avoiding({ x, y, z }),
    /** Advances fake time, one game tick at a time. */
    async run(ms: number) {
      for (let t = 0; t < ms; t += TICK_MS) {
        physics();
        await vi.advanceTimersByTimeAsync(TICK_MS);
      }
    },
    emit: (name: string, ...args: unknown[]) => events.emit(name, ...args),
    at: (x: number, z: number, y = 63) => new Vec3(x + 0.5, y, z + 0.5),
    /** A fake entity standing at a block. */
    entity(id: number, x: number, z: number) {
      const e = { id, position: new Vec3(x + 0.5, 63, z + 0.5), isValid: true, height: 1.8 };
      state.entities[id] = e;
      return e as unknown as Bot["entity"];
    },
  };
}
