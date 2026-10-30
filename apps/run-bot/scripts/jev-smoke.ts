// One real Jev request with a tiny fake state. Needs TYPESAFE_API_KEY.
//   node apps/run-bot/scripts/jev-smoke.ts
import type { Question, State } from "@familiar/contracts";
import { JevEngine } from "@familiar/engine-jev";

const state: State = {
  schemaVersion: 2,
  tick: 0,
  timestamp: Date.now(),
  data: { situation: "a zombie is 3 blocks away, health 6/20" },
};

const questions: Question[] = [
  { kind: "choice", id: "next_action", prompt: "What should the bot do next?", options: ["attack", "flee", "eat", "idle"] },
];

if (!process.env.TYPESAFE_API_KEY) {
  console.error("Set TYPESAFE_API_KEY in .env (or the environment), then run: pnpm jev-smoke");
  process.exit(1);
}

const engine = new JevEngine();
const answers = await engine.decide(state, questions);
console.log(JSON.stringify(answers, null, 2));
console.log(`latency: ${engine.lastTiming()?.totalMs.toFixed(0)} ms`);
