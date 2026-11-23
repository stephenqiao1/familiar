import type { BodyClock, NeedReading, State, Workspace } from "@familiar/contracts";
import { COLD_SIGNAL, RESERVE_SIGNAL, SICK_SIGNAL, TIRED_SIGNAL } from "@familiar/region-brainstem";
import { readNeeds, type Adjustment, type DayTime, type DriveSettings, type Need, type NeedContext } from "@familiar/region-hypothalamus";
import type { MinecraftStateData } from "../encode/state-data.js";
import { minecraftDataOf, nearestThreat } from "./read-state.js";

// The player's needs: each a level (0 = met, 1 = desperate) read from the state. The hypothalamus
// reads them once a tick and shares the reading; dopamine pays the signed change in each (a need
// that falls pays, one that rises costs the same), learns what relieves it and wants that as
// much as the need presses; patience, alarm and search follow them too. Every number here is a
// first guess to tune in play.
// Add a need: write its level here with `need(...)` and add it to playerNeeds. How much each
// class of need weighs is in the bot's settings (the "drives" block of bots.json).

const MAX_FOOD = 20;
const MAX_HEALTH = 20;
const MAX_LIGHT = 15;
/** Enough food items carried, to begin with; fewer counts as short. */
const FOOD_STOCK_TARGET = 8;
/** Enough torches carried, to begin with; fewer counts as short. */
const TORCH_TARGET = 16;
const TOOL_KINDS = ["sword", "pickaxe", "axe", "shovel"];
/**
 * What is known to be on its way. With the hidden reserve under `reserveBelow` of full the food
 * bar is about to start falling: that counts as hunger heading for at least `hungry`.
 */
const COMING = { reserveBelow: 0.05, hungry: 0.5 };
/** The night sky gives this much less light than the day's (as the state's light level counts it). */
const NIGHT_SKY_DIMMING = 11;

/**
 * A need read from a Minecraft state: `level` says how pressing it is (0 to 1), or null where it
 * does not apply; `say` names a change in it for the log. `rank` says how vital it is next to
 * the others: a higher one silences the lower. `weighs` says which of the settings' weights it
 * takes (how much it darkens the outlook when unmet, see outlookFrom).
 */
function need(name: string, kind: string, level: (d: MinecraftStateData, context: NeedContext) => number | null, say: (a: MinecraftStateData, b: MinecraftStateData) => string, more: Partial<Pick<Need, "rank" | "weighs" | "target" | "by" | "spare" | "serves">> & { coming?: (d: MinecraftStateData, context: NeedContext) => number | null } = {}): Need {
  return {
    name,
    kind,
    ...more,
    level(state, context) {
      const data = minecraftDataOf(state);
      return data && level(data, context);
    },
    coming(state, context) {
      const data = minecraftDataOf(state);
      return data && (more.coming?.(data, context) ?? null);
    },
    say(before, after) {
      const [a, b] = [minecraftDataOf(before), minecraftDataOf(after)];
      return a && b ? say(a, b) : name;
    },
  };
}

// Hunger

export const foodBar = need(
  "food_bar",
  "hunger",
  (d) => 1 - d.self.food / MAX_FOOD,
  (a, b) => `food ${a.self.food} → ${b.self.food}`,
  // The food bar only falls once the body's hidden reserve is gone: with it nearly gone, hunger is on its way.
  { coming: (d, { signal }) => ((signal(RESERVE_SIGNAL) ?? 1) < COMING.reserveBelow ? Math.max(COMING.hungry, 1 - d.self.food / MAX_FOOD) : null) },
);

// Safety

export const health = need(
  "health",
  "safety",
  (d) => 1 - d.self.health / MAX_HEALTH,
  (a, b) => `health ${a.self.health} → ${b.self.health}`,
);

/**
 * How close the nearest mob that could harm the bot is: 0 with none in range, 1 on top of the bot.
 * The range is wider for one that has noticed the bot (see nearestThreat).
 * It ranks above every other need: with a threat close, nothing else is worth setting off for.
 */
export const danger = need(
  "danger",
  "safety",
  (d) => {
    const threat = nearestThreat(d);
    return threat ? Math.max(0, 1 - threat.dist / threat.within) : 0;
  },
  (a, b) => {
    const [was, now] = [nearestThreat(a), nearestThreat(b)];
    if (!now) return `${was?.type ?? "threat"} gone`;
    return was ? `${now.type} at ${was.dist} → ${now.dist} blocks` : `${now.type} at ${now.dist} blocks`;
  },
  { rank: 1, weighs: "danger" },
);

/**
 * At night, how dark it is where the bot stands (the nearest thing to shelter the state shows).
 * By day it does not apply. With a body clock it comes on over dusk, heading for how dark this
 * spot will be with the sun gone (by its lamps, or the dimmed night sky), so night does not
 * arrive at a stroke (and its rise is something to look ahead from).
 */
export const nightLight = need(
  "night_light",
  "safety",
  (d, { clock }) => {
    if (d.time.isNight) return 1 - d.time.lightLevel / MAX_LIGHT;
    if (!clock || clock.dusk <= 0) return null;
    const afterSunset = Math.max(d.time.blockLight ?? 0, d.self.skyLight - NIGHT_SKY_DIMMING, 0);
    return clock.dusk * (1 - afterSunset / MAX_LIGHT);
  },
  (a, b) => `light ${a.time.lightLevel} → ${b.time.lightLevel}`,
);

// Having enough

/** Being provided for: lacking it does not make the next minutes bad, so it darkens the outlook only a little, waits under stress, and is a thing of the day. */
const PROVISION = { weighs: "provision", spare: true, by: "day" } as const;

/** How many kinds of tool (sword, pickaxe, axe, shovel) the bot has none of. */
export const tools = need(
  "tools",
  "having_enough",
  (d) => TOOL_KINDS.filter((kind) => toolCount(d, kind) === 0).length / TOOL_KINDS.length,
  (a, b) => {
    const [had, has] = [TOOL_KINDS.filter((kind) => toolCount(a, kind) > 0), TOOL_KINDS.filter((kind) => toolCount(b, kind) > 0)];
    const gained = has.filter((kind) => !had.includes(kind));
    const lost = had.filter((kind) => !has.includes(kind));
    return [gained.length ? `now has a ${gained.join(", ")}` : "", lost.length ? `no ${lost.join(", ")} any more` : ""].filter(Boolean).join("; ");
  },
  PROVISION,
);

export const foodStock = need(
  "food_stock",
  "having_enough",
  (d, { target }) => shortOf(d.self.foodItems, target),
  (a, b) => `food items ${a.self.foodItems} → ${b.self.foodItems}`,
  { ...PROVISION, target: FOOD_STOCK_TARGET, serves: "food_bar" },
);

export const torches = need(
  "torches",
  "having_enough",
  (d, { target }) => shortOf(d.self.inventory.torch ?? 0, target),
  (a, b) => `torches ${a.self.inventory.torch ?? 0} → ${b.self.inventory.torch ?? 0}`,
  { ...PROVISION, target: TORCH_TARGET, serves: "night_light" },
);

function toolCount(d: MinecraftStateData, kind: string): number {
  return Object.entries(d.self.inventory).reduce((sum, [name, n]) => (name.endsWith(`_${kind}`) ? sum + n : sum), 0);
}

/** How short of `target` a count is: 0 = enough, 1 = none. */
function shortOf(count: number, target: number): number {
  return 1 - Math.min(count, target) / target;
}

/** Every need the player is born with, in the order they are read. */
export const playerNeeds: Need[] = [foodBar, health, danger, nightLight, tools, foodStock, torches];

/** A body reading moves in steps this big, so a slow climb is a few small changes, not one every tick. */
const BODY_STEP = 0.05;

// The body's own readings as needs. The medulla measures them and shares each as a signal; with
// the medulla left out there is nothing to read, and the need is not there.

/** A need read straight from one of the medulla's signals, scaled by how far the bot's settings count it. */
function fromBody(name: string, kind: string, signal: string, strength: number, more: Partial<Pick<Need, "by">> = {}): Need {
  return {
    name,
    kind,
    ...more,
    level(_state, context) {
      const reading = context.signal(signal);
      return reading === undefined ? null : Math.round((strength * reading) / BODY_STEP) * BODY_STEP;
    },
  };
}

/** Warmth (from `cold`), rest (from `tired`, a need of the night) and illness (from `sick`). `strength` 0: none of them. */
export function bodyNeeds(strength: number): Need[] {
  return strength > 0 ? [fromBody("warmth", "warmth", COLD_SIGNAL, strength), fromBody("rest", "rest", TIRED_SIGNAL, strength, { by: "night" }), fromBody("illness", "illness", SICK_SIGNAL, strength)] : [];
}

/**
 * What moves a target with the moment: `times` the base while `when` holds.
 * Add a row to make enough depend on something else.
 */
const ADJUST = { hurtBelow: 10, hurt: 1.5, deepBelowY: 50, deep: 1.5, night: 1.5 };
/** How far night has come: 0 by day, rising over dusk, 1 by night. */
const nightness = (clock: BodyClock | null) => (clock ? (clock.night ? 1 : clock.dusk) : 0);
const when = (holds: boolean | undefined, times: number) => (holds ? times : 1);
export const TARGET_ADJUSTMENTS: Adjustment<State, BodyClock>[] = [
  { need: "food_stock", why: "hurt: healing uses food up", times: (state) => when((minecraftDataOf(state)?.self.health ?? MAX_HEALTH) < ADJUST.hurtBelow, ADJUST.hurt) },
  { need: "food_stock", why: "night is coming: no foraging in the dark", times: (_state, clock) => 1 + (ADJUST.night - 1) * nightness(clock) },
  { need: "torches", why: "night is coming", times: (_state, clock) => 1 + (ADJUST.night - 1) * nightness(clock) },
  { need: "torches", why: "underground: there is no daylight to come", times: (state) => when((minecraftDataOf(state)?.self.position.y ?? ADJUST.deepBelowY) < ADJUST.deepBelowY, ADJUST.deep) },
];

/** The game's day: 24 000 ticks in 20 minutes; the sun is up from tick 23 000 round to 13 000. */
const DAY = { ticks: 24_000, sunrise: 23_000, sunset: 13_000, seconds: 1200 };

/** Where in the day it is, counted from sunrise, or null for a state made without a clock. */
export function playerDayTime(state: State): DayTime | null {
  const tick = minecraftDataOf(state)?.time.dayTick;
  if (tick === undefined) return null;
  const sinceSunrise = (ticks: number) => ((ticks - DAY.sunrise + DAY.ticks) % DAY.ticks) / DAY.ticks;
  return { phase: sinceSunrise(tick), nightFrom: sinceSunrise(DAY.sunset), daySeconds: DAY.seconds };
}

/** The bot's deaths: a number that changes when its body is a new one. */
export const livesOf = (state: State) => minecraftDataOf(state)?.self.deaths ?? null;

/**
 * The needs right now: the hypothalamus's reading, or with it left out the plain reading worked
 * out from the state (the seven needs the bot is born with, at their base targets).
 */
export function needsNow(ws: Pick<Workspace, "needs" | "state">, settings?: Pick<DriveSettings, "weights" | "weight">): NeedReading[] {
  return ws.needs?.readings ?? readNeeds(playerNeeds, ws.state, settings ? { settings } : {});
}

/** What a change in one need is called in the log, e.g. "food 5 → 10". */
export function sayNeed(name: string, before: State, after: State): string {
  return playerNeeds.find((n) => n.name === name)?.say?.(before, after) ?? name.replace(/_/g, " ");
}
