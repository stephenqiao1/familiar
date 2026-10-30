import { afterEach, describe, expect, it, vi } from "vitest";
import { sleepFor } from "./abort.js";

describe("sleepFor", () => {
  afterEach(() => vi.useRealTimers());

  it("resolves after the delay", async () => {
    vi.useFakeTimers();
    const done = vi.fn();
    void sleepFor(1000, new AbortController().signal).then(done);
    await vi.advanceTimersByTimeAsync(999);
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toHaveBeenCalled();
  });

  it("rejects with the abort reason", async () => {
    const controller = new AbortController();
    const sleeping = sleepFor(60_000, controller.signal);
    controller.abort(new Error("interrupted"));
    await expect(sleeping).rejects.toThrow("interrupted");
  });

  it("rejects at once if already aborted", async () => {
    await expect(sleepFor(10, AbortSignal.abort(new Error("stop")))).rejects.toThrow("stop");
  });
});
