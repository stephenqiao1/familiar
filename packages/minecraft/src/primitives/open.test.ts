import type { Bot } from "mineflayer";
import { describe, expect, it, vi } from "vitest";
import type { Block } from "../mc-types.js";
import { doOpen } from "./open.js";

const block = {} as Block;

describe("doOpen", () => {
  it("returns the container once it opens", async () => {
    const window = { id: 1 };
    const bot = { openContainer: async () => window } as unknown as Bot;
    expect(await doOpen(bot, block, new AbortController().signal)).toBe(window);
  });

  it("returns null at once when stopped while the container has not opened, and shuts it if it opens late", async () => {
    const window = { id: 1 };
    let openLate = (_: unknown) => {};
    const closeWindow = vi.fn();
    const bot = { openContainer: () => new Promise((resolve) => (openLate = resolve)), closeWindow } as unknown as Bot;
    const stop = new AbortController();
    const opening = doOpen(bot, block, stop.signal);
    stop.abort();
    expect(await opening).toBeNull();
    openLate(window);
    await Promise.resolve();
    await Promise.resolve();
    expect(closeWindow).toHaveBeenCalledWith(window);
  });

  it("does not raise when a stopped opening later times out", async () => {
    let fail = (_: Error) => {};
    const bot = { openContainer: () => new Promise((_, reject) => (fail = reject)) } as unknown as Bot;
    const stop = new AbortController();
    const opening = doOpen(bot, block, stop.signal);
    stop.abort();
    expect(await opening).toBeNull();
    fail(new Error("Event windowOpen did not fire within timeout of 20000ms"));
    await Promise.resolve();
  });
});
