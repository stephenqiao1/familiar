import type { ReflexRule } from "@familiar/region-reflex";
import { minecraftDataOf, nearestThreat } from "./read-state.js";

// The player's hard-wired reactions. Add a reflex: write a rule here and add it to playerReflexes.

/** Below this health the reflex flees instead of fighting. */
export const FIGHT_HEALTH = 10;
/** At or below this food level the bot eats if it can. */
export const STARVING_FOOD = 6;

/** Hostile mob close by: fight if healthy and armed, else run. */
export const fightOrFlight: ReflexRule = {
  name: "fight_or_flight",
  check(ws) {
    const data = minecraftDataOf(ws.state);
    const mob = data && nearestThreat(data);
    if (!data || !mob) return null;
    const fight = data.self.health >= FIGHT_HEALTH && data.self.bestWeapon !== null;
    return {
      action: { skill: fight ? "attack" : "flee", target: mob.id },
      urgency: 1,
      reason: `${mob.type} ${mob.dist} blocks away, health ${data.self.health}${fight ? "" : data.self.bestWeapon ? "" : ", no weapon"}`,
    };
  },
};

/** Very hungry and carrying food: eat. */
export const eatWhenStarving: ReflexRule = {
  name: "eat_when_starving",
  check(ws) {
    const data = minecraftDataOf(ws.state);
    if (!data || data.self.food > STARVING_FOOD || data.self.foodItems === 0) return null;
    return { action: { skill: "eat" }, urgency: 0.9, reason: `food ${data.self.food}/20` };
  },
};

/** Every player reflex, checked every tick. */
export const playerReflexes: ReflexRule[] = [fightOrFlight, eatWhenStarving];
