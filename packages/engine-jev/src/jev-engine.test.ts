import { zstdDecompressSync } from "node:zlib";
import type { Question, State } from "@familiar/contracts";
import { APIError, APITimeoutError } from "@typesafe-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JevEngine } from "./jev-engine.js";
import { JevError } from "./jev-error.js";

const state: State = { schemaVersion: 2, tick: 3, timestamp: 1000, data: { self: { health: 6 } } };

/** A fetch that answers with `answers` (or `status` + body) and records every request. */
function mockFetch(answers: Record<string, unknown>, status = 200) {
  const calls: { url: string; body: { state: unknown; questions: Record<string, unknown>; model: string }; headers: Headers }[] = [];
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const raw = Buffer.from(init?.body as Uint8Array | string);
    const text = headers.get("content-encoding") === "zstd" ? zstdDecompressSync(raw).toString() : raw.toString();
    calls.push({ url: String(input), body: JSON.parse(text), headers });
    const payload = status === 200 ? { model: "jev-latest", answers, usage: { input_tokens: 10, output_tokens: 1 } } : { error: "boom" };
    return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls, spy: fetch };
}

const engineWith = (fetch: typeof globalThis.fetch) => new JevEngine({ apiKey: "test-key", fetch });

describe("JevEngine", () => {
  afterEach(() => vi.useRealTimers());

  it("asks a choice and returns choice, probabilities and confidence", async () => {
    const m = mockFetch({ next_action: { type: "choice", choice: "flee", confidence: 0.9, probabilities: { attack: 0.1, flee: 0.9 } } });
    const answers = await engineWith(m.fetch).decide(state, [
      { kind: "choice", id: "next_action", prompt: "What next?", options: ["attack", "flee"] },
    ]);

    expect(m.calls[0]!.body.questions).toEqual({
      next_action: { type: "choice", instructions: "What next?", criteria: { attack: null, flee: null } },
    });
    expect(answers).toEqual([
      { kind: "choice", id: "next_action", choice: "flee", probabilities: { attack: 0.1, flee: 0.9 }, confidence: 0.9 },
    ]);
  });

  it("asks a score as a rubric of levels and maps the level back to min..max", async () => {
    const m = mockFetch({
      danger: { type: "score", score: 2.5, confidence: 0.7, legend: {}, probabilities: {} },
      wide: { type: "score", score: 3.2, confidence: 0.6, legend: {}, probabilities: {} },
    });
    const answers = await engineWith(m.fetch).decide(state, [
      { kind: "score", id: "danger", prompt: "How dangerous?", min: 0, max: 9 },
      { kind: "score", id: "wide", prompt: "Percent?", min: 0, max: 100 },
    ]);

    const sent = m.calls[0]!.body.questions as Record<string, { criteria: string[] }>;
    expect(sent.danger).toEqual({ type: "score", instructions: "How dangerous?", criteria: ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"] });
    expect(sent.wide!.criteria).toEqual(["0", "11.11", "22.22", "33.33", "44.44", "55.56", "66.67", "77.78", "88.89", "100"]);
    expect(answers[0]).toEqual({ kind: "score", id: "danger", score: 2.5, confidence: 0.7 });
    expect(answers[1]!.kind === "score" && answers[1]!.score).toBeCloseTo(35.56, 2);
  });

  it("asks a noul and returns its probability as value", async () => {
    const m = mockFetch({ hungry: { type: "noul", noul: 0.8 } });
    const answers = await engineWith(m.fetch).decide(state, [{ kind: "noul", id: "hungry", statement: "I am hungry" }]);

    expect(m.calls[0]!.body.questions).toEqual({ hungry: { type: "noul", instructions: "I am hungry" } });
    expect(answers).toEqual([{ kind: "noul", id: "hungry", value: 0.8 }]);
  });

  it("keeps ids and question order whatever order Jev answers in", async () => {
    const m = mockFetch({
      c: { type: "score", score: 1, confidence: 1, legend: {}, probabilities: {} },
      a: { type: "noul", noul: 0.1 },
      b: { type: "choice", choice: "x", confidence: 1, probabilities: { x: 1 } },
    });
    const questions: Question[] = [
      { kind: "noul", id: "a", statement: "s" },
      { kind: "choice", id: "b", prompt: "p", options: ["x"] },
      { kind: "score", id: "c", prompt: "p", min: 0, max: 1 },
    ];
    const answers = await engineWith(m.fetch).decide(state, questions);
    expect(answers.map((a) => [a.kind, a.id])).toEqual([["noul", "a"], ["choice", "b"], ["score", "c"]]);
  });

  it("sends the state as JSON to /v1/systemone with the model and API key", async () => {
    const m = mockFetch({ q: { type: "noul", noul: 0 } });
    await new JevEngine({ apiKey: "test-key", model: "jev-test", fetch: m.fetch }).decide(state, [
      { kind: "noul", id: "q", statement: "s" },
    ]);
    const call = m.calls[0]!;
    expect(call.url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(call.headers.get("authorization")).toBe("Bearer test-key");
    expect(call.body.state).toEqual(state);
    expect(call.body.model).toBe("jev-test");
  });

  it("throws a JevError with the timeout as cause after 1500 ms, without retrying", async () => {
    vi.useFakeTimers();
    const hang = vi.fn(
      (_: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason))),
    );
    const engine = engineWith(hang as unknown as typeof globalThis.fetch);
    const result = engine.decide(state, [{ kind: "noul", id: "q", statement: "s" }]).catch((e: unknown) => e);

    await vi.advanceTimersByTimeAsync(1499);
    expect(await Promise.race([result, "pending"])).toBe("pending");
    await vi.advanceTimersByTimeAsync(1);

    const error = await result;
    expect(error).toBeInstanceOf(JevError);
    expect((error as JevError).cause).toBeInstanceOf(APITimeoutError);
    expect(hang).toHaveBeenCalledTimes(1);
  });

  it("throws a JevError with the API error as cause, without retrying", async () => {
    const m = mockFetch({}, 500);
    const error = await engineWith(m.fetch)
      .decide(state, [{ kind: "noul", id: "q", statement: "s" }])
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(JevError);
    expect((error as JevError).cause).toBeInstanceOf(APIError);
    expect(((error as JevError).cause as APIError).status).toBe(500);
    expect(m.spy).toHaveBeenCalledTimes(1);
  });

  it.each([0, 256])("rejects a choice with %i options without calling the API", async (n) => {
    const m = mockFetch({});
    const options = Array.from({ length: n }, (_, i) => `o${i}`);
    await expect(engineWith(m.fetch).decide(state, [{ kind: "choice", id: "c", prompt: "p", options }])).rejects.toThrow(JevError);
    expect(m.spy).not.toHaveBeenCalled();
  });

  it("accepts exactly 255 options", async () => {
    const options = Array.from({ length: 255 }, (_, i) => `o${i}`);
    const m = mockFetch({ c: { type: "choice", choice: "o7", confidence: 0.5, probabilities: { o7: 0.5 } } });
    await expect(engineWith(m.fetch).decide(state, [{ kind: "choice", id: "c", prompt: "p", options }])).resolves.toHaveLength(1);
  });

  it("throws a JevError if an answer is missing", async () => {
    const m = mockFetch({});
    await expect(engineWith(m.fetch).decide(state, [{ kind: "noul", id: "q", statement: "s" }])).rejects.toThrow(/no answer/);
  });

  it("reports the timing of the last call", async () => {
    const engine = engineWith(mockFetch({ q: { type: "noul", noul: 0 } }).fetch);
    expect(engine.lastTiming()).toBeNull();
    await engine.decide(state, [{ kind: "noul", id: "q", statement: "s" }]);
    expect(engine.lastTiming()).toEqual({ totalMs: expect.any(Number) });
  });
});
