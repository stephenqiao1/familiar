# How the Brain Works

The bot's decisions come from **regions** (brain parts). Regions never call each other. They
share one **workspace** (shared memory), and one **arbiter** picks which proposal to act on.

```
Workspace (state · goal · signals · recent events)
   ▲ read/write            ▲ read/write          ▲ read/write
Spinal cord and brainstem  Instinct (layer 1)    Prefrontal cortex (layer 2)
(layer 0, every tick)      Jev, every tick       LLM, every 15 s in the background
 Reflex: hard and soft     │ proposals           │ goals only, never proposals;
   rules                   │                     │ a goal can load responses (ifThen)
 Brainstem: reflex gains,  │                     │ and hold reflexes back (holdBack)
   startle, orienting,     │                     │
   loaded responses,       │   ◄── paused while asleep and undisturbed ──►
   arousal gate, body
   │ proposals             │
   ▼                       ▼
Arbiter: urgency + 0.2 × learned value wins (value from the scorebook, weighed by DA),
         plus a stay bonus for the running skill and a brake on risky skills (both from patience);
         a full-urgency proposal (a hard reflex, a startle) always wins; ties go to the faster layer
   ▼
Skill executor → Minecraft (skills, the two reflex-only skills, and the primitives)
```

Alongside these run layer-0 regions that propose little or nothing but shape the rest:
`dopamine`, `serotonin`, `noradrenaline`, `acetylcholine` (the neuromodulators) and `hippocampus` (memory).

Regions that run every tick start in the order they are listed in `apps/run-bot/src/brain.ts`.
All but instinct finish at once, so each sees the signals set by the ones listed before it in the
same tick; a signal from a region listed later is read one tick late.

## Words used in the code

| Word | Meaning |
|---|---|
| Region | One brain part. Has a `name`, a `layer` (speed rank) and `everyMs` (0 = every tick). |
| Proposal | A region's suggestion: an action, an `urgency` from 0 to 1, and a `reason`. |
| Workspace | Shared memory. Holds the world state, the current goal, signals, and recent skill events. |
| Signal | A named level from 0 to 1 that one region shares with the others (e.g. `in_danger`, `dopamine`, `patience`, `alarm`). |
| Goal | What the prefrontal cortex wants the bot working toward: text, steps (and how many are done), what to carry (`wants`), things to watch for (`watchFor`), responses loaded in advance (`ifThen`) and reflexes to hold back (`holdBack`). Instinct reads it each tick. |
| Hard reflex | A life-saving rule. Always urgency 1; nothing learned, felt or planned can stop it. |
| Soft reflex | A tunable rule. Its base urgency is multiplied by a gain and capped at 0.95, so it competes in the arbiter. |
| Primitive | One of the body's built-in actions (`look_at`, `step_toward`, `jump`, ...): tiny, stoppable, about a second. Skills marked `primitive: true`. |
| Arbiter | Picks the winning proposal. |

All of these types live in one file: `packages/contracts/src/brain.ts`.

## Where things are

| Package | Job |
|---|---|
| `contracts` | Shared types only. |
| `core` | The brain loop (runs regions, asks the arbiter, acts, logs), workspace, skill executor. |
| `arbiter` | The pickers: `value-weighted` (used) and `highest-urgency`. |
| `region-reflex` | Runs a list of rules, hard and soft, and logs each fired rule's kind, base urgency, gain and final urgency. |
| `region-brainstem` | Supplies the reflex gains, and a `brainstem` region: startle, orienting, loaded responses, the arousal gate and body signals. |
| `region-instinct` | Asks a decision engine (Jev) questions each tick, and proposes its top 3 options. Can be paused. |
| `region-prefrontal` | Asks a planner (Claude) for a goal in the background. The goal also lists what to carry (`wants`); `take_items` and `deposit_items` follow it. The planner says how many steps are done. It can be paused, woken early, and given extra guidance. |
| `neuromodulators` | Chemical dials, each a region that shares signals (see below). |
| `memory` | The hippocampus: a store of events and places (`record`, `recall`, `knownPlaces`) and a `hippocampus` region that records moments worth remembering. Read by the planner (top memories and known places) and the state (`memory.nearby`). |
| `engine-jev`, `engine-claude`, `engine-echo` | The models regions use. `echo` is a free offline stand-in. |
| `minecraft` | Everything game-specific, including each region's Minecraft settings in `src/brain/`. |
| `apps/run-bot` | Starts it all. **`src/brain.ts` is the one list of regions.** |

The region packages know nothing about Minecraft. The Minecraft package supplies their
settings (which reflex rules, which questions, how to describe the world).

## The spinal cord and brainstem

The fastest layer keeps the body alive and reacts before the rest of the brain has noticed. Its
reflexes are not fixed: the layers above keep adjusting how strongly each one fires. Only the
life-saving ones cannot be overruled. Each bot's settings are the `brainstem` block in `bots.json`.

**Reflexes** (`reflex` region, rules in `packages/minecraft/src/brain/reflexes.ts`):
- Hard, always urgency 1: `in_lava_or_fire` (→ `escape_hazard`), `drowning` (air 6 or less, under
  water → `surface`), `last_stand` (health 6 or less with a hostile within 4 blocks → `flee`).
- Soft, defence by distance to the nearest hostile:
  - far (9 to 16 blocks, or it cannot reach the bot): no reflex, only a look;
  - approaching (4 to 8 blocks): `flee`, base urgency 0.7;
  - contact (3 blocks or less): `attack` if armed and health is 10 or more, else `flee`; base 0.9.
    Creepers and ranged mobs are always fled from.
- Soft: `eat_when_starving`, base 0.9.

**Brainstem** (`brainstem` region and `createReflexGain`, settings in `packages/minecraft/src/brain/brainstem.ts`):
- **Reflex gains.** A soft reflex's urgency is base × gain, where
  gain = (0.6 + 0.8 × alarm) × bravery factor × hold-back factor, kept within 0.3 to 1.5. Brave
  bots flee less readily and fight more readily; timid bots the reverse. A reflex the goal holds
  back fires at 0.3 of its gain.
- **Startle.** A hit from something unseen, a hostile first seen within 3 blocks, or an explosion
  within 16: shares `startle` for one tick, proposes `brace` once (urgency 1) and raises alarm. At
  most one per 5 seconds.
- **Orienting.** Something new (a hostile or player coming into view, whoever just hurt the bot):
  shares `orienting` and proposes `look_at`, only when the bot is idle and nothing faster spoke.
- **Loaded responses.** A goal's `ifThen` (up to 3, e.g. creeper → flee) fires at urgency 0.95 the
  moment the thing appears, without waiting for the planner. At most one per 3 seconds. A response
  naming an unknown skill, a primitive or a reflex-only skill is dropped and logged.
- **Hold back.** A goal's `holdBack` names soft reflexes (or the skills they propose) to damp.
  Hard reflex names are ignored and logged. A goal with `ifThen` or `holdBack` survives an alarm
  interrupt.
- **Arousal gate.** Shares `arousal` (about 0.05 asleep, 0.3 drowsy, toward 1 with alarm). While
  asleep and undisturbed it shares `upper_paused`: instinct and the prefrontal cortex make no
  calls. A startle, damage, a hard reflex or alarm ends the pause on the same tick. Reflexes, the
  neuromodulators and memory never pause.
- **Body signals.** Shares `air` (how short of breath), `pain` (recent damage, fading over about
  10 seconds) and `hunger`, for a later drives region.

**Primitives** (`packages/minecraft/src/primitives/`): `look_at`, `step_toward`, `jump`,
`break_block`, `place_block`, `use_item`, `hit`, `pick_up`, `brace`. Reflexes can always use them.
They are off Jev's menu unless the bot runs with `--primitives`. `escape_hazard` and `surface` are
reflex-only and never on the menu.

If the bot dies soon after a soft defence reflex was held back or outvoted with a hostile within
8 blocks, the run prints `!! DIED WITH DEFENCE OVERRULED` with the gain and what won, and the
tick's log line carries `defenceOverruledBeforeDeath`.

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
| Add a hard reflex | `packages/minecraft/src/brain/reflexes.ts` (write a rule with `"hard"`, add it to `playerReflexes`). Keep these to what saves the bot's life: nothing can overrule them. |
| Add a soft reflex | Same file, with `"soft"` and a base urgency. If it defends the bot, add its name to `DEFENCE_REFLEXES`; if its skill moves toward or away from a threat, add the skill to `LEANINGS` in `brainstem.ts`. |
| Add a startle detector | `packages/minecraft/src/brain/brainstem.ts` (write a detector, add it to `playerStartles`) |
| Add a primitive | `packages/minecraft/src/primitives/` (one file, `primitive: true`, add it to `primitives` in `index.ts`) |
| Change a bot's bravery | `bots.json`: `brainstem.bravery` (0 timid, 1 brave) |
| Turn part of the brainstem off | `bots.json`: set its strength in `brainstem` to 0 |
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
pnpm start -- --engine jev --primitives              # let Jev choose primitives too
pnpm start -- --plan '{"goal":"Explore","ifThen":[{"when":"creeper","skill":"flee"}]}'   # a fixed plan for the echo planner
```

`--planner claude` needs `ANTHROPIC_API_KEY` in `.env`. `--engine jev` needs `TYPESAFE_API_KEY`.

## Logs (for research)

Each tick is one line in `logs/player-<time>.jsonl`. Each line holds every region's proposals,
timing, errors and trace (Jev's questions and answers, the planner's situation and plan, which
reflexes fired (kind, base urgency, gain, final urgency), startles, loaded responses, rewards and
surprises, each dial's inputs, memories recorded), plus the winner,
the goal and all signals. That makes it easy to ask questions like "how often did a reflex
override instinct?"

Things we noticed that may need attention later are in [findings.md](findings.md).
