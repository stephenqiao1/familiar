import type { ReflexRule } from "@familiar/region-reflex";
import type { MinecraftStateData } from "../encode/state-data.js";
import { DANGER_DISTANCE, minecraftDataOf } from "./read-state.js";

// The player's wired-in reactions, in two classes.
// Hard reflexes save its life: always urgency 1, and nothing learned, felt or planned can stop them.
// Soft reflexes give a base urgency that the brainstem scales (alarm, bravery, the goal's
// hold-backs), capped below 1, so the rest of the brain can outvote them.
// Add one: write a rule here and add it to playerReflexes.

/** Below this health the contact reflex flees instead of fighting. */
export const FIGHT_HEALTH = 10;
/** At or below this food level the bot eats if it can. */
export const STARVING_FOOD = 6;
/** At or below this much air (of 20), under water, the bot surfaces. */
export const LOW_AIR = 6;
/** At or below this health with a hostile this close, the bot breaks away whatever else it wanted. */
export const LAST_STAND = { health: 6, distance: 4 };
/** A hostile this close is on top of the bot. */
export const CONTACT_DISTANCE = 3;
/** A hostile is noticed (far zone) out to this distance. */
export const FAR_DISTANCE = 16;
/** Never fought by reflex: creepers explode, and the rest shoot from a distance. */
const NEVER_FIGHT = new Set(["creeper", "skeleton", "stray", "bogged", "pillager", "blaze", "ghast", "witch", "shulker", "breeze", "drowned", "guardian", "elder_guardian"]);

type Mob = MinecraftStateData["nearby"]["mobs"][number];

/** How close a threat is, which decides the defence: watch it, retreat, or fight or break away. */
export type Zone = "far" | "approaching" | "contact";

/**
 * A hostile mob's zone, or null if it is too far to matter. Far: 9 to 16 blocks, or closer but
 * unable to reach the bot. Approaching: 4 to 8 blocks. Contact: 3 blocks or less.
 */
export function zoneOf(mob: Mob): Zone | null {
  if (!mob.hostile || mob.dist > FAR_DISTANCE) return null;
  if (!mob.reachable || mob.dist > DANGER_DISTANCE) return "far";
  return mob.dist <= CONTACT_DISTANCE ? "contact" : "approaching";
}

/** The closest hostile mob in a zone, or null. */
export function closestIn(data: MinecraftStateData, zone: Zone): Mob | null {
  return data.nearby.mobs.filter((m) => zoneOf(m) === zone).sort((a, b) => a.dist - b.dist)[0] ?? null;
}

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

/** Nearly dead with a hostile on top of it: break away. */
export const lastStand = rule("last_stand", "hard", (data) => {
  const mob = data.nearby.mobs.filter((m) => m.hostile && m.dist <= LAST_STAND.distance).sort((a, b) => a.dist - b.dist)[0];
  if (!mob || data.self.health > LAST_STAND.health) return null;
  return { action: { skill: "flee", target: mob.id }, urgency: 1, reason: `health ${data.self.health}, ${mob.type} ${mob.dist} blocks away` };
});

// Soft reflexes: defence by distance. A far threat gets no reflex at all, only a look (orienting).

/** A hostile is closing in (4 to 8 blocks): retreat. */
export const threatApproaching = rule("threat_approaching", "soft", (data) => {
  const mob = closestIn(data, "approaching");
  if (!mob || closestIn(data, "contact")) return null;
  return { action: { skill: "flee", target: mob.id }, urgency: 0.7, reason: `${mob.type} approaching, ${mob.dist} blocks away` };
});

/** A hostile is on top of the bot (3 blocks or less): fight if armed and healthy, else break away. */
export const threatContact = rule("threat_contact", "soft", (data) => {
  const mob = closestIn(data, "contact");
  if (!mob) return null;
  const { health, bestWeapon } = data.self;
  const fight = health >= FIGHT_HEALTH && bestWeapon !== null && !NEVER_FIGHT.has(mob.type);
  const why = fight ? "" : NEVER_FIGHT.has(mob.type) ? ", not one to fight" : bestWeapon === null ? ", no weapon" : "";
  return { action: { skill: fight ? "attack" : "flee", target: mob.id }, urgency: 0.9, reason: `${mob.type} in contact, ${mob.dist} blocks away, health ${health}${why}` };
});

/** Very hungry and carrying food: eat. */
export const eatWhenStarving = rule("eat_when_starving", "soft", ({ self }) =>
  self.food > STARVING_FOOD || self.foodItems === 0 ? null : { action: { skill: "eat" }, urgency: 0.9, reason: `food ${self.food}/20` },
);

/** Every player reflex, checked every tick. */
export const playerReflexes: ReflexRule[] = [inLavaOrFire, drowning, lastStand, threatContact, threatApproaching, eatWhenStarving];

/** The soft reflexes that defend the bot (a death while one was overruled is logged). */
export const DEFENCE_REFLEXES = [threatApproaching.name, threatContact.name];
