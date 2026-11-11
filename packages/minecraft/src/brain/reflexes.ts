import type { ReflexRule } from "@familiar/region-reflex";
import { minecraftData } from "./read-state.js";

// The Miner's hard-wired reactions. Add a reflex: write a rule here and add it to minerReflexes.

/** A hostile mob this close triggers fight-or-flight. */
export const DANGER_DISTANCE = 8;
/** Below this health the reflex flees instead of fighting. */
export const FIGHT_HEALTH = 10;
/** At or below this food level the bot eats if it can. */
export const STARVING_FOOD = 6;

/** Hostile mob close by: fight if healthy and armed, else run. */
export const fightOrFlight: ReflexRule = {
  name: "fight_or_flight",
  check(ws) {
    const data = minecraftData(ws);
    const mob = data?.nearby.mobs.filter((m) => m.hostile && m.dist <= DANGER_DISTANCE).sort((a, b) => a.dist - b.dist)[0];
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
    const data = minecraftData(ws);
    if (!data || data.self.food > STARVING_FOOD || data.self.foodItems === 0) return null;
    return { action: { skill: "eat" }, urgency: 0.9, reason: `food ${data.self.food}/20` };
  },
};

/** Every Miner reflex, checked every tick. */
export const minerReflexes: ReflexRule[] = [fightOrFlight, eatWhenStarving];
