import { describe, expect, it } from "vitest";
import { fakeBot, item } from "./fake-bot.test-helper.js";
import { primitive, type PrimitiveSpec } from "./primitive.js";

const signal = new AbortController().signal;
const spec = (over: Partial<PrimitiveSpec>): PrimitiveSpec => ({ name: "test", description: "", parts: ["hands"], expects: [], settleMs: 0, canRun: () => true, run: async () => ({ status: "done" }), ...over });

describe("primitive (the shared wrapper)", () => {
  it("makes a primitive skill that names its body parts", () => {
    expect(primitive(spec({ parts: ["head"], long: true }))).toMatchObject({ name: "test", primitive: true, parts: ["head"], long: true });
  });

  it("reports what changed, and that it was as expected", async () => {
    const { ctx, state } = fakeBot();
    const turnRight = primitive(spec({ expects: ["turned"], run: async () => (await ctx.bot.look(-Math.PI / 4, 0), { status: "done" }) }));
    expect(await turnRight.run(ctx, undefined, signal)).toEqual({ status: "done", changes: { turned: 45, asExpected: true } });
    expect(state.entity.yaw).toBeCloseTo(-Math.PI / 4);
  });

  it("is not as expected when the expected change did not happen", async () => {
    const { ctx } = fakeBot();
    const nothing = primitive(spec({ expects: ["turned"] }));
    expect(await nothing.run(ctx, undefined, signal)).toEqual({ status: "done", changes: { asExpected: false } });
  });

  it("watches the target block and the target entity", async () => {
    const { ctx, state } = fakeBot({ blocks: { "0,63,-1": "dirt" }, items: [item("dirt")], held: "dirt" });
    const dig = primitive(spec({ expects: ["targetBlock=air"], run: async () => (await ctx.bot.dig(ctx.bot.blockAt(state.entity.position.offset(0, 0, -1))!), { status: "done" }) }));
    expect((await dig.run(ctx, "dir:forward", signal)).changes).toEqual({ targetBlockWas: "dirt", targetBlock: "air", asExpected: true });
  });

  it("turns an error into a clean failure, and a stop into an interrupt", async () => {
    const { ctx } = fakeBot();
    const broken = primitive(spec({ run: async () => Promise.reject(new Error("server said no")) }));
    expect(await broken.run(ctx, undefined, signal)).toEqual({ status: "failed", reason: "server said no", changes: { asExpected: false } });
    const stopped = new AbortController();
    stopped.abort();
    expect(await broken.run(ctx, undefined, stopped.signal)).toMatchObject({ status: "interrupted" });
  });

  it("closes a container left open, unless the primitive works with one", async () => {
    const { ctx, state, log } = fakeBot();
    await ctx.bot.openContainer({} as never);
    await primitive(spec({ usesWindow: true })).run(ctx, undefined, signal);
    expect(state.currentWindow).not.toBeNull();
    const result = await primitive(spec({})).run(ctx, undefined, signal);
    expect(state.currentWindow).toBeNull();
    expect(log).toContain("closed window");
    expect(result.changes).toEqual({ asExpected: true }); // closed before the snapshot: not this primitive's doing
  });

  it("keeps extra changes the primitive reports itself", async () => {
    const { ctx } = fakeBot();
    const half = primitive(spec({ run: async () => ({ status: "interrupted", changes: { progress: 0.5 } }) }));
    expect(await half.run(ctx, undefined, signal)).toEqual({ status: "interrupted", changes: { progress: 0.5, asExpected: false } });
  });
});
