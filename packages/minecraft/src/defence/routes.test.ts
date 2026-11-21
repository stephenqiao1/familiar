import { describe, expect, it } from "vitest";
import { ASK_EVERY_MS, createRouteChecks, MAX_SLICES, SETTLE_MS, SLICES_PER_TICK, type Answer, type RouteQueries } from "./routes.js";

/** Queries that answer after `slices` calls, and count how often each was started and worked on. */
function fake(answers: { reach?: Answer; escape?: Answer } = {}, slices = 1) {
  const started: string[] = [];
  let worked = 0;
  const make = (kind: "reach" | "escape") => (id: number) => {
    started.push(`${kind}:${id}`);
    let left = slices;
    return () => {
      worked++;
      return --left > 0 ? ("more" as const) : (answers[kind] ?? "yes");
    };
  };
  const queries: RouteQueries = { reach: make("reach"), escape: make("escape") };
  return { queries, started, worked: () => worked };
}

describe("createRouteChecks", () => {
  it("has no answer until asked, then keeps it", () => {
    const { queries } = fake({ reach: "no", escape: "yes" });
    const checks = createRouteChecks(queries);
    expect(checks.canReach(7)).toBeNull();
    checks.work([7], 0, false);
    checks.work([7], 100, false);
    expect(checks.canReach(7)).toBe(false);
    expect(checks.escapable(7)).toBe(true);
  });
  it("is settling from the first question until its answer, a give-up, or the wait runs out", () => {
    const slow = createRouteChecks(fake({ reach: "no" }, 3).queries);
    expect(slow.settling(7, 0)).toBe(false); // never asked about
    slow.work([7], 0, false);
    expect(slow.settling(7, 0)).toBe(true);
    for (let t = 100; t <= 600; t += 100) slow.work([7], t, false);
    expect(slow.canReach(7)).toBe(false);
    expect(slow.settling(7, 600)).toBe(false);
    // Given up as unsure: the guess is all there will be.
    const unsure = createRouteChecks(fake({ reach: "unsure" }).queries);
    unsure.work([7], 0, false);
    expect(unsure.settling(7, 0)).toBe(false);
    // Never answering: waited for only so long.
    const stuck = createRouteChecks(fake({}, 1000).queries);
    stuck.work([7], 0, false);
    expect(stuck.settling(7, SETTLE_MS)).toBe(true);
    expect(stuck.settling(7, SETTLE_MS + 1)).toBe(false);
    // Busy planning a journey: nothing is asked, so nothing is waited for.
    const busy = createRouteChecks(fake().queries);
    busy.work([7], 0, true);
    expect(busy.settling(7, 0)).toBe(false);
  });
  it("asks about the nearest two only", () => {
    const { queries, started } = fake();
    const checks = createRouteChecks(queries);
    for (let t = 0; t < 8; t++) checks.work([1, 2, 3, 4], t * 100, false);
    expect(new Set(started)).toEqual(new Set(["reach:1", "escape:1", "reach:2", "escape:2"]));
    expect(checks.canReach(3)).toBeNull();
  });
  it("asks each question at most once a second per threat", () => {
    const { queries, started } = fake();
    const checks = createRouteChecks(queries);
    for (let now = 0; now < ASK_EVERY_MS; now += 50) checks.work([1], now, false);
    expect(started).toEqual(["reach:1", "escape:1"]);
    checks.work([1], ASK_EVERY_MS, false);
    checks.work([1], ASK_EVERY_MS + 50, false);
    expect(started).toHaveLength(4);
  });
  it("does at most one slice of work each time the state is read", () => {
    const { queries, worked } = fake({}, 3);
    const checks = createRouteChecks(queries);
    checks.work([1, 2], 0, false);
    expect(worked()).toBe(SLICES_PER_TICK);
    checks.work([1, 2], 100, false);
    expect(worked()).toBe(2 * SLICES_PER_TICK);
  });
  it("a question that takes too long is dropped as unsure, keeping the last answer", () => {
    const quick = fake({ reach: "yes" });
    let slow = false;
    const checks = createRouteChecks({ reach: (id) => (slow ? () => "more" : quick.queries.reach(id)), escape: () => null });
    checks.work([1], 0, false);
    expect(checks.canReach(1)).toBe(true);
    slow = true;
    for (let i = 1; i <= MAX_SLICES + 2; i++) checks.work([1], ASK_EVERY_MS + i, false);
    expect(checks.canReach(1)).toBe(true);
    expect(checks.stats().unsure).toBe(1);
  });
  it("while the pathfinder is busy nothing is asked and the last answer stands", () => {
    const { queries, started } = fake({ reach: "no" });
    const checks = createRouteChecks(queries);
    checks.work([1], 0, false);
    const before = started.length;
    for (let now = 2000; now < 6000; now += 500) checks.work([1], now, true);
    expect(started).toHaveLength(before);
    expect(checks.canReach(1)).toBe(false);
    expect(checks.stats().skippedBusy).toBe(8);
  });
  it("an unsure answer leaves the last one in place", () => {
    const { queries } = fake({ reach: "unsure" });
    const checks = createRouteChecks(queries);
    checks.work([1], 0, false);
    expect(checks.canReach(1)).toBeNull();
  });
});
