// A deliberate bad example for the one-traveller rule's test: a skill that drives the pathfinder
// and holds a movement key itself instead of asking the locomotion controller. Never imported.
interface Body {
  pathfinder: { setGoal(goal: unknown): void };
}
declare const holdKey: (bot: Body, key: string, down: boolean) => void;

export function badTravel(bot: Body, goal: unknown): void {
  bot.pathfinder.setGoal(goal);
  holdKey(bot, "forward", true);
}
