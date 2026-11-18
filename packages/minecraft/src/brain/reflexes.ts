import type { ReflexRule } from "@familiar/region-reflex";
import type { MinecraftStateData } from "../encode/state-data.js";
import { DEFAULT_REFLEXES, protectiveReflexes, type ReflexSettings } from "./protective-reflexes.js";
import { defenceOf, defenceReflexes, onIt } from "./defence.js";
import { minecraftDataOf } from "./read-state.js";

// The player's wired-in reactions, in two classes.
// Hard reflexes save its life: always urgency 1, and nothing learned, felt or planned can stop them.
// Soft reflexes give a base urgency that the brainstem scales (alarm, bravery, the goal's
// hold-backs), capped below 1, so the rest of the brain can outvote them. The soft defence
// reflexes come from the defence circuit (defence.ts).
// Add one: write a rule here and add it to playerReflexes.

/** At or below this food level the bot eats if it can. */
export const STARVING_FOOD = 6;
/** At or below this much air (of 20), under water, the bot surfaces. */
export const LOW_AIR = 6;
/** At or below this health with a hostile this close, the bot breaks away whatever else it wanted. */
export const LAST_STAND = { health: 6, distance: 4 };
export { CONTACT_DISTANCE, FAR_DISTANCE } from "../defence/size-up.js";

/** A rule that reads the Minecraft state; silent before the first one arrives. */
function rule(name: string, kind: ReflexRule["kind"], check: (data: MinecraftStateData) => ReturnType<ReflexRule["check"]>): ReflexRule {
  return {
    name,
    kind,
    check(ws) {
      const data = minecraftDataOf(ws.state);
      return data ? check(data) : null;
    },
  };
}

// Hard reflexes. Their urgency is always 1, whatever is written here.

/** In lava, or burning: get out. */
export const inLavaOrFire = rule("in_lava_or_fire", "hard", ({ self }) =>
  self.inLava || self.onFire ? { action: { skill: "escape_hazard" }, urgency: 1, reason: self.inLava ? "in lava" : "on fire" } : null,
);

/** Under water and nearly out of breath: get to air. */
export const drowning = rule("drowning", "hard", ({ self }) =>
  self.inWater && self.air <= LOW_AIR ? { action: { skill: "surface" }, urgency: 1, reason: `air ${self.air}/20` } : null,
);

/**
 * Nearly dead with a hostile on top of it: break away. It goes by the game's own hostile flag,
 * whatever the bot has or has not learned. Cornered, there is nowhere to break away to: it
 * stays silent and the defence circuit fights instead.
 */
export const lastStand = rule("last_stand", "hard", (data) => {
  const mob = data.nearby.mobs.filter((m) => m.hostile && m.dist <= LAST_STAND.distance).sort((a, b) => a.dist - b.dist)[0];
  if (!mob || data.self.health > LAST_STAND.health || defenceOf(data).choice.cornered) return null;
  return { action: { skill: "flee", target: mob.id }, urgency: 1, reason: `health ${data.self.health}, ${mob.type} ${mob.dist} blocks away` };
});

// Soft reflexes. Defence (freeze, flee, fight, and resting after) is the defence circuit's: see defence.ts.

/**
 * Very hungry and carrying food: eat. With nothing else to hand it will eat food it knows to be
 * bad. It does not stop to eat with a hostile on top of it.
 */
export const eatWhenStarving = rule("eat_when_starving", "soft", (data) => {
  const { self } = data;
  if (self.food > STARVING_FOOD || (self.foodItems === 0 && self.badFoodItems === 0) || onIt(data)) return null;
  return { action: { skill: "eat" }, urgency: 0.9, reason: `food ${self.food}/20${self.foodItems === 0 ? ", with only bad food to eat" : ""}` };
});

/**
 * Every reflex for a bot with these settings, checked every tick: the hard ones (the three that
 * were always there, then withdrawal, buried and about-to-touch), then the soft ones (defence first).
 */
export function createPlayerReflexes(settings: ReflexSettings = DEFAULT_REFLEXES, righting = 1, defence: { recuperate: number } = { recuperate: 1 }): ReflexRule[] {
  const protective = protectiveReflexes(settings, righting);
  return [inLavaOrFire, drowning, lastStand, ...protective.hard, ...defenceReflexes(defence), ...protective.soft, eatWhenStarving];
}

/** Every player reflex with the default settings. */
export const playerReflexes: ReflexRule[] = createPlayerReflexes();
