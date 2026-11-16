// Small helpers the demos share for building on the sky plaza and measuring what happens there.
import { buildPlaza, rcon, reset, sleep } from "../primitive-check/world.ts";

/** A clean, empty plaza. */
export async function freshPlaza(): Promise<void> {
  buildPlaza();
  await reset();
}

/** Runs server commands, then gives the world a moment to settle. */
export async function build(commands: string[]): Promise<void> {
  for (const command of commands) rcon(command);
  await sleep(800);
}

/** Calls `sample` ten times a second until the returned function is called. */
export function every100ms(sample: () => void): () => void {
  const timer = setInterval(sample, 100);
  return () => clearInterval(timer);
}

export const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
export const share = (hits: number, of: number) => `${of ? Math.round((100 * hits) / of) : 0}%`;
export { rcon, sleep };
