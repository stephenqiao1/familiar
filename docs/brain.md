# How the Brain Works

The bot's decisions come from **regions** (brain parts). Regions never call each other. They
share one **workspace** (shared memory), and one **arbiter** picks which proposal to act on.

```
Workspace (state · goal · signals · recent events)
   ▲ read/write        ▲ read/write          ▲ read/write
Reflex (layer 0)     Instinct (layer 1)     Neocortex (layer 2)
rules, every tick    Jev, every tick        LLM, every 15 s in the background
   │ proposals         │ proposals            │ (goals only, never proposals)
   ▼                   ▼
Arbiter: highest urgency wins; ties go to the faster (lower) layer
   ▼
Skill executor → Minecraft
```

## Words used in the code

| Word | Meaning |
|---|---|
| Region | One brain part. Has a `name`, a `layer` (speed rank) and `everyMs` (0 = every tick). |
| Proposal | A region's suggestion: an action, an `urgency` from 0 to 1, and a `reason`. |
| Workspace | Shared memory. Holds the world state, the current goal, signals, and recent skill events. |
| Signal | A named level from 0 to 1 that one region shares with the others (e.g. `in_danger`). |
| Goal | What the neocortex wants the bot working toward. Instinct reads it each tick. |
| Arbiter | Picks the winning proposal. |

All of these types live in one file: `packages/contracts/src/brain.ts`.

## Where things are

| Package | Job |
|---|---|
| `contracts` | Shared types only. |
| `core` | The brain loop (runs regions, asks the arbiter, acts, logs), workspace, skill executor. |
| `arbiter` | The picker. |
| `region-reflex` | Runs a list of rules. |
| `region-instinct` | Asks a decision engine (Jev) questions each tick. |
| `region-neocortex` | Asks a planner (Claude) for a goal in the background. |
| `engine-jev`, `engine-claude`, `engine-echo` | The models regions use. `echo` is a free offline stand-in. |
| `minecraft` | Everything game-specific, including each region's Minecraft settings in `src/brain/`. |
| `apps/run-bot` | Starts it all. **`src/brain.ts` is the one list of regions.** |

The region packages know nothing about Minecraft. The Minecraft package supplies their
settings (which reflex rules, which questions, how to describe the world).

## Common changes

| To... | Edit |
|---|---|
| Add a reflex | `packages/minecraft/src/brain/reflexes.ts` (write a rule, add it to `minerReflexes`) |
| Change what Jev is asked | `packages/minecraft/src/miner-questions.ts` or `src/brain/instinct.ts` |
| Change what the planner sees | `packages/minecraft/src/brain/situation.ts` |
| Change how the arbiter picks | `packages/arbiter/src/highest-urgency.ts`, or write a new arbiter |
| Turn a region off | Run with `--regions reflex,instinct` (no code change) |
| Add a new region | See below |

## Adding a new region

1. Copy `packages/region-reflex` to `packages/region-<name>` and rename it in `package.json`.
2. Write a function that returns a `Region`:
   ```ts
   export function createMyRegion(): Region {
     return {
       name: "amygdala",
       layer: 1,       // speed rank: lower is faster and wins ties
       everyMs: 0,     // 0 = every tick; e.g. 5000 = in the background every 5 s
       run(ws) {
         const fear = ws.signals.in_danger?.value ?? 0;
         ws.setSignal("fear", fear);   // share something with other regions
         return { proposals: [], trace: { fear } };   // trace is saved in the log
       },
     };
   }
   ```
3. Add the package to the root `tsconfig.json` and to `apps/run-bot` (`package.json` and `tsconfig.json`), then run `pnpm install`.
4. Add one line to `apps/run-bot/src/brain.ts`.

## Running

```sh
pnpm start -- --engine jev --planner claude          # full brain
pnpm start -- --regions reflex,instinct              # without the neocortex
```

`--planner claude` needs `ANTHROPIC_API_KEY` in `.env`. `--engine jev` needs `TYPESAFE_API_KEY`.

## Logs (for research)

Each tick is one line in `logs/miner-<time>.jsonl`. Each line holds every region's proposals,
timing, errors and trace (Jev's questions and answers, the planner's situation and plan,
which reflexes fired), plus the winner, the goal and all signals. That makes it easy to ask
questions like "how often did a reflex override instinct?"
