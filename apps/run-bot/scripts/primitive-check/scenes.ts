// One scene per primitive: set up the world, run it once to completion and once interrupted,
// and check what it reported against what the observer and the server saw.
import type { Changes } from "@familiar/contracts";
import { blockData, BOT, carried, FRONT, HOME, playerNumber, rcon, sleep, type Observer } from "./world.ts";

export interface Scene {
  primitive: string;
  target?: string;
  /** Items to give the bot (each "name count"). */
  give?: string[];
  /** Primitives to run first, as [name, target]. */
  first?: [string, string?][];
  /** Extra world setup, after the reset. */
  setup?: () => void | Promise<void>;
  /** Notes what the observer sees before the run, for comparing after. */
  before?: (seen: Observer) => unknown;
  /** Whether the reported changes match what the observer and the server saw. Returns [ok, detail]. */
  check(changes: Changes, seen: Observer, before: unknown): [boolean, string];
  /** When to interrupt the second run, in ms after it starts. Default: at once. */
  interruptAfterMs?: number;
  /** A different world for the interrupted run (e.g. a block too hard to finish). */
  interruptSetup?: () => void | Promise<void>;
  /** Extra check after the interrupted run. */
  interruptCheck?(changes: Changes, seen: Observer): [boolean, string];
}

const near = (value: unknown, lo: number, hi: number) => typeof value === "number" && value >= lo && value <= hi;
const count = (value: unknown, name: string) => (value as Record<string, number> | undefined)?.[name] ?? 0;
const ZOMBIE = `summon zombie 60.5 151 38.5 {IsBaby:0b,NoAI:1b,PersistenceRequired:1b,equipment:{head:{id:"minecraft:leather_helmet",count:1}}}`;
const hungry = async () => {
  rcon(`effect give ${BOT} hunger 4 255 true`);
  await sleep(4500);
  rcon(`effect clear ${BOT}`);
};

export const scenes: Scene[] = [
  {
    primitive: "turn",
    target: "dir:left",
    before: (seen) => seen.yaw(),
    check: (c, seen, before) => {
      const sawTurn = Math.abs(seen.yaw() - (before as number)) > 0.5;
      return [near(c.turned, 40, 50) && sawTurn, `reported ${c.turned}°, observer saw a turn: ${sawTurn}`];
    },
  },
  {
    primitive: "look_at",
    target: "pos:64,152,40",
    before: (seen) => seen.yaw(),
    check: (c, seen, before) => {
      const sawTurn = Math.abs(seen.yaw() - (before as number)) > 0.5;
      return [near(c.turned, 60, 120) && sawTurn, `reported ${c.turned}°, observer saw a turn: ${sawTurn}`];
    },
  },
  {
    primitive: "step",
    target: "dir:forward",
    before: (seen) => seen.position(),
    check: (c, seen, before) => {
      const saw = seen.position()?.distanceTo(before as NonNullable<ReturnType<Observer["position"]>>) ?? 0;
      return [near(c.moved, 0.8, 1.6) && near(saw, 0.8, 1.6), `reported ${c.moved} blocks, observer saw ${saw.toFixed(1)}`];
    },
    interruptAfterMs: 120,
  },
  {
    primitive: "step_toward",
    target: "pos:60,151,36",
    before: (seen) => seen.position(),
    check: (c, seen, before) => {
      const saw = seen.position()?.distanceTo(before as NonNullable<ReturnType<Observer["position"]>>) ?? 0;
      return [near(c.moved, 1.5, 4) && near(saw, 1.5, 4), `reported ${c.moved} blocks, observer saw ${saw.toFixed(1)}`];
    },
    interruptAfterMs: 250,
  },
  { primitive: "jump", check: (c) => [c.asExpected === true, "jumped"], interruptAfterMs: 80 },
  { primitive: "sneak", check: (c) => [c.sneaking === true, `sneaking ${c.sneaking}`] },
  { primitive: "brace", target: "pos:64,152,40", check: (c) => [near(c.turned, 60, 120), `faced the point (${c.turned}°)`], interruptAfterMs: 80 },
  {
    primitive: "break_block",
    target: "dir:forward",
    setup: () => void rcon(`setblock ${FRONT} dirt`),
    check: (c, seen) => {
      const gone = seen.block(FRONT).name === "air";
      const dropReported = c.drops === 1 || count(c.gained, "dirt") === 1;
      return [c.targetBlock === "air" && gone && dropReported, `reported ${c.targetBlockWas}→${c.targetBlock}, observer sees ${seen.block(FRONT).name}, drop reported: ${dropReported}`];
    },
    interruptSetup: () => void rcon(`setblock ${FRONT} obsidian`),
    interruptAfterMs: 1000,
    interruptCheck: (c, seen) => [near(c.progress, 0.001, 0.5) && c.asExpected === false && seen.block(FRONT).name === "obsidian", `progress ${c.progress}, block still ${seen.block(FRONT).name}`],
  },
  {
    primitive: "place_block",
    target: "dir:forward",
    give: ["dirt 2"],
    first: [["equip", "item:dirt"]],
    check: (c, seen) => {
      const there = seen.block(FRONT).name;
      return [c.targetBlock === "dirt" && count(c.lost, "dirt") === 1 && there === "dirt", `reported ${c.targetBlockWas}→${c.targetBlock}, observer sees ${there}`];
    },
  },
  {
    primitive: "pick_up",
    setup: async () => {
      rcon(`summon item 60.5 151 38.5 {Item:{id:"minecraft:stick",count:1},PickupDelay:0}`);
      await sleep(600);
    },
    check: (c) => [count(c.gained, "stick") === 1 && carried("stick") === 1, `reported gained stick×${count(c.gained, "stick")}, server says the bot carries ${carried("stick")}`],
    interruptAfterMs: 60,
  },
  {
    primitive: "drop_item",
    give: ["bread 3"],
    first: [["equip", "item:bread"]],
    before: (seen) => seen.drops(),
    check: (c, seen, before) => {
      const onGround = seen.drops() - (before as number);
      return [count(c.lost, "bread") === 1 && onGround === 1 && carried("bread") === 2, `reported lost bread×${count(c.lost, "bread")}, observer sees ${onGround} new item on the ground`];
    },
  },
  {
    primitive: "equip",
    target: "item:stone_sword",
    give: ["bread 1", "stone_sword 1"],
    first: [["equip", "item:bread"]],
    check: (c) => {
      const selected = rcon(`data get entity ${BOT} SelectedItem.id`);
      return [c.held === "stone_sword" && selected.includes("stone_sword"), `reported held ${c.held}, server says ${selected.split(": ").at(-1)}`];
    },
  },
  {
    primitive: "use_item",
    give: ["bread 2"],
    first: [["equip", "item:bread"]],
    setup: hungry,
    before: () => playerNumber("foodLevel"),
    check: (c, _seen, before) => {
      const food = playerNumber("foodLevel");
      return [near(c.food, 1, 20) && food > (before as number) && count(c.lost, "bread") === 1, `reported food +${c.food}, server says ${before} → ${food}`];
    },
    interruptSetup: hungry,
    interruptAfterMs: 500,
    interruptCheck: () => [carried("bread") === 2, `bread not eaten (${carried("bread")} left)`],
  },
  {
    primitive: "use_on",
    target: "dir:forward",
    setup: () => {
      rcon(`setblock ${FRONT} oak_door[half=lower,facing=south]`);
      rcon(`setblock 60 152 39 oak_door[half=upper,facing=south]`);
    },
    check: (c, seen) => {
      const open = seen.block(FRONT).properties.open;
      return [c.asExpected === true && open === true, `observer sees the door open: ${open}`];
    },
  },
  {
    primitive: "open",
    target: "dir:forward",
    setup: () => void rcon(`setblock ${FRONT} chest`),
    check: (c) => [c.opened === "minecraft:generic_9x3" || typeof c.opened === "string", `reported opened ${c.opened}`],
  },
  {
    primitive: "move_item",
    target: "held",
    give: ["bread 3"],
    first: [["equip", "item:bread"], ["open", "dir:forward"]],
    setup: () => void rcon(`setblock ${FRONT} chest`),
    check: (c) => {
      const inChest = blockData(FRONT, "Items");
      return [count(c.lost, "bread") === 3 && inChest.includes("bread") && carried("bread") === 0, `reported lost bread×${count(c.lost, "bread")}, server says the chest holds bread: ${inChest.includes("bread")}`];
    },
  },
  {
    primitive: "close",
    first: [["open", "dir:forward"]],
    setup: () => void rcon(`setblock ${FRONT} chest`),
    check: (c) => [typeof c.closed === "string", `reported closed ${c.closed}`],
  },
  {
    primitive: "craft",
    target: "item:oak_planks",
    give: ["oak_log 1"],
    check: (c) => [count(c.gained, "oak_planks") === 4 && carried("oak_planks") === 4, `no table: reported gained oak_planks×${count(c.gained, "oak_planks")}, server says ${carried("oak_planks")}`],
  },
  {
    primitive: "craft",
    target: "item:wooden_pickaxe",
    give: ["oak_planks 3", "stick 2"],
    setup: () => void rcon(`setblock 61 151 40 crafting_table`),
    check: (c) => [count(c.gained, "wooden_pickaxe") === 1 && carried("wooden_pickaxe") === 1, `with a table: reported gained wooden_pickaxe×${count(c.gained, "wooden_pickaxe")}, server says ${carried("wooden_pickaxe")}`],
  },
  {
    primitive: "hit",
    setup: async () => {
      rcon(ZOMBIE);
      await sleep(800);
    },
    before: (seen) => seen.hurts("zombie"),
    check: (c, seen, before) => {
      const sawHurt = seen.hurts("zombie") > (before as number);
      return [c.targetHurt === true && sawHurt, `reported target hurt: ${c.targetHurt}, observer saw the zombie hurt: ${sawHurt}`];
    },
  },
];

/** Where the bot stands at the start of every scene. */
export const START = HOME;
