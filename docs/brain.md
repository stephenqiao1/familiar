# How the Brain Works

The bot's decisions come from **regions** (brain parts). Regions never call each other. They
share one **workspace** (shared memory), and one **arbiter** picks which proposal to act on.

```
Workspace (state · goal · signals · recent events)
   ▲ read/write        ▲ read/write          ▲ read/write
Reflex (layer 0)     Instinct (layer 1)     Prefrontal cortex (layer 2)
rules, every tick    Jev, every tick        LLM, every 15 s in the background
   │ proposals         │ proposals            │ (goals only, never proposals)
   ▼                   ▼
Arbiter: urgency + 0.2 × learned value wins (value from the scorebook, weighed by DA),
         plus a stay bonus for the running skill and a brake on risky skills (both from patience);
         a full-urgency reflex always wins; ties go to the faster (lower) layer
   ▼
Skill executor → Minecraft
```

Alongside these run layer-0 regions that propose little or nothing but shape the rest:
`dopamine`, `serotonin`, `noradrenaline`, `acetylcholine` (the neuromodulators) and `hippocampus` (memory).

## Words used in the code

| Word | Meaning |
|---|---|
| Region | One brain part. Has a `name`, a `layer` (speed rank) and `everyMs` (0 = every tick). |
| Proposal | A region's suggestion: an action, an `urgency` from 0 to 1, and a `reason`. |
| Workspace | Shared memory. Holds the world state, the current goal, signals, and recent skill events. |
| Signal | A named level from 0 to 1 that one region shares with the others (e.g. `in_danger`, `dopamine`, `patience`, `alarm`). |
| Goal | What the prefrontal cortex wants the bot working toward: text, steps (and how many are done), and what to carry (`wants`). Instinct reads it each tick. |
| Arbiter | Picks the winning proposal. |

All of these types live in one file: `packages/contracts/src/brain.ts`.

## Where things are

| Package | Job |
|---|---|
| `contracts` | Shared types only. |
| `core` | The brain loop (runs regions, asks the arbiter, acts, logs), workspace, skill executor. |
| `arbiter` | The pickers: `value-weighted` (used) and `highest-urgency`. |
| `region-reflex` | Runs a list of rules. |
| `region-instinct` | Asks a decision engine (Jev) questions each tick, and proposes its top 3 options. |
| `region-prefrontal` | Asks a planner (Claude) for a goal in the background. The goal also lists what to carry (`wants`); `take_items` and `deposit_items` follow it. The planner says how many steps are done. It can be paused, woken early, and given extra guidance. |
| `neuromodulators` | Chemical dials, each a region that shares signals (see below). |
| `memory` | The hippocampus: a store of events and places (`record`, `recall`, `knownPlaces`) and a `hippocampus` region that records moments worth remembering. Read by the planner (top memories and known places) and the state (`memory.nearby`). |
| `engine-jev`, `engine-claude`, `engine-echo` | The models regions use. `echo` is a free offline stand-in. |
| `minecraft` | Everything game-specific, including each region's Minecraft settings in `src/brain/`. |
| `apps/run-bot` | Starts it all. **`src/brain.ts` is the one list of regions.** |

The region packages know nothing about Minecraft. The Minecraft package supplies their
settings (which reflex rules, which questions, how to describe the world).

## The neuromodulators

Each bot's settings for these live in `bots.json`. What each bot learns and remembers is saved
in `data/<name>/`.

**Dopamine** (`dopamine` region): teaches which skills pay off, and sets effort.
- Scores a reward each time a need gets smaller (or something bad happens). Repeated rewards from
  the same rule shrink. Meeting a new kind of thing is a reward that halves each time.
- Adds rewards up per skill run. When the run ends, the scorebook learns from the surprise (OpAL:
  expected value, learned benefit and cost, and a success count, per skill and situation). A death
  teaches the skill that led to it an outcome of −5.
- Shares DA, a slow 0–1 level of recent reward (never below 0.15). The arbiter values each skill
  as benefit weight × benefit − cost weight × cost, with DA setting the weights.
- Proposes heading toward things in view that paid off before (urgency at most 0.3).
- Logs mood, a running average of surprises (only logged for now).

**Serotonin** (`serotonin` region): patience.
- Averages outlook inputs (safety, fed, light and shelter, equipped, progress) into an outlook;
  patience follows it slowly. A broken-looking input is named in the log.
- Patience changes three things: persistence (every tick the running skill gets a stay bonus that
  fades as its give-up time runs out, and is abandoned when the time is up; a reward restarts its
  clock), the planner's horizon, and a brake on risky skills.

**Noradrenaline** (`noradrenaline` region): alarm and search.
- **Alarm** (fast) rises on damage, a hostile appearing or a big surprise, and fades once the
  threat is gone. It takes the planner out of charge (offline above 0.8 until back under 0.5),
  interrupts and re-plans on a sudden jump, speeds up ticks, narrows attention to threats, stamps
  the strength of memories, and cuts patience.
- **Search** (slow) rises when the goal stops paying off and falls with steady success. It makes
  switching skills easier, widens the options offered, and tells the planner to rethink.

**Acetylcholine** (`acetylcholine` region): focus, "trust your senses and learn this now".
- Rises in the dark, at night, in closed-in or unfamiliar places, when medium surprises keep
  coming, and during a demanding skill. Falls with routine, idling and rest; forced to its lowest
  while asleep.
- Focus changes seven things: a remembered chest is believed only while trust in it (fading with
  age) is above focus; how much nearby detail and how many memories are taken in; how strongly new
  memories start; whether memories are consolidated (only at rest: prune, merge, and generalise
  into facts the planner is given); a cue pulse when something the goal said to watch for comes
  into view; a learning window (skill values update fully only just after a notable event); and how
  big a surprise must be to trip alarm.

## Common changes

| To... | Edit |
|---|---|
| Add a reflex | `packages/minecraft/src/brain/reflexes.ts` (write a rule, add it to `playerReflexes`) |
| Add a reward | `packages/minecraft/src/brain/rewards.ts` (write a rule, add it to `playerRewards`) |
| Change the scorebook's situation labels | `packages/minecraft/src/brain/situation-labels.ts` |
| Add or remove an outlook input (patience) | `packages/minecraft/src/brain/outlook.ts` (edit `playerOutlook`) |
| Add or remove an alarm trigger | `packages/minecraft/src/brain/alarm.ts` (edit `playerAlarms`) |
| Change what moves search | `packages/neuromodulators/src/noradrenaline/search.ts` (edit `createSearchInputs`) |
| Add or remove a focus input | `packages/minecraft/src/brain/focus.ts` (edit `playerFocus`) |
| Change what the bot remembers | `packages/minecraft/src/brain/memories.ts` (edit `playerMemories`) |
| Change what Jev is asked | `packages/minecraft/src/player-questions.ts` or `src/brain/instinct.ts` |
| Change what the planner sees | `packages/minecraft/src/brain/situation.ts` |
| Change how the arbiter picks | `createArbiter` in `apps/run-bot/src/brain.ts`, or `packages/arbiter/src/` |
| Change a bot's temperament | `bots.json` |
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
pnpm start -- --regions reflex,instinct              # without the prefrontal cortex
```

`--planner claude` needs `ANTHROPIC_API_KEY` in `.env`. `--engine jev` needs `TYPESAFE_API_KEY`.

## Logs (for research)

Each tick is one line in `logs/player-<time>.jsonl`. Each line holds every region's proposals,
timing, errors and trace (Jev's questions and answers, the planner's situation and plan, which
reflexes fired, rewards and surprises, each dial's inputs, memories recorded), plus the winner,
the goal and all signals. That makes it easy to ask questions like "how often did a reflex
override instinct?"

Things we noticed that may need attention later are in [findings.md](findings.md).
