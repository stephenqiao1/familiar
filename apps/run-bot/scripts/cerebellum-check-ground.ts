// The ground the cerebellum's live scenes are played on, and the moves they are made of.
import { rcon, sleep } from "./primitive-check/world.ts";
import { BOT } from "./live.ts";

export const Y = 151;
export const LANE = { from: 46, to: 70, z: 40 };
/** Covers the walking ground with one kind of block (or a shallow pool). */
export function ground(block: string): void {
  // A pool is two deep, so the bot swims; anything else is one layer over stone.
  rcon(`fill ${LANE.from - 2} ${Y - 2} 37 ${LANE.to + 2} ${Y - 2} 43 ${block === "water" ? "water" : "stone"}`);
  rcon(`fill ${LANE.from - 2} ${Y - 1} 37 ${LANE.to + 2} ${Y - 1} 43 ${block}`);
}
export type Say = { say(command: string): void };
export const put = (x: number, yaw = -90, pitch = 0) => rcon(`tp ${BOT} ${x + 0.5} ${Y} ${LANE.z + 0.5} ${yaw} ${pitch}`);

/** Walks the lane there and back `laps` times, allowing `seconds` for each crossing. */
export async function laps(bot: Say, laps: number, seconds: number): Promise<void> {
  for (let i = 0; i < laps; i++) {
    bot.say(`do go_to pos:${i % 2 ? LANE.from : LANE.to},${Y},${LANE.z}`);
    await sleep(seconds * 1000);
  }
}

/** Breaks the same kind of block `times` times with whatever is in hand, allowing `seconds` each. */
export async function digs(bot: Say, block: string, times: number, seconds: number): Promise<void> {
  for (let i = 0; i < times; i++) {
    rcon(`setblock 61 ${Y} ${LANE.z} ${block}`);
    await sleep(400);
    bot.say(`do break_block pos:61,${Y},${LANE.z}`);
    await sleep(seconds * 1000);
  }
  rcon(`setblock 61 ${Y} ${LANE.z} air`);
}

export async function repeat(bot: Say, command: string, times: number, seconds: number, before?: () => void): Promise<void> {
  for (let i = 0; i < times; i++) {
    before?.();
    bot.say(command);
    await sleep(seconds * 1000);
  }
}

