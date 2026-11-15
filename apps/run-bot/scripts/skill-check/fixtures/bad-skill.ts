// A deliberate bad example for the doorway rule's test: a skill that moves the body directly
// instead of going through a primitive. Never imported by anything.
interface Body {
  dig(block: unknown): Promise<void>;
  setControlState(key: string, down: boolean): void;
}

export async function badSkill(bot: Body, block: unknown): Promise<void> {
  bot.setControlState("forward", true);
  await bot.dig(block);
}
