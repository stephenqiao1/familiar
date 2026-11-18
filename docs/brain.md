# How the Brain Works

The bot's decisions come from **regions** (brain parts). Regions never call each other. They
share one **workspace** (shared memory), and one **arbiter** picks which proposal to act on.

```
Workspace (state · goal · signals · attended · recent events)
   ▲ read/write            ▲ read/write          ▲ read/write
Spinal cord and brainstem  Instinct (layer 1)    Prefrontal cortex (layer 2)
(layer 0, every tick)      Jev, every tick       LLM, every 15 s in the background
 Reflex: hard and soft     │ proposals           │ goals only, never proposals;
   rules                   │                     │ a goal can load responses (ifThen)
 Medulla: vital signs and  │                     │ and hold reflexes back (holdBack)
   the urges of upkeep     │                     │
 Brainstem: reflex gains,  │                     │
   startle, loaded         │   ◄── paused while asleep and undisturbed ──►
   responses, arousal gate
 Colliculus: the map of
   where things are; turns
   the head (look_at)
   │ proposals             │
   ▼                       ▼
Arbiter: urgency + 0.2 × learned value wins (value from the scorebook, weighed by DA),
         plus a stay bonus for the running skill and a brake on risky skills (both from patience);
         the stay bonus shrinks while the body has an urge (the medulla's `urge` signal);
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
| Workspace | Shared memory. Holds the world state, the current goal, signals, the one thing being attended to, and recent skill events. |
| Attended | The one thing the bot is attending to right now: `{ id, kind, bearing, salience, since }`, or null. Set by the colliculus (`ws.setAttended`); logged each tick. |
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
| `region-brainstem` | Supplies the reflex gains, the defence circuit's choice of defence, a `brainstem` region (startle, loaded responses, the arousal gate, the defence signals), a `medulla` region (vital signs and the graded urges of upkeep) and a `colliculus` region (the map of where things are and how sudden; it turns the head). |
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
  water → `surface`), `last_stand` (health 6 or less with a hostile within 4 blocks → `flee`; it goes by the game's own
  hostile flag, whatever the bot has learned, and stays silent when the bot is cornered, so the
  defence circuit fights instead of fleeing into a wall).
- Soft, defence: `defence_freeze`, `defence_flee`, `defence_fight` and `recuperate`. At most one
  fires each tick, chosen by the defence circuit (next section).
- Soft: `eat_when_starving`, base 0.9 (food 6 or less; not with a threat on the bot; a food
  known to be bad is eaten only now, and only when there is nothing else).

**Withdrawal and stretch reflexes** (the body's fastest protections; rules in
`packages/minecraft/src/brain/protective-reflexes.ts`, switched per bot in `bots.json` under `reflexes`):

| Reflex | Kind | Fires when | Does |
|---|---|---|---|
| `pain_withdrawal` | hard | Hurt in the last 600 ms, with no attacker, and not by falling, drowning, starving, lava or fire | `withdraw`: move to the nearest safe place at least 2 blocks from where it hurt (4, then 6, if hurt again there). It needs no knowledge of what the thing is. |
| `buried` | hard | The head is inside a solid block | `dig_out`: break the block at head height or move to open space, whichever is quicker |
| `about_to_touch` | hard | Moving (a single step, a push; not a planned route) and the next block that way is lava, fire or a block known to hurt | `recoil`: stop at once and step back |
| `hold_ground` | soft, base 0.8 | Pushed, and the push is carrying it toward a big drop, lava, fire or a block known to hurt within 2 blocks | `steady`: sneak and step back to where it stood |
| `edge_guard` | soft, base 0.6 | Stepping (not on a planned route) toward a drop of 3 or more within 1 block | `steady`: stop and step back |
| `falling_right` | hard | Falling toward a landing that would hurt, with a better one (water, or ground at least 3 blocks higher) within 2 blocks sideways | `air_steer`: face it and push toward it, letting go in time to come down on it |

- The three older hard reflexes are unchanged and come first. `falling_right` is the righting
  reflex (see Balance and posture below): with no better landing in reach it stays silent, since
  mid-air there is then nothing a body can do. `hold_ground` never fires for a bot that was
  moved somewhere else all at once (a teleport is not a push).
- The soft two take the brainstem's gain (alarm raises them) and a goal's `holdBack` can name
  them, for example when the bot means to drop down. They never fire while a hard reflex's skill runs.
- **The place moved to must itself hold.** `withdraw` only picks a spot that is safe to stand on,
  not beside anything known to hurt, and not at the edge of a big drop. If nowhere within 6 blocks
  qualifies it stays put.
- **Switching off the opposing movement.** When a hard protective reflex takes over, the journey
  is stopped, the spot that hurt is avoided by routes for 5 minutes, and the skill that was running
  ends as *failed* ("cut short by withdraw at x,y,z"), so the scorebook learns it cost something.
- **Sore.** For 30 seconds after a withdrawal the brainstem shares a `sore` signal (1 fading to 0):
  `about_to_touch` looks 2 blocks ahead instead of 1, and `hold_ground`'s base rises to 0.9.
- Each withdrawal's skill event carries, in `changes`: the cause it blamed, where it hurt, where
  it went, the time from the hurt to the skill starting (`hurtToStartMs`), and anything learned.

**Learning what hurts** (`packages/minecraft/src/pain.ts`). The bot is born knowing only what
`reflexes.innateHurts` lists (by default lava, fire, soul_fire, magma_block, cactus). Each
withdrawal blames a cause: the block the game's damage kind names if the body is touching one,
else every block it is touching. A block type blamed on two separate occasions (at least 2
seconds apart) becomes *known to hurt*: the standing checks, the pathing rules and the reflexes
above all respect it from then on, and a memory of kind "danger" is recorded. Only damage with no
attacker teaches anything, and air, water and the base's own blocks are never learned. The record
is kept per bot in `data/<name>/hurts.json`.

**What the body feels** (state schema 12): `self.lastHurt` has the game's own name for the damage
(`kind`: "cactus", "hot_floor", "in_wall", "fall", "mob_attack"...) and where it happened (`at`);
`self.touching` (blocks at the feet, head, under the feet and on the four sides); `self.inBlock`;
`self.pushed` (moved without meaning to, which way, and the first danger within 2 blocks that
way); `self.motion` (which way it is moving, and the danger ahead). `nearby.hazards` also lists
blocks known to hurt within 3 blocks.

**Brainstem** (`brainstem` region and `createReflexGain`, settings in `packages/minecraft/src/brain/brainstem.ts`):
- **Reflex gains.** A soft reflex's urgency is base × gain, where
  gain = (0.6 + 0.8 × alarm) × bravery factor × hold-back factor, kept within 0.3 to 1.5. Brave
  bots flee less readily and fight more readily; timid bots the reverse. A reflex the goal holds
  back fires at 0.3 of its gain.
- **Startle** is graded: how big it is depends on the event and on the state the bot is in.
  The maths is one game-free file, `packages/region-brainstem/src/startle.ts`:

      magnitude = intensity × potentiation × (1 − warning) × (1 − habituated) × brainstem.startle

  kept within 0 to 1, and 0 for something the bot did itself.

  | Part | Range | What sets it |
  |---|---|---|
  | intensity | 0 to 1 | The detector (`packages/minecraft/src/brain/startle.ts`): a sound by how loud it is here and how sudden that kind of sound is; a hostile first seen within 3 blocks by how near and how fast it came; a hit from nowhere, or damage with no attacker, by the share of health lost; something looming. The strongest event of the tick counts. |
  | potentiation | 1 to 1.6 | Being on edge: alarm (+0.3), `sore` (+0.2), the dark (+0.15), a place remembered as bad (+0.15) |
  | warning | 0 to 0.8 | It was seen coming: the source (or the place it happened) was attended, or was in view and approaching, in the last 2 seconds; or a weaker event of the same kind came from the same place in the last half second |
  | habituated | 0 to 0.9 | The same kind of event from roughly the same place (8-block squares) halves each time, and comes back over about a minute. If other harm follows within 3 seconds it resets. Per kind and place, never global. It shares its code with the colliculus (`habituation.ts`). |
  | self-caused | 0 | The event is where the bot just broke, placed, lit or opened something (from the primitives' `changes.targetAt`), or is the noise of something it is striking: within 4.5 seconds and 8 blocks. Unsure counts as not self-caused. |

  If health dropped on the same tick, warning and habituated are capped at 0.5: an event that is
  hurting the bot right now is never silenced. Nothing is special-cased for hunger or fire: a
  small hurt that repeats startles the first time at most, then the bot is used to it.

  | Magnitude | What the body does |
  |---|---|
  | under 0.25 | Nothing. The colliculus's look is enough. |
  | 0.25 to 0.6 | A **flinch** (`flinch`, reflex-only, proposed at 0.9): the legs freeze for about 150 ms and the head snaps to the source. It claims no part of the body, so it runs beside whatever is under way: the journey is paused (`locomotion.pause`) and picks up again by itself. Never while a hard reflex is acting. |
  | over 0.6 | A **full startle**: `brace` (stop, face it, hold) at urgency 1, the hold growing from 250 to 500 ms with the magnitude |

  `startle` is shared as the magnitude for that tick. At most one startle per second.
  **Alarm** gets 0.4 × magnitude. A startle and what set it off are one event, so where that
  thing has an alarm trigger of its own (a hit, a mob appearing, something looming) alarm takes
  the larger of the two, not their sum; a bang, which sets off nothing else, adds in full.
  **A prepared action**: a goal's `ifThen` entry may carry `onStartle: true`. A full startle
  releases the first such response at urgency 1 in place of the brace, whatever caused the
  startle, on the same tick. At most one, and never within 3 seconds of another loaded response.
- Turning to look at things is the colliculus's job (below), not the brainstem's.
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
- It also shares `stuck`, `sore` and `unsteady` (1 − balance; see Balance and posture). The
  body's vital signs are the medulla's job (below).

## The defence circuit

The bot does not defend by distance alone. Each tick it sizes up everything that might be a
threat, then picks one kind of defence from how close the danger is in time, whether it has been
noticed, and whether there is a way out. (In an animal this is the periaqueductal gray: it does
not work out what the threat is, only which defence fits.) Each bot's settings are the `defence`
block in `bots.json`.

**Sizing up** (`packages/minecraft/src/defence/`, written into the state as `defence`):

| Asked of each threat | How it is answered |
|---|---|
| noticed | It is itself coming toward the bot (0.5 blocks a second or more; the bot's own steps do not count), has faced it for a second, has hurt it in the last 10 seconds, or the bot has struck it. Remembered for 5 seconds. |
| canReach | For the nearest two threats within 16 blocks: the pathfinder is asked whether a walking route exists from it to the bot (`locomotion/route-queries.ts`). Everything else, and until an answer arrives: the cheap guess (in line of sight, within 3 blocks of the bot's height). A kind that shoots can reach whenever it has a clear line. |
| escapable | For the same two: is there a walking route to somewhere 16 blocks from the threat that never passes within 3 blocks of it? If not, the bot is cornered. |
| danger | How dangerous this kind has been for this bot, 0 to 1 (learned; 0.5 for a kind never met). |
| beatable | Whether the bot has beaten this kind more often than it has lost to it (learned). |
| stage | `possible` (not in view), `seen` (in view), `coming` (noticed, able to reach, and inside the flight distance; or looming at any distance), `on_it` (within 3 blocks and able to reach, within 6 while the bot is fighting it, or it has just hurt the bot). |

- **Flight distance** = 8 × (0.5 + danger) × (1.3 − 0.6 × bravery) blocks. A kind that has hurt
  the bot badly sets it off from further away; a brave bot lets things closer.
- **The route checks are capped** (`defence/routes.ts`): two threats, each question at most once
  a second, about a millisecond of pathfinding each time the state is read, every answer kept
  until a newer one replaces it. While a journey is being planned they are skipped. The cost of
  sizing up is in the trace (`costMs`, `worstMs`).
- With nothing in view, danger is still **possible** when it is dark, a bad memory is near,
  something worrying was heard, or a threat is close but unseen.
- A state made without the threat sense (tests, `--skill` runs) is sized up by the cheap rules
  alone: the game's hostile mobs, middling danger, always a way out (`cheapDefence`).

**Choosing** (`packages/region-brainstem/src/defence.ts`, pure and game-free), for the most
pressing threat:

| Situation | Mode | Does | Base |
|---|---|---|---|
| Danger possible; or seen but far off, already noticed and out of range, or unable to reach | `wary` | Nothing. Shares `wary`. | |
| Seen, not noticed, within 1.5 flight distances, standing | `freeze` | `freeze`: stop, sneak, watch it | 0.5 |
| The same while on a journey | `avoid` | Nothing: the journey is routed round a circle of the flight distance | |
| Coming, with a way out | `flee` | `flee`, until twice the flight distance away or out of its sight | 0.7 |
| Coming, cornered | `freeze` | `freeze` | 0.6 |
| On it, with a way out, and unarmed, weak or not beatable | `flee` | `flee` (breaking away) | 0.9 |
| On it, and cornered, or armed, healthy and beatable | `fight` | `attack` | 0.9 |

- Weak is health below half, or three or more threats coming at once.
- It is chosen afresh every tick, so a freeze ends the tick its threat notices and closes.
- The reflexes are `defence_freeze`, `defence_flee` and `defence_fight`. The brainstem's gain
  applies as to any soft reflex (flee leans away, fight toward, freeze neither), and a goal's
  `holdBack` can name one of the three, or the skill (`flee`, `attack`) as before.
- **The first tick is not damped.** The gain uses this tick's `threat` when that is above last
  tick's alarm, so a threat that has just started coming is fled at 0.7 × 1.24, not 0.7 × 0.6.

**What it shares** (set by the brainstem region, part g):

| Signal | Meaning | Read by |
|---|---|---|
| `threat` | 0 none, 0.3 possible, 0.5 seen, 0.8 coming, 1 on it | The reflex gain |
| `wary` | 1 while wary or avoiding | Locomotion (caution + 0.15) and the colliculus (threshold − 0.1) |
| `analgesia` | Rises to 0.7 while fleeing or fighting (and while that skill still runs); fades over about 10 seconds after | The medulla: the shared `pain` is multiplied by (1 − analgesia). Soreness does not enlarge a startle meanwhile. |
| `recovering` | 1 after a fight or flight that left health below half, with nothing coming, until health is above three quarters | The `recuperate` reflex (base 0.4): go home if it is within 48 blocks, then stay still |

- Analgesia scales only the shared `pain`. The medulla's readings and urges, the hard reflexes
  and the brainstem's own waking all see the damage as it is.
- **Alarm agrees with defence** (`brain/alarm.ts`): `hostile_appeared` and "a threat is present"
  count only a threat that can reach the bot and is coming or on it. One that cannot reach it,
  or has not noticed it, raises no alarm.

**Learning** (`defence/threat-record.ts`, saved in `data/<bot>/threats.json`, by kind; a player is
`player:<name>`):

| Learned | From |
|---|---|
| danger | Rises with each hurt (by how much health it cost) and with each death; falls a little with every encounter that did no harm, down to 0.1 |
| beatable | Kills minus deaths and bad losses (an encounter that cost half the bot's health without a kill). An ordinary kind starts one ahead; a kind in `innateNeverFight` starts two behind |
| it shoots | Two hurts from more than 4.5 blocks away |
| a new threat | Anything the game does not flag hostile that hurts the bot (an angered animal, a golem). Another player needs two hits, 2 to 60 seconds apart. It is let go again if it stays harmless long enough |

- Only damage the game itself ties to a creature counts (the attacker named in the damage
  packet). A fall during a chase teaches nothing about the chaser.
- A kill is the bot's if the creature died within 5 seconds of the bot striking it.
- `innateThreats` is `"game"` (trust the game's hostile flag), or a list; `innateNeverFight` is
  the usual 13. Empty both and the bot has to learn all of it by being hurt.
- Each change of mind is printed and logged (`learned` in the trace).

**In the log.** The brainstem's trace has `defence`: the mode and why, the flight distance,
whether cornered, each threat as it was sized up, analgesia, recovering, anything learned and
the cost. `pnpm brain-report` adds the time in each mode, freezes that worked and failed, the
distance each flight began at, fights won and lost, cornered events, recoveries and what was
learned. A death is printed with the modes of the 5 seconds before it (`defenceBeforeDeath`).

## The medulla: body upkeep

The medulla (`medulla` region, `packages/region-brainstem/src/medulla-region.ts`; Minecraft
settings in `packages/minecraft/src/brain/medulla.ts`; per bot in `bots.json` under `medulla`)
keeps the body breathing, fed and well without anyone having to think about it, and reports the
body's condition upward. It runs every tick, never calls a model, and keeps running while the bot
sleeps. It is listed right after `reflex`, so every later region sees its signals in the same tick.

**Vital signs.** Shared as signals each tick (`medulla.vitals` in `bots.json` turns this off):

| Signal | 0 means | 1 means | Read from |
|---|---|---|---|
| `air` | full breath | none left | the air bar |
| `hunger` | full | starving | the food bar |
| `reserve` | no reserve | full reserve | saturation (the hidden store that drains before the food bar) |
| `hurt` | full health | dead | health |
| `pain` | none | a third of health lost at once | recent damage, fading over about 10 seconds; a new body starts at 0 |
| `sick` | well | poison or wither | the worst harmful effect (`SICKNESS` table: hunger 0.5, nausea and blindness 0.4, ...) |
| `cold` | warm | frozen through | the freezing meter (powder snow) |
| `tired` | just slept | 3 game days awake | time since the bot last woke from a bed (kept across restarts) |
| `vitals` | (1 is all well) | | one overall number: 1 − (0.8 × the worst sign + 0.2 × their average), over air, hunger, hurt, sick, cold and tired |

A later drives region will read these (`HOOK(drives)` in the region file). Nothing acts on
`cold`, `tired`, `reserve` or `vitals` yet.

**Upkeep, by urgency.** The hard limit stays a hard reflex in the `reflex` region; before it,
the medulla's urges are soft and graded, so the layers above can outvote them:

| Need | Soft urge (medulla) | Hard or last-resort reflex |
|---|---|---|
| Air | `need_air` → `surface`: under water, from 0.3 at air 12 rising to 0.9 at air 7 | `drowning` at air 6 or less (hard, urgency 1) |
| Food | `eat_to_heal` → `eat level:18`, base 0.5: hurt, food under 18 (the level at which the body heals itself), safe food to hand, no hostile in contact. It eats only up to 18, then stops. | `eat_when_starving` at food 6 or less (soft, base 0.9) |
| Sickness | `cure` → `consume item:milk_bucket`, base 0.7: has an effect that a carried cure clears (`CURES` table; `HOOK(learn-cures)`) | none |

- The urges take only one part of the brainstem's gain: a goal's `holdBack`. Naming `need_air`
  (or `surface`) in a goal damps it to 0.3 of its strength, which is holding the breath on
  purpose; `drowning` cannot be held back and takes over at 6. Alarm and bravery do not change
  them: being calm should not make the bot slower to breathe.
- The strongest urge fired is shared as the `urge` signal. The arbiter shrinks the stay bonus of
  the running skill by it (bonus × (1 − urge)): a pressing bodily need is not outvoted by habit.
- An urge that fires while the bot sleeps competes as usual and may wake it (logged as
  `urgeWhileAsleep`).
- No urge fires while a protective reflex's skill is running.

**Foods that are bad to eat** (`packages/minecraft/src/gut.ts`). The bot is born knowing only
what `medulla.innateBadFoods` lists (by default rotten_flesh, spider_eye, poisonous_potato,
pufferfish, chorus_fruit, suspicious_stew). It learns the rest: when a harmful effect starts
within 5 seconds of a meal, that food is blamed; blamed on two separate occasions (30 seconds
apart) it becomes *known bad*, a "danger" memory is recorded, and the list is saved in
`data/<name>/bad-foods.json`. An effect that starts with a hostile within 8 blocks is blamed on
the mob, not the meal, and the only food the bot has ever eaten needs three occasions. `eat`
never picks a known bad food unless the bot is starving with nothing else. The state counts safe
food as `self.foodItems` and bad food as `self.badFoodItems`.

**What the body feels** (state schema 13, added for the medulla): `self.saturation`,
`self.effects` (names of its status effects), `self.freezing` (0 to 1), `self.sinceSleepMinutes`,
`self.healing` (health rose in the last few seconds) and `self.badFoodItems`.

**In the trace** (`medulla`): `vitals` (every sign), `urges` (each fired urge with its base, gain,
urgency and reason), `urgeWhileAsleep`, `errors`. `pnpm brain-report` has a MEDULLA section:
lowest air, food and health, time spent hurt but too hungry to heal, each upkeep reflex and how
often it won, was outvoted or was held back, foods learned as bad, and the vital signs in the 10
seconds before each death.

## The colliculus: where is it, and how sudden

The colliculus (`colliculus` region, `packages/region-brainstem/src/colliculus-region.ts`;
Minecraft settings in `packages/minecraft/src/brain/colliculus.ts`; per bot in `bots.json` under
`colliculus`) turns the bot toward sights and sounds before the rest of the brain has worked out
what they are. It runs every tick, never calls a model, and can be left out with `--regions`
(then nothing turns the head, and `attended` stays null).

**What the eyes and ears deliver** (state schema 15; `encode/perceive.ts`, `senses.ts`):

| Field | What it says |
|---|---|
| `bearing` (on each nearby mob, player and listed block) | Which way it lies from where the head faces: `side` (ahead, left, right, behind) and `angle` in degrees, positive to the left |
| `seen` | Within the field of view (110 degrees either side; 30 is the sharp middle) with nothing opaque in the way. Glass does not block sight. |
| `closing`, `speed` | How fast it is coming nearer by its own movement, and how fast it is moving at all, in blocks per second. Walking up to a still thing does not make it close in. |
| `nearby.sudden` | Things that just changed in view: `appeared`, `started_moving`, `changed` (a block placed, broken, opened or shut within 8 blocks) or `looming` (closing at 4 blocks a second or more, or a projectile heading this way) |
| `nearby.heard` | Sounds in the last 2 seconds: `{ type, bearing, dist, position, loudness }`. It replaces `nearby.loud`. |
| `self.gaze` | What the head is pointed at: the nearest seen thing within 12 degrees of straight ahead (or null), and the compass heading in degrees |

*What can be heard.* On 1.21.11 Mineflayer names sounds wrongly (a cow's hurt arrives as
"coral_block.step"), so nothing is told apart by its sound name. What arrives reliably is used:
`explosion` (with its centre), `thunder` (a lightning bolt appearing), `hurt` (something nearby
hurt), `door` (a door, gate or trapdoor opening or shutting), `shot` (a projectile appearing),
and `sound` (anything else: only where it came from and how loud). Left out: which creature made
a sound, footsteps as such, chest lids and note blocks. As a **stand-in** for footsteps and
growls, a hostile within 8 blocks that is not seen is heard faintly, as `presence`, with its
bearing. That is the one place where what a thing is leaks into the senses, and it is one
function: `unseenHostileHeard` in `encode/perceive.ts`.

**The map.** Everything seen, heard and felt is scored by physical features only:

    salience = suddenness + motion + looming + nearness + loudness + touch   (each weighted)

| Feature | From | Default weight |
|---|---|---|
| suddenness | Just appeared, started moving or changed; a sound that was not there last tick | 0.5 |
| motion | Its speed (full at 4 blocks a second); in the sharp middle of the view it counts 0.6 as much | 0.3 |
| looming | Closing at 4 blocks a second is 0.5, at 8 is 1; a projectile heading this way is 1 | 1 |
| nearness | 1 at the bot, 0 at 16 blocks | 0.25 |
| loudness | How loud a sound is here | 0.6 |
| touch | Whatever hurt the bot in the last 0.7 s, or where a push came from | 3 |

The weights are one table in `bots.json` (`colliculus.weights`). With the default threshold
(0.45) a still thing never wins by being near; something that appears, starts to move, changes,
comes fast or is loud does, and touch beats everything. **What a thing is never enters**: the
arithmetic (`salience.ts`) takes the six features and nothing else, the Minecraft side builds
them from physical facts only (`featuresOf`), and tests fail if a kind, type or hostile field
reaches either.

**Bias from above** (`topDown`). A kind named in the goal's `watchFor` gets 0.4 added. The
threshold falls with alarm (by up to 0.25) and arousal, and rises by 0.3 during a skill that
marks itself `demanding`. Asleep, only touch and sounds of loudness 0.5 or more get through.

**Habituation** (`habituation`). A thing that wins a look and brings nothing (no damage, no
reward) counts 0.8 as much next time, per thing and per kind-at-place (to 8 blocks). What was lost
comes back over about a minute, and at once if the thing does something new (starts moving,
comes fast, changes). The thing just looked at cannot win again for 3 seconds unless it looms or
touches.

**One winner.** The most striking thing above the threshold becomes `attended` in the
workspace. It is held for at least 1 second and let go after 2 unless it is still the most
striking. At most one new look per second.

**What it does about it.**
- *Turns to it*: proposes `look_at` at the winner, urgency 0.35 to 0.7 by salience. Beside a
  skill that leaves the head free the look runs alongside (see "Different body parts at the same
  time"). With nothing running it takes over at full urgency, unless a reflex, a startle or a
  loaded response spoke that tick. Otherwise it competes in the arbiter.
- *Never interrupts* a hard reflex's skill or a demanding skill, except for touch and looming.
- *Wakes the brain*: a new sound or a new sudden thing triggers a tick at once
  (`isSignificantChange`).
- *Looming*: shares a `looming` signal (0 to 1). It raises alarm as it starts (`brain/alarm.ts`,
  0.6 at full), and the defence circuit treats a looming thing as coming whatever its
  distance: the thing itself if that is a threat, else the nearest threat in sight (most likely
  what threw it). There is no list of which mobs shoot. (The defence circuit reads looming from
  the state, so it holds with `colliculus.looming` at 0 too.)
- Shares `orienting` (1 on the tick of a new winner), as the brainstem did.

**When nothing stands out** (`scanning`). Travelling, the head looks where the body is going.
Standing or idling, every 4 seconds it glances toward the compass direction looked at longest
ago, so things behind get seen. The `idle` skill no longer looks around itself.

**Seeing only what is in view** (`fieldOfView`, off by default; `brain/field-of-view.ts`). With
it on, the deciding layers (instinct, planner) are told only about things that are seen, heard
(a sound from where they stand, which is how the footsteps stand-in reports an unseen hostile)
or within 2 blocks. A thing seen lately stays known for 10 seconds after it leaves view, marked
`lastSeen: { msAgo, at }`. The reflexes, the medulla and the colliculus itself still read the
full state. The bot `Wary` in `bots.json` has it on.

**In the trace** (`colliculus`): `threshold`, `top` (the three most striking things, each with
its parts), `winner` (and why), `look` (target, urgency, and `how`: alongside, takes over or
competes), `scan`, `damped` and `worstMs` (the map should stay under 2 ms). `pnpm brain-report`
has a COLLICULUS section: looks per minute, what drew them (sight, sound, touch, looming), the
median time from event to head turned, how the looks ran, what was habituated to, and
"blindsided" events (hurt by something not attended in the 5 seconds before).

## Balance and posture

The vestibular part of the brainstem: the bot's sense of balance, and the adjustments that keep
it steady. It builds on `hold_ground`, `edge_guard` and the checks in `safety.ts`. The code is in
`packages/minecraft/src/posture/` and `encode/balance.ts`; each bot's settings are the `posture`
block in `bots.json` (`brain/posture.ts`).

**The sense of balance** (state schema 14 on, read fresh every tick):

| Field | What it says |
|---|---|
| `self.support` | What holds the bot up: `on` (the block), `kind`, `edges` (how many of the four sides open onto a drop of 3 or more) and `headroom` (open blocks above the head, up to 3) |
| `kind` | `solid`; `loose` (falls when unsupported); `slippery`; `slow`; `liquid`; `climbing` (ladder, vine, scaffolding); `riding`; `none` (in the air) |
| `self.velocity` | Blocks per second on each axis, and `onGround` |
| `self.landing` | Only in the air: how far down the fall ends (`blocks`), onto what (`onto`, a block name or "void"), whether it would cost health (`hurts`), and a better landing within 2 blocks if there is one (`steer`) |
| `self.displaced` | True for one tick when the position jumped more than 8 blocks in one tick, or the dimension changed |
| `self.balance` | One number, 0 to 1 |

Balance is 1 on flat solid ground. By kind: loose 0.7, slippery 0.6, slow 0.8, liquid 0.6 (0.4
if it flows), climbing 0.5, riding 0.8; in the air 0.9 for a hop, 0.4 for a fall that will not
hurt, 0 for one that will. Edges multiply it: one edge (a cliff top) × 0.85, two (a ledge, a
one-wide bridge) × 0.5, three × 0.4, four × 0.3.

**Check before acting** (`posture/check.ts`, rules in `posture/rules.ts`). One function,
`postureCheck`, answers "would this leave me unsteady or hurt?" before every change to blocks or
to where the bot stands: `break_block`, `place_block`, `step`, `jump`, `dig_out`, and the digging
and placing in the pathing rules. It only reads the world. It refuses:

| Change | Refused when | Reason given |
|---|---|---|
| Break | Lava or water touches the block | "would let lava in" |
| Break | It is the block underfoot and the drop is 3 or more, or onto lava, water or something that hurts | "would drop me 3 blocks or more" |
| Break | A loose block above it would come to rest in the body's space, or it is at head height right beside the bot | "would bring the gravel down on me" / "beside my head" |
| Break | It is the ladder or vine being climbed, or the block that hangs from | "would break the ladder I am climbing" |
| Break | The bot stands on a loose block and this is what that block rests on | "would take away what the sand under me rests on" |
| Break (planning a route) | Liquid touches it, or anything loose sits above it | "would bring the gravel above it down" |
| Place | A loose block set where it would fall onto the bot | "would bring the sand down on me" |
| Step, moving jump | Nowhere safe to stand there, one block up or down included | "nothing to stand on there" / "not enough headroom there" |

- The refusal is the primitive's failure reason, so the skill event carries it and the scorebook
  learns the action cost something. For that reason `canRun` no longer hides an unsafe step or
  dig: it can be tried, and fails with the reason.
- **Adjust before refusing.** If the same change would be safe from one step to the side (still
  within reach), the reason says so: "unsafe from here (...): stand to the side". The check never
  moves the bot.
- A solid pillar may be dug down one block at a time (each dig drops the bot one block); only a
  drop of 3 or more is refused. Already buried, digging the block the head is in is allowed.
- It is measured: the slowest check is in the trace (`worstCheckMs`, limit 2 ms). The same
  refusal three times in a minute is logged loudly: the layer above is not learning from it.
- `posture.check: 0` switches it off entirely. That is for experiments only.

**Stance.** While a primitive that leaves the legs free runs (break, place, hit, use, eat, a
look) and the bot is within one block of a drop of 3 or more or of something that hurts, sneak is
held for the length of the action and let go after (`changes.stance`). It is done once, in the
shared primitive wrapper, from each primitive's declared parts. It lets go the moment the action
is stopped, so a hard reflex is never slowed by sneaking. Not held: while travelling, in the air
or in water, or for `open`, `use_on` and `craft` (marked `standing`), because the game does not
open a block for a sneaking player.

**Unsteady.** The brainstem shares `unsteady` = (1 − balance) × `posture.unsteady`. Locomotion's
caution adds 0.7 × unsteady, so on a ledge or a one-wide bridge the bot uses the careful rules
and sneaks whatever its focus, and even when frightened. A hook for the focus dial to read it is
marked `HOOK(focus-unsteady)` in `brain/posture.ts`; it is not wired.

**Falling.** `falling_right` (above) runs `air_steer`. The air gives little push, and a landing
can be one block wide, so it pushes only while the body would otherwise come down short. The
balance sense never offers lava, fire, the void or anything known to hurt as a landing, nor one
behind a wall. Every fall of 1.5 blocks or more is noted on landing (blocks, damage, whether it
steered) in the trace and, when `air_steer` ran, in its skill event's `changes`. A fall that hurt
marks the spot where the bot left the ground as one to avoid for 5 minutes, the same way a spot
that hurt to touch is.

**Learning how surfaces behave** (`posture/surfaces.ts`, `posture/learn.ts`; saved in
`data/<name>/surfaces.json`):
- *Loose.* The bot is born knowing only `posture.innateLoose` (by default sand, red sand, gravel
  and the concrete powders). When it breaks a block and the snapshot shows the solid block above
  it left its place (`changes.cameDown`), and that block is found where the dug block was or just
  below a moment later, that block type's count goes up. Twice, in separate incidents, makes it
  known loose. Nothing is learned with another player within 8 blocks or an explosion in the
  last 3 seconds.
- *Slippery and slow* have no starting list. On a straight, level stretch of a walked journey
  the pace is compared with what the legs should manage (from `gait.ts`, weighed by how much of
  the stretch was sprinted): under 0.7 of it is slow, over 1.3 slippery. Sliding more than a
  block after the legs stop also counts as slippery. Three sightings make it known.
- The balance sense and the check ask what is known through a per-bot lookup
  (`setKnownSurfaces`), the way `pain.ts` feeds `safety.ts`. Each thing learned is logged.

**Being moved somewhere else.** When `displaced` is set: the journey stops and the locomotion
controller forgets its stuck and avoid marks (`locomotion.forget()`); noradrenaline raises
`replan` so the planner looks again; the senses forget what they were tracking, so everything in
view appears afresh and the colliculus can turn to it;
and `hold_ground` does not. A death and respawn far away goes the same way.

**In the trace** (`brainstem.posture`): `support`, `balance`, `landing` while falling,
`refusals` (action, place, reason), `repeated`, `stance`, `falls`, `learned`, `displaced` and
`worstCheckMs`. `pnpm brain-report` has a POSTURE section: actions refused and why, time spent
unsteady, stance holds, falls (height, damage, whether steering helped), displacements, surfaces
learned and the slowest check.

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
  respects `protected.ts` (no breaking the base) and the posture check (no stepping into lava or
  off a drop, no digging that would drop or bury the bot: see Balance and posture). It lets go of keys and items when it ends or is stopped. `break_block` is the one long
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
- **Different body parts at the same time.** A skill names the parts it uses (`parts`); one that
  names none uses all three. One head-only primitive (a look) may run alongside a running skill:
  always beside one that uses no part at all (`idle`, whose `parts` is the empty list), and with
  `--same-time` (off by default) beside any that leaves the head free: walking (`go_to`,
  `return_to_base`, `flee`) and eating. The main action always wins. While walking, the
  look is held for a second: the head turns to the target and the legs keep their direction by
  pressing other keys, so the bot looks one way and walks another. `gaze.ts` decides where to
  look and which keys that takes; the locomotion controller knows whether the bot is walking
  plainly and which way, and presses them. The colliculus's look uses this.
- **Learned skills** are chains of primitives kept as data, never code. The runner
  (`packages/core/src/chain.ts`) runs the steps in order, stops at the first failure, and returns
  each step's result and changes. Any chain in `data/<bot>/learned-skills.json`
  (`[{ "name", "description", "steps": [{ "primitive", "target" }] }]`) is loaded at start as a
  skill. None ship with the bot.

Reflexes can always use primitives. They are off Jev's menu unless the bot runs with
`--primitives`. `escape_hazard` and `surface` are reflex-only and never on the menu.

If the bot dies soon after a soft defence reflex was held back or outvoted with a threat coming
or on it, the run prints `!! DIED WITH DEFENCE OVERRULED` with the gain and what won, and the
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
- caution = 0.3 + 0.3 × focus, and 0 while alarm is above 0.6 (a frightened bot does not tiptoe),
  plus 0.7 × unsteady whatever the alarm (see Balance and posture)

Speed sets the gait: below 0.3 a walk; up to 0.7 a jog (sprinting only once a stretch has proved
straight); above 0.7 a sprint whenever the game allows. The bot never sprints at 6 food or less
(the game's rule). Following something, it sprints to catch up when it falls behind. Caution above
0.6 uses the careful rules and sneaks within one block of a drop of 3 or more (only with its
feet on the ground: sneaking on a ladder or in water would hold it in place). Each bot's
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
| Change what the bot is born knowing hurts | `bots.json`: `reflexes.innateHurts` (an empty list makes it learn everything; `in_lava_or_fire` still works, since it reads the body, not the list) |
| Add a withdrawal (a protective reflex) | `packages/minecraft/src/brain/protective-reflexes.ts` (write the rule, add it to `protectiveReflexes`, give it a strength in `ReflexSettings`); its skill, if new, goes in `packages/minecraft/src/skills/` as `reflexOnly` and into `REFLEX_SKILLS` |
| Change how many incidents it takes to learn that something hurts | `INCIDENTS_TO_LEARN` in `packages/minecraft/src/pain.ts` |
| Change which kinds of damage call for pulling away | `NOT_A_PLACE` in `protective-reflexes.ts` |
| Change what the bot is born knowing is bad to eat | `bots.json`: `medulla.innateBadFoods` (an empty list makes it learn every one by falling ill) |
| Add an upkeep urge | `packages/minecraft/src/brain/medulla.ts` (write the rule with `urge(...)`, add it to `medullaUrges` and `MEDULLA_URGES`, give it a strength in `MedullaSettings`) |
| Add a vital sign | `Vitals` and a signal name in `packages/region-brainstem/src/` (`medulla-region.ts`, `signals.ts`), and its reading in `playerVitals` in `packages/minecraft/src/brain/medulla.ts` |
| Add a cure, or change how sick an effect makes the bot | `CURES` and `SICKNESS` in `packages/minecraft/src/brain/medulla.ts` |
| Change how many meals it takes to learn a food is bad | `MEALS_TO_LEARN` in `packages/minecraft/src/gut.ts` |
| Change what makes something striking | `bots.json`: `colliculus.weights` (one bot), or `DEFAULT_COLLICULUS` in `packages/region-brainstem/src/colliculus-settings.ts`; how each feature is measured is `featuresOf` in `packages/minecraft/src/brain/colliculus.ts` |
| Make a bot jumpier or calmer | `bots.json`: `colliculus.threshold` (low: jumpy; high: unbothered) |
| Add a sound the bot can hear | `packages/minecraft/src/senses.ts`: listen for the event, call `hear("<type>", position)`, and give it a loudness in `LOUD` |
| Replace the stand-in for footsteps | `unseenHostileHeard` in `packages/minecraft/src/encode/perceive.ts` |
| Make the bot know only what it sees | `bots.json`: `colliculus.fieldOfView: 1` |
| Add a reason to refuse an action | `packages/minecraft/src/posture/rules.ts` (`breakReason`, `placeReason` or `moveReason`: return a plain sentence, or null) |
| Make something new ask the check | Call `postureCheck(bot, "<action>", { kind: "break" \| "place" \| "move", ... })` before acting, and return its reason as the failure |
| Change what the bot is born knowing about surfaces | `bots.json`: `posture.innateLoose` (an empty list makes it learn every loose block by digging under it) |
| Change how unsteady affects caution | `CAUTION_FROM_UNSTEADY` in `packages/minecraft/src/brain/locomotion.ts`; a bot's own strength is `posture.unsteady` |
| Change how steady each kind of footing is | `STEADY` and `BY_EDGES` in `packages/minecraft/src/encode/balance.ts` |
| Change how many sightings it takes to learn a surface | `SIGHTINGS_TO_LEARN` in `packages/minecraft/src/posture/surfaces.ts` |
| Change which defence goes with which situation | `chooseDefence` in `packages/region-brainstem/src/defence.ts` (and its base urgencies, `BASE`) |
| Change the flight distance | `flightDistance` in the same file; a bot's own strength is `defence.flightDistance`, and its bravery is `brainstem.bravery` |
| Change what counts as "noticed", or where a stage begins | `sizeUp` in `packages/minecraft/src/defence/size-up.ts` |
| Change what the bot is born knowing about threats | `bots.json`: `defence.innateThreats` (`"game"`, or a list; empty: it learns every threat by being hurt) and `defence.innateNeverFight` |
| Change how danger is learned | `packages/minecraft/src/defence/threat-record.ts` (the steps, what a bad loss is, how many hits from afar make a shooter) |
| Change how often, or for how many threats, routes are checked | `packages/minecraft/src/defence/routes.ts`; what is asked of the pathfinder is `packages/minecraft/src/locomotion/route-queries.ts` |
| Add a defence | A new mode in `chooseDefence`, a rule in `packages/minecraft/src/brain/defence.ts`, and a skill for it |
| Turn part of the defence circuit off | `bots.json`: set its strength in `defence` to 0 (`freeze`, `avoid`, `cornered`, `flightDistance`, `learnThreats`, `analgesia`, `recuperate`, `reachCheck`) |
| Add a hard reflex | `packages/minecraft/src/brain/reflexes.ts` (write a rule with `"hard"`, add it to `playerReflexes`). Keep these to what saves the bot's life: nothing can overrule them. |
| Add a soft reflex | Same file, with `"soft"` and a base urgency. (The defence reflexes are the defence circuit's: see the rows above.) If its skill moves toward or away from a threat, add the skill to `LEANINGS` in `brainstem.ts`. |
| Add something that startles | `packages/minecraft/src/brain/startle.ts` (write a detector that returns an intensity from 0 to 1 and a source, add it to `createPlayerStartles`) |
| Make a bot jumpier | `bots.json`: `brainstem.startle` (0 never startles, 1 normal, up to 1.5 jumpy) |
| Change how fast it gets used to things | `HABITUATION_STEP` in `packages/region-brainstem/src/startle.ts` (startle) or `STEP` in `habituation.ts` (looks); a bot's own strength is `brainstem.habituation` |
| Change what makes a startle bigger or smaller | `POTENTIATES` and `LIMITS` in `packages/region-brainstem/src/startle.ts`; a bot's strengths are `brainstem.potentiation`, `warning`, `selfCaused` |
| Prepare an action to go off when startled | In the goal: `ifThen: [{ when, skill, onStartle: true }]` |
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
pnpm start -- --regions reflex,brainstem --manual    # reflexes only; type "do <skill> [target]" to drive the body by hand
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
