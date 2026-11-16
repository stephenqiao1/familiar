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
Skill executor → skills → primitives (every movement) and locomotion (all travel) → Minecraft
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
| Primitive | One of the body's built-in movements (`look_at`, `step`, `break_block`, ...): small, stoppable, and reporting what it changed. Skills marked `primitive: true`. The only code that moves the bot's body. |
| Changes | What a skill run changed (`moved`, `gained`, `targetBlock`, ...), carried on the skill event that ends it. |
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

## The spinal motor layer: primitives

The primitives (`packages/minecraft/src/primitives/`) are the small set of movements everything
else is built from, and the **single doorway** to the bot's body.

| Part | Primitives |
|---|---|
| Head | `look_at`, `turn` |
| Legs | `step`, `step_toward`, `jump`, `sneak`, `brace`, `pick_up` |
| Hands | `equip`, `drop_item`, `use_item`, `use_on`, `hit`, `break_block`, `place_block`, `open`, `move_item`, `close`, `craft` |

- **One doorway.** Each primitive file exports the skill and a plain function that does the
  movement (`doHit`, `doEquip`, `doLookAt`, ...). Every skill and helper acts only through those
  functions. Travel is the other doorway: the locomotion controller (below) owns the pathfinder
  and the keys held for a journey. `pnpm test` and `pnpm skill-check` fail if any file outside
  `primitives/` and `locomotion/` calls the bot's action methods, or if any file outside
  `locomotion/` touches the pathfinder or holds movement keys for travel.
- **Safe to try at random.** A primitive that cannot run refuses, or fails with a reason. It
  respects `safety.ts` and `protected.ts` (no stepping into lava or off a drop, no breaking the
  base). It lets go of keys and items when it ends or is stopped. `break_block` is the one long
  primitive (`long: true`); stopped, it reports how far it got.
- **Targets that need no names.** Besides `nearest:<name>`, `pos:x,y,z`, `entity:<id>` and
  `player:<name>`: `ahead` (what the bot is looking at, within reach), `dir:forward|back|left|right|up|down`
  (the neighbouring block, relative to where it faces), `held` (the item in hand) and
  `item:<name>` (for `equip`, `craft`, `drop_item`; `item:<name>:in` or `:out` for `move_item`).
- **Report back.** Every primitive run is wrapped in one before-and-after snapshot
  (`primitive.ts`, `snapshot.ts`). The skill event that ends the run carries `changes`, listing
  only what changed: `moved`, `turned`, `gained`, `lost`, `held`, `targetBlockWas` and
  `targetBlock`, `health`, `food`, `targetHurt`, `targetGone`, `opened`, `closed`, `drops`,
  `sneaking`. Each primitive declares in one line what it expects when it works
  (`expects: ["targetBlock=air"]`), and `changes.asExpected` says whether that happened. Nothing
  reacts to it yet; the hook for a later prediction checker is marked in `primitive.ts`.
- **A container stays open only for container work.** `open` leaves the container open for
  `move_item` and `close`. Any other primitive closes it first.
- **Different body parts at the same time** (`--same-time`, off by default). A skill names the
  parts it uses (`parts`); one that names none uses all three. With the flag on, one head-only
  primitive (a look) may run alongside a running skill that leaves the head free: walking
  (`go_to`, `return_to_base`, `flee`) and eating. The main action always wins. While walking, the
  look is held for a second: the head turns to the target and the legs keep their direction by
  pressing other keys, so the bot looks one way and walks another. `gaze.ts` decides where to
  look and which keys that takes; the locomotion controller knows whether the bot is walking
  plainly and which way, and presses them. The brainstem's orienting look uses this.
- **Learned skills** are chains of primitives kept as data, never code. The runner
  (`packages/core/src/chain.ts`) runs the steps in order, stops at the first failure, and returns
  each step's result and changes. Any chain in `data/<bot>/learned-skills.json`
  (`[{ "name", "description", "steps": [{ "primitive", "target" }] }]`) is loaded at start as a
  skill. None ship with the bot.

Reflexes can always use primitives. They are off Jev's menu unless the bot runs with
`--primitives`. `escape_hazard` and `surface` are reflex-only and never on the menu.

If the bot dies soon after a soft defence reflex was held back or outvoted with a hostile within
8 blocks, the run prints `!! DIED WITH DEFENCE OVERRULED` with the gain and what won, and the
tick's log line carries `defenceOverruledBeforeDeath`.

## Locomotion: one controller owns all travel

The spinal cord produces the rhythm of walking by itself; the brain only sends "go", "faster",
"stop". The locomotion controller (`packages/minecraft/src/locomotion/`, one per bot, on
`MinecraftCtx.locomotion`) is that circuit. Every skill that travels asks it; nothing else touches
the pathfinder.

**Commands.** Each travel command returns a result (done, failed with a reason, or interrupted),
takes an abort signal, and always leaves the body still with no keys held. One journey at a time:
a new command replaces the current one.

| Command | Does |
|---|---|
| `goTo(place, { range, see, urgent, until })` | Travel to within range of a place. `see`: end where the block can be seen (for a chest). `urgent`: a dash to safety. |
| `follow(entity, { range, once })` | Keep within range of something that moves; `once` ends the first time it is in range. |
| `awayFrom(threat, { distance, prefer, until })` | Get that far from it, leaning toward a preferred place (home) when that is not toward the threat. |
| `stop()` | End travel now and release every key. |
| `setDrive({ speed, caution })` | Faster, slower, more or less careful. Takes effect at once, also mid-journey. |
| `status()` | `{ moving, pattern, gait, stuck, progress, recoveries }` |

**Patterns** (one small file each, chosen from what the body senses; each switch is logged):
- `walk`: the pathfinder, with one of two rule sets. *Normal* may dig its way through. *Careful*
  does no digging and no placing; it is used within 16 blocks of home and when caution is above
  0.6. Neither ever parkours, digs a door, or breaks what `safety.ts` or `protected.ts` forbids.
- `swim`: held-key steering, used while the bot is afloat (the pathfinder plans badly in liquid).
  It switches back to walking when the feet are out of the water.
- `dash`: the same straight-line steering on land, for an urgent journey (`escape_hazard`, `surface`).
- More patterns (climbing, boats) have a marked slot in `patterns.ts`. They are not built.

**Drive: faster, slower, careful.** `packages/minecraft/src/brain/locomotion.ts` maps the brain's
signals to the drive once per tick:
- speed = 0.4 + 0.5 × alarm + 0.3 × (dopamine − 0.5) − 0.3 × hunger
- caution = 0.3 + 0.3 × focus, and 0 while alarm is above 0.6 (a frightened bot does not tiptoe)

Speed sets the gait: below 0.3 a walk; up to 0.7 a jog (sprinting only once a stretch has proved
straight); above 0.7 a sprint whenever the game allows. The bot never sprints at 6 food or less
(the game's rule). Following something, it sprints to catch up when it falls behind. Caution above
0.6 uses the careful rules and sneaks within one block of a drop of 3 or more. Each bot's
strengths are in `bots.json` under `locomotion` (`speedFromAlarm`, `speedFromDopamine`,
`cautionFromFocus`); with all three at 0 the drive is fixed at speed 0.4, caution 0.3.

**Feeling the ground.** About four times a second while travelling:
- *Stuck*: supposed to be moving, but less than half a block covered in 1.5 s, and not digging.
  It tries up to three local corrections, each logged: a jump; a step back and a sidestep (only
  onto somewhere safe to stand); dropping the route and planning again. Then it gives up and
  returns `failed` with the reason `stuck at x,y,z`, and the layer above decides. An urgent
  journey skips the fiddling and only plans again. Failing as stuck three times within a minute
  at one place marks the spot, and routes avoid it for 5 minutes.
- *A door in the way*: the pathfinder sees a door as a wall. If the bot and its goal are on
  opposite sides of a door, the controller walks up to it, opens it with the `use_on` movement,
  steps through, and carries on.
- *Late*: when the route is known, the journey's time is estimated from its length and the gait.
  Past twice that, the result's changes say `late: true`. Nothing reacts to it yet.

**What it reports.**
- The state: `self.locomotion` is `{ moving, pattern, gait, stuck }`.
- The brainstem shares a `stuck` signal: 1 while the legs are stuck, fading over about 5 seconds.
  The hook for the search dial to read it is marked in `noradrenaline/search.ts`; it is not wired.
- Each journey's skill event carries in `changes`: `distance`, `seconds`, `patternSwitches`,
  `recoveries` (and which, in `recovered`), `late`, and `asExpected` (done and not late). This is
  the same mechanism the primitives use.
- `pnpm brain-report` has a locomotion section: journeys, the share that finished, stuck events
  and how each ended, and time in each pattern and gait.

`step`, `jump` and `sneak` are single movements, not journeys, and hold their own key.

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
| Add a primitive | `packages/minecraft/src/primitives/`: one file that exports a `do...` function and a skill made with `primitive({ parts, expects, ... })`; add it to `primitives` in `index.ts` and a scene to `apps/run-bot/scripts/primitive-check/scenes.ts` |
| Make a skill act on the body | Call a primitive's `do...` function. Never call the bot's action methods outside `primitives/` (the doorway rule fails the build's tests). |
| Add a locomotion pattern | `packages/minecraft/src/locomotion/`: one small file like `swim.ts`, a name in `types.ts`, and a branch in `patterns.ts` (the slot is marked) |
| Change what sets speed or caution | `packages/minecraft/src/brain/locomotion.ts` (`driveFrom`); a bot's strengths are in `bots.json` under `locomotion` |
| Change the gaits | `packages/minecraft/src/locomotion/gait.ts` |
| Change stuck detection or recovery | `packages/minecraft/src/locomotion/feel.ts` (when, and in what order) and `recover.ts` (what each correction does) |
| Change the pathing rules | `packages/minecraft/src/locomotion/rules.ts` (normal and careful) |
| Make a skill travel | Call `ctx.locomotion.goTo`, `follow` or `awayFrom`. Never touch `bot.pathfinder` outside `locomotion/`. |
| Add a target format | `packages/minecraft/src/target.ts` (parse) and `resolve-target.ts` (resolve) |
| Change what `changes` reports | `packages/minecraft/src/primitives/snapshot.ts` |
| Add a learned skill by hand | `data/<bot>/learned-skills.json` |
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
pnpm start -- --engine jev --same-time               # let a look run alongside a skill that leaves the head free
pnpm start -- skill break_block --target dir:forward # run one skill or primitive and print what it changed
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
