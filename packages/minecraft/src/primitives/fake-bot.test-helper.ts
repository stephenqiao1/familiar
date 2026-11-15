import { EventEmitter } from "node:events";
import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import type { MinecraftCtx } from "../skill-context.js";

/** A stack in the fake inventory. */
export interface FakeItem {
  name: string;
  type: number;
  count: number;
}

/** A fake world entity. */
export interface FakeEntity {
  id: number;
  name: string;
  type: string;
  position: Vec3;
  height: number;
  isValid: boolean;
}

export interface FakeOptions {
  /** "x,y,z" → block name. Anything else is stone at y <= 62 and air above. */
  blocks?: Record<string, string>;
  items?: FakeItem[];
  held?: string;
  entities?: FakeEntity[];
  /** How long a dig takes. Default: 40 ms. */
  digMs?: number;
  /** What a chest holds. */
  chest?: FakeItem[];
  /** Item name → what one craft makes from which ingredients. */
  recipes?: Record<string, { uses: Record<string, number>; makes: number; table?: boolean }>;
}

const EMPTY = new Set(["air", "cave_air", "water", "lava", "fire", "oak_door"]);
const TYPES = ["air", "dirt", "stone", "bread", "oak_log", "oak_planks", "stick", "wooden_pickaxe", "stone_sword", "bow", "chest", "crafting_table"];
export const item = (name: string, count = 1): FakeItem => ({ name, type: TYPES.indexOf(name), count });
export const entity = (id: number, name: string, x: number, z: number, type = "hostile"): FakeEntity => ({ id, name, type, position: new Vec3(x + 0.5, 63, z + 0.5), height: 1.8, isValid: true });

/**
 * A bot that records what was done to its body: keys held, items in use, digs, windows. It stands
 * at 0,63,0 facing north (-z) on stone. Only what the primitives touch is faked.
 */
export function fakeBot(options: FakeOptions = {}) {
  const events = new EventEmitter();
  const blocks = new Map(Object.entries(options.blocks ?? {}));
  const keys = new Set<string>();
  const log: string[] = [];
  let items = [...(options.items ?? [])];
  const chest = [...(options.chest ?? [])];
  const entities = Object.fromEntries((options.entities ?? []).map((e) => [e.id, e]));
  let dig: { reject(error: Error): void; timer: ReturnType<typeof setTimeout> } | null = null;
  const key = (p: Vec3) => `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`;
  const nameAt = (p: Vec3) => blocks.get(key(p)) ?? (Math.floor(p.y) <= 62 ? "stone" : "air");
  const blockAt = (p: Vec3) => ({ name: nameAt(p), position: p.floored(), boundingBox: EMPTY.has(nameAt(p)) ? "empty" : "block" });
  const add = (list: FakeItem[], name: string, count: number) => {
    const stack = list.find((i) => i.name === name);
    if (stack) stack.count += count;
    else list.push(item(name, count));
  };
  const take = (list: FakeItem[], type: number, count: number) => {
    const stack = list.find((i) => i.type === type);
    if (!stack || stack.count < count) throw new Error("not enough of that item");
    stack.count -= count;
    if (stack.count === 0) list.splice(list.indexOf(stack), 1);
    return stack.name;
  };

  let walking = false;
  const state = {
    entity: { id: 1, position: new Vec3(0.5, 63, 0.5), yaw: 0, pitch: 0, height: 1.8, isValid: true },
    health: 20,
    food: 20,
    heldItem: null as FakeItem | null,
    currentWindow: null as { id: number; type: string; items(): FakeItem[] } | null,
    targetDigBlock: null as unknown,
    using: false,
    entities,
    players: {},
    registry: {
      itemsByName: Object.fromEntries(TYPES.map((name, id) => [name, { id, name }])),
      blocksByName: Object.fromEntries(["dirt", "stone", "oak_log", "oak_planks", "chest", "crafting_table"].map((name) => [name, { name }])),
    },
    inventory: { items: () => items },
    pathfinder: { setGoal: (goal: unknown) => log.push(goal === null ? "path cleared" : "path set"), isMoving: () => walking, isMining: () => false, isBuilding: () => false },
    prependListener: (name: string, fn: (...args: unknown[]) => void) => events.prependListener(name, fn),
    on: (name: string, fn: (...args: unknown[]) => void) => events.on(name, fn),
    off: (name: string, fn: (...args: unknown[]) => void) => events.off(name, fn),
    blockAt,
    setControlState: (k: string, down: boolean) => (down ? keys.add(k) : keys.delete(k)),
    getControlState: (k: string) => keys.has(k),
    clearControlStates: () => keys.clear(),
    async look(yaw: number, pitch: number) {
      state.entity.yaw = yaw;
      state.entity.pitch = pitch;
    },
    async lookAt(point: Vec3) {
      const d = point.minus(state.entity.position.offset(0, state.entity.height, 0));
      state.entity.yaw = Math.atan2(-d.x, -d.z);
      state.entity.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    },
    activateItem: () => void (state.using = true),
    deactivateItem: () => void (state.using = false),
    async equip(stack: FakeItem) {
      state.heldItem = stack;
    },
    async toss(type: number, _meta: null, count: number) {
      const name = take(items, type, count);
      log.push(`tossed ${count} ${name}`);
      entities[900 + log.length] = { id: 900 + log.length, name: "item", type: "other", position: state.entity.position.offset(0, 0, -1), height: 0.25, isValid: true };
      if (!items.includes(state.heldItem!)) state.heldItem = null;
    },
    async tossStack(stack: FakeItem) {
      await state.toss(stack.type, null, stack.count);
    },
    attack(target: FakeEntity) {
      log.push(`attacked ${target.id}`);
      events.emit("entityHurt", target);
    },
    digTime: () => options.digMs ?? 40,
    canDigBlock: () => true,
    dig(block: { position: Vec3; name: string }) {
      state.targetDigBlock = block;
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          dig = null;
          state.targetDigBlock = null;
          blocks.set(key(block.position), "air");
          resolve();
        }, options.digMs ?? 40);
        dig = { reject, timer };
      });
    },
    stopDigging() {
      log.push("stopped digging");
      state.targetDigBlock = null;
      if (!dig) return;
      clearTimeout(dig.timer);
      dig.reject(new Error("Digging aborted"));
      dig = null;
    },
    async placeBlock(against: { position: Vec3 }, face: Vec3) {
      const name = take(items, state.heldItem!.type, 1);
      blocks.set(key(against.position.plus(face)), name);
      if (!items.includes(state.heldItem!)) state.heldItem = null;
    },
    async activateBlock(block: { position: Vec3; name: string }) {
      log.push(`used on ${block.name}`);
      if (block.name === "crafting_table") state.currentWindow = { id: 7, type: "crafting", items: () => items };
    },
    async activateEntity(target: FakeEntity) {
      log.push(`used on entity ${target.id}`);
    },
    isABed: (block: { name: string }) => block.name.endsWith("_bed"),
    async sleep() {
      log.push("got into bed");
    },
    async wake() {
      log.push("got out of bed");
    },
    async openContainer() {
      const window = {
        id: 3,
        type: "chest",
        items: () => items,
        containerItems: () => chest,
        async deposit(type: number, _meta: null, count: number) {
          add(chest, take(items, type, count), count);
        },
        async withdraw(type: number, _meta: null, count: number) {
          add(items, take(chest, type, count), count);
        },
      };
      state.currentWindow = window as typeof state.currentWindow;
      return window;
    },
    async closeWindow() {
      log.push("closed window");
      state.currentWindow = null;
    },
    recipesFor(id: number, _meta: null, _min: number, table: unknown) {
      const recipe = options.recipes?.[TYPES[id]!];
      if (!recipe || (recipe.table && !table)) return [];
      const enough = Object.entries(recipe.uses).every(([name, n]) => (items.find((i) => i.name === name)?.count ?? 0) >= n);
      return enough ? [{ result: TYPES[id]!, requiresTable: recipe.table ?? false, ...recipe }] : [];
    },
    async craft(recipe: { result: string; uses: Record<string, number>; makes: number }) {
      for (const [name, n] of Object.entries(recipe.uses)) take(items, TYPES.indexOf(name), n);
      add(items, recipe.result, recipe.makes);
    },
    nearestEntity: (match: (e: FakeEntity) => boolean) => Object.values(entities).find(match) ?? null,
    entityAtCursor: () => null as FakeEntity | null,
    blockAtCursor: () => null as ReturnType<typeof blockAt> | null,
    findBlocks: ({ matching }: { matching(b: { name: string }): boolean }) =>
      [...blocks].filter(([, name]) => matching({ name })).map(([k]) => new Vec3(...(k.split(",").map(Number) as [number, number, number]))),
  };
  if (options.held) state.heldItem = items.find((i) => i.name === options.held) ?? null;

  const bot = state as unknown as Bot;
  const ctx: MinecraftCtx = { bot, base: { chest: new Vec3(0, 63, 0), bed: new Vec3(0, 63, 1) }, wants: () => [], chests: {} as MinecraftCtx["chests"], log: () => {} };
  return {
    bot,
    ctx,
    state,
    log,
    /** The movement keys held down right now. */
    keysDown: () => [...keys].sort(),
    carried: () => Object.fromEntries(items.map((i) => [i.name, i.count])),
    stored: () => Object.fromEntries(chest.map((i) => [i.name, i.count])),
    blockName: (x: number, y: number, z: number) => nameAt(new Vec3(x, y, z)),
    /** What the bot is looking at, for the "ahead" target. */
    lookingAt(thing: { block?: [number, number, number]; entity?: FakeEntity }) {
      state.blockAtCursor = () => (thing.block ? blockAt(new Vec3(...thing.block)) : null);
      state.entityAtCursor = () => thing.entity ?? null;
    },
    setItems: (next: FakeItem[]) => void (items = next),
    /** Pretends the pathfinder is (or is not) walking the bot. */
    setWalking: (on: boolean) => void (walking = on),
    emit: (name: string, ...args: unknown[]) => events.emit(name, ...args),
  };
}
