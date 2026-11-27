# How the Brain Works

The bot's decisions come from **regions** (brain parts). Regions never call each other. They
share one **workspace** (shared memory), and the **basal ganglia** (the arbiter) pick which
proposals go ahead.

```
Workspace (state · views for the deciders · goal · signals · attended · needs · place · recent events)
   ▲ read/write            ▲ read/write          ▲ read/write
Spinal cord and brainstem  Instinct (layer 1)    Prefrontal cortex (layer 2)
(layer 0, every tick)      Jev, every tick       LLM, every 15 s in the background
 Reflex: hard and soft     │ proposals           │ goals only, never proposals;
   rules                   │                     │ a goal can load responses (ifThen)
 Medulla: vital signs and  │                     │ and hold reflexes back (holdBack)
   the urges of upkeep     │                     │
 Hypothalamus: the needs,  │                     │
   read once and shared    │                     │
 Brainstem: reflex gains,  │                     │
   startle, loaded         │   ◄── called less often when drowsy, ──►
   responses               │       not at all while asleep
 Reticular: arousal, bed-
   time, waking, the gate
 Colliculus: the map of
   where things are; turns
   the head (look_at)
   │ proposals             │
   ▼                       ▼
Basal ganglia: one contest for the body and one for the head. In each,
         score = (urgency + the go terms) × the no-go terms; every rule about who wins is a named term;
         a request of the body holds back the deciders' rivals; a near tie is waited on for a moment;
         a well-worn choice becomes a habit (the striatum), and Jev is asked less;
         a full-urgency proposal (a hard reflex, a startle) always wins; ties go to the faster layer
   ▼
Skill executor → skills → primitives (every movement) and locomotion (all travel) → Minecraft
```

Alongside these run layer-0 regions that propose little or nothing but shape the rest:
`hypothalamus` (the body's needs), `dopamine`, `serotonin`, `noradrenaline`, `acetylcholine` (the
neuromodulators), `hippocampus` (memory and the map), `amygdala` (what predicts harm and good) and `cerebellum`
(what each movement comes to; in shadow so far).

Regions that run every tick start in the order they are listed in `apps/run-bot/src/brain.ts`.
All but instinct finish at once, so each sees the signals set by the ones listed before it in the
same tick; a signal from a region listed later is read one tick late.

## Words used in the code

| Word | Meaning |
|---|---|
| Region | One brain part. Has a `name`, a `layer` (speed rank) and `everyMs` (0 = every tick). |
| Proposal | A region's suggestion: an action, an `urgency` from 0 to 1, and a `reason`. |
| Workspace | Shared memory. Holds the world state, the views of it built for the deciding layers, the current goal, signals, the one thing being attended to, and recent skill events. |
| View | The state as one deciding layer is told it (`ws.view(reader)`): a selection of the full state, built each tick by the thalamus for instinct and for the planner. With no thalamus it is the full state. Every other region reads `ws.state`. |
| Attended | The one thing the bot is attending to right now: `{ id, kind, bearing, salience, since, angle, elevation, field, lean }`, or null. Set by the colliculus (`ws.setAttended`); logged each tick. |
| Needs | The body's needs as the hypothalamus read them this tick (`ws.needs`): each need's level, how hard it presses, where it is heading and its target; the need wanted most; the body clock; stress. Null with no hypothalamus. |
| Place | Where the bot is on its own map (`ws.place`): `{ cell, area, familiarity }`, or null with no map. Set by the hippocampus. |
| Cue, association | A cue is a name for something around (`kind:zombie`, `block:cactus`, `area:a3`). An association is what the amygdala has learned of one cue: how much harm and good it predicts, how sure, and where it is safe. |
| Fear, appeal, matters | Three signals from the amygdala, each 0 to 1: the strongest harm (`fear`) and the strongest good (`appeal`) that the cues here now predict, and the larger of the two (`matters`). The thing attended to and each threat sized up also carry `harm`: what that one thing predicts. |
| Cell, area | A cell is one cube of the world on the hippocampus's map. An area is a group of cells that connect with no door, climb or change of light between them (a cave, a house, a field). |
| Signal | A named level from 0 to 1 that one region shares with the others (e.g. `in_danger`, `dopamine`, `patience`, `alarm`). |
| Goal | What the prefrontal cortex wants the bot working toward: text, steps (and how many are done), what to carry (`wants`), things to watch for (`watchFor`), responses loaded in advance (`ifThen`) and reflexes to hold back (`holdBack`). Instinct reads it each tick. |
| Hard reflex | A life-saving rule. Always urgency 1; nothing learned, felt or planned can stop it. |
| Soft reflex | A tunable rule. Its base urgency is multiplied by a gain and capped at 0.95, so it competes in the arbiter. |
| Primitive | One of the body's built-in movements (`look_at`, `step`, `break_block`, ...): small, stoppable, and reporting what it changed. Skills marked `primitive: true`. The only code that moves the bot's body. |
| Changes | What a skill run changed (`moved`, `gained`, `targetBlock`, ...), carried on the skill event that ends it. |
| Movement, model | A movement is one thing the body did, as it ended: a primitive, a journey, one stretch of a journey over one kind of ground, or a whole skill. A model is what the cerebellum has learned that one movement comes to in one situation. |
| Arbiter | Picks the winning proposals: the basal ganglia. |
| Term | One named rule about who wins: it adds to a candidate's score (go), scales it (no-go) or removes the candidate (gate). |
| Channel | A part of the body with a contest of its own: `body` (legs and hands) and `head`. |
| Habit | How well-worn a choice is in a situation, 0 to 1. Above 0.8 the striatum proposes it without Jev being asked. |

All of these types live in one file: `packages/contracts/src/brain.ts`.

## Where things are

| Package | Job |
|---|---|
| `contracts` | Shared types only. |
| `core` | The brain loop (runs regions, asks the arbiter, acts, logs), workspace, skill executor. |
| `basal-ganglia` | The arbiter in use: the terms (`src/terms/`), the channels, waiting on a near tie, and the striatum (habits). Game-free. |
| `arbiter` | The older pickers, kept for comparison: `value-weighted` and `highest-urgency`. |
| `region-reflex` | Runs a list of rules, hard and soft, and logs each fired rule's kind, base urgency, gain and final urgency. |
| `region-brainstem` | Supplies the reflex gains, the defence circuit's choice of defence, a `brainstem` region (startle, loaded responses, the defence signals), a `reticular` region (arousal, bedtime, waking and the graded gate), a `medulla` region (vital signs and the graded urges of upkeep) and a `colliculus` region (the map of where things are and how sudden; it turns the head). |
| `region-thalamus` | The gateway to the deciding layers: builds a view of the state for instinct and for the planner (`ws.view(reader)`), by channel, priority and a size limit. Game-free; the Minecraft side says what the channels are. |
| `region-hypothalamus` | Owns the body's needs: reads each once a tick and shares the reading (`ws.needs`), with moving targets, looking ahead, the body clock, slow stress and the top drive. Game-free. |
| `region-amygdala` | Learns what predicts harm and what predicts good, by surprise, by place and by likeness, and shares `fear`, `appeal` and `matters`. Game-free; the Minecraft side offers the cues and the outcomes. |
| `region-cerebellum` | Learns what each of the body's movements comes to (how long, how far, which changes), from the signed error between prediction and result. Game-free; the Minecraft side says what a movement is, its situation and its measures. It shares `mismatch`, and its numbers are read by the journeys, the give-up clock, the primitives' expectations and the defence, each by a strength in `cerebellum` (bots.json). |
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
- Eating when starving is an upkeep urge now (the medulla, below), so that it can wake a sleeper.

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
is kept per bot in `data/<name>/hurts.json`. That is the older rule, used with
`amygdala.readers.blocks` at 0. Otherwise which blocks hurt is the amygdala's word (see "The
amygdala"), with the inborn list kept fixed.

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
- **Arousal gate.** Moved to the reticular formation (below).
- **Arousal and startle.** A drowsy body startles a little less (down to × 0.8 at arousal 0.35
  or under); an over-aroused one a little more (up to × 1.1 above 0.9). Alarm already enlarges
  a startle, so the upper side is small. Strength: `brainstem.arousalStartle`.
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
- With nothing in view, danger is still **possible** when it is dark, the place or a sign
  happening now is feared (the amygdala's word; with `amygdala.readers.wary` at 0, a bad memory
  near), something worrying was heard, or a threat is close but unseen.
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
`player:<name>`). With `amygdala.readers.defence` above 0, a kind's danger and whether it is a
learned threat come from the amygdala instead (see "The amygdala"); beatable, shoots and kills
stay here:

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

## The reticular formation: how awake

One continuous arousal level says how awake the bot is. It decides when the bot sleeps and
wakes, and how hard the deciding layers work. The `reticular` region
(`packages/region-brainstem/src/reticular-region.ts`; the maths is `arousal.ts`, pure and
game-free) runs every tick, after the brainstem, so it hears this tick's threat and startle.
The player's side (what counts as night, safe, idle, in bed; which skill is bed) is
`packages/minecraft/src/brain/reticular.ts`. Each bot's settings are the `arousal` block in
`bots.json`. Left out (`--regions`), arousal reads as 0.5 everywhere and nothing is ever paused.

**The two drives.**

| Drive | Made from |
|---|---|
| Wake, 0 to 1 | The largest of alarm, `threat`, `startle`, `pain` and the medulla's `urge`; plus 0.15 for something that has just drawn the attention and 0.15 for a demanding skill under way |
| Sleep, 0 to 1 | `sleepy` × how restful the moment is. Restful: a quarter each for night, safe, nothing to do and recovering, and a quarter more for safe and idle together |

- Target = resting (0.5) + 0.5 × wake − 0.45 × sleep, kept within 0 to 1. Asleep, the target is
  low inside the asleep band, lower the deeper the sleep.
- Arousal moves toward the target fast going up (about a second) and slowly coming down (about 20).

**The bands** (for the trace and the report):

| Band | Arousal |
|---|---|
| asleep | under 0.15 |
| drowsy | under 0.35 |
| awake | 0.35 to 0.7 |
| alert | over 0.7 |
| over-aroused | over 0.9 |

The band changes at most once in 3 seconds, except upward for danger.

**What it shares.**

| Signal | 0 means | 1 means |
|---|---|---|
| `arousal` | deep sleep | over-aroused (0.5 is quietly awake) |
| `sleepy` | no sleep pressure | as sleepy as it gets |
| `depth` | awake | (0.9 is deep sleep, 0.4 light) |
| `upper_rate` | the deciding layers are not called | they are called as usual |
| `upper_paused` | the rate is above 0 | the rate is 0 (asleep) |
| `quiet` | | drowsy, safe and still for a minute |
| `frazzled` | | over-aroused |

**Sleepy and bedtime** (`bedtime.ts`).

- `sleepy` = the medulla's `tired` + 0.35 at night, − 0.2 by day; 0 while a threat is coming or
  on the bot. A bot awake since morning is about 0.68 at night; one that has just slept, 0.35.
- Above 0.5, with nothing pressing, it proposes the bed skill (`sleep`) at 0.2, rising to 0.6
  fully sleepy. Soft: Jev and the planner can still choose sleep, or outvote it.
- **Flip-flop.** Once heading to bed it keeps on until `sleepy` falls below 0.3 or the wake
  drive rises above 0.5. Once up, it does not head back until `sleepy` is above 0.5 again.
- Never with a threat seen or worse, or a risky skill under way.
- **After a refusal** (the sleep skill failed: too close to dawn, monsters near, no way to the
  bed) it proposes nothing for 30 seconds. The sleep skill itself also refuses to start for 30
  seconds after the game says no, so Jev cannot retry it either.
- **No bed in reach** (further than 64 blocks, or it is day): `sleepy` is still shared, nothing
  is proposed, and the trace says why (`bedtime.delayed`).

**Asleep.**

- `depth` is shared: 0.9 for the first third of the night, easing to 0.4 by morning.
- **Waking is by strength, not by a list.** An event wakes the bot when its strength is above
  depth × 0.6 (× `wakeThreshold` ÷ 0.5). Strength is the largest of startle, pain, alarm, threat
  and urge. So early in the night it takes 0.54; near morning 0.24.
- A hurt, a full startle or a hard reflex always wakes, on the same tick, whatever the depth.
- A starving bot is woken by its urge (0.9) before starving hurts.
- **A cue is not a wake event.** Asleep, focus's cue pulse and dopamine's cues propose nothing.
- With the deciding layers silent, the region speaks for staying asleep at 0.3 + 0.4 × depth:
  a light sleeper is easier to rouse than a deep one.
- **Sleep inertia.** After a calm waking arousal starts at 0.25 and takes about 10 seconds to
  climb back. Woken by danger, it jumps straight up.
- Each waking is logged with what woke it, its strength, the depth, and how long the bot slept.
  "Waking" means the gate opens and nothing speaks for sleep any more; whether the bot gets out
  of bed is up to what is proposed next. If nothing is, it sleeps on.

**The graded gate.** `upper_rate` (0 to 1) says how often the deciding layers may be called:
0 asleep, about 0.3 drowsy (arousal 0.35), 1 once awake, smooth in between. `upper_paused` is
"the rate is 0", as before.

- Instinct is called no more often than 500 ms ÷ rate; the planner no more often than 15 s ÷ rate
  (`createRateGate`, wired in `apps/run-bot/src/brain.ts`).
- A wake drive above 0.5 sets the rate to 1 at once. An alarm interrupt (instinct) or a call for
  a new plan (the planner) is never held.
- Reflexes, the medulla, the neuromodulators and memory are never gated.
- The give-up clock keeps restarting while asleep.
- `pnpm brain-report` prints the calls saved, asleep and drowsy.

**What reads arousal.**

| Reader | Effect | Strength |
|---|---|---|
| Colliculus | The threshold falls as arousal rises (as before) | `colliculus.topDown` |
| Startle | × 0.8 when drowsy, × 1.1 when over-aroused | `brainstem.arousalStartle` |
| Locomotion | Speed − 0.15 when fully drowsy; nothing above the resting level | `locomotion.slowWhenDrowsy` |
| Memory | `quiet` (drowsy, safe and still for 60 seconds) counts as rest: memories are consolidated, as in sleep | `arousal.quietRest` |
| Instinct | `frazzled` (over-aroused, above 0.9): at most 2 options are proposed, none under 0.2 | `arousal.frazzled` |
| Planner | While `frazzled` it is told in one line to keep the plan short and put safety first | `arousal.frazzled` |

**Arousal and alarm overlap.** Alarm is the largest part of the wake drive, so high arousal
mostly is high alarm. Where a part already reads alarm (reflex gains, locomotion's speed-up and
its "no tiptoeing when frightened", the colliculus's threshold, startle potentiation, the tick
rate), arousal adds nothing on the upper side. Arousal is used alone only on the drowsy side
(startle, speed, the gate, quiet rest), and for `frazzled`.

**In the log.** The region's trace has, each tick: `wake` (value and what set it), `sleep`
(value, sleepy, restful), `target`, `arousal`, `band`, `sleepy`, `rate`, and when they apply
`asleep`, `depth`, `groggy`, `waking`, `bedtime` (proposed, or what delayed it), `quiet`,
`frazzled`.

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
| `tired` | just slept | 3 game days awake | time since the bot last woke from a real sleep, 100 game ticks or more in bed (kept across restarts) |
| `vitals` | (1 is all well) | | one overall number: 1 − (0.8 × the worst sign + 0.2 × their average), over air, hunger, hurt, sick, cold and tired |

The hypothalamus reads these: `cold`, `tired` and `sick` are needs (warmth, rest, illness),
`reserve` tells it hunger is coming, and `vitals` loads stress. `tired` also feeds the reticular
formation's `sleepy`.

**Upkeep, by urgency.** The hard limit stays a hard reflex in the `reflex` region; before it,
the medulla's urges are soft and graded, so the layers above can outvote them:

| Need | Soft urge (medulla) | Hard or last-resort reflex |
|---|---|---|
| Air | `need_air` → `surface`: under water, from 0.3 at air 12 rising to 0.9 at air 7 | `drowning` at air 6 or less (hard, urgency 1) |
| Food | `eat_to_heal` → `eat level:18`, base 0.5: hurt, food under 18 (the level at which the body heals itself), safe food to hand, no hostile in contact. It eats only up to 18, then stops. | `eat_when_starving` → `eat`, base 0.9, at food 6 or less: also an urge of the medulla (it was a reflex), so it counts toward `urge` and wakes a sleeper before starving hurts. Not with a threat on the bot; a food known to be bad is eaten only now, and only when there is nothing else. |
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
the mob, not the meal, and the only food the bot has ever eaten needs three occasions. (That is
the older rule, used with `amygdala.readers.foods` at 0. Otherwise which foods are bad is the
amygdala's word.) `eat`
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

## The hypothalamus: what the body needs

The hypothalamus (`hypothalamus` region, `packages/region-hypothalamus/`; the player's needs in
`packages/minecraft/src/brain/needs.ts`; per bot in `bots.json` under `drives`) is the one place
that owns the body's needs. Every tick it reads each need once and shares the reading as the
workspace's `needs`. It is listed straight after the medulla, so every later region uses this
tick's reading. It proposes no action and never calls a model: it says how things stand and what
that is worth, and dopamine's wants, the medulla's urges and the planner do the proposing.

**A need** is a level from 0 (met) to 1 (desperate) read from the state or from one of the
medulla's signals, with a `rank` (a need of a higher rank silences the lower ones while it
presses at all: danger comes first) and a weight class (`danger` 2, `body` 1, `provision` 0.25:
how much it darkens the outlook when unmet; the numbers are `drives.weights` in `bots.json`).

| Need | Kind | Level | Notes |
|---|---|---|---|
| `food_bar` | hunger | how empty the food bar is | Known to be coming once the hidden reserve is gone |
| `health` | safety | health lost | |
| `danger` | safety | how close the nearest threat that could harm the bot is | Rank 1, weight class `danger` |
| `night_light` | safety | at night, how dark it is here | With the clock on it comes on over dusk |
| `tools` | having_enough | the share of tool kinds it has none of | Provision |
| `food_stock` | having_enough | how far short of enough food it is (base 8) | Provision; kept for `food_bar` |
| `torches` | having_enough | how far short of enough torches (base 16) | Provision; kept for `night_light` |
| `warmth` | warmth | the medulla's `cold` | `drives.body` |
| `rest` | rest | the medulla's `tired` | `drives.body`; a need of the night |
| `illness` | illness | the medulla's `sick` | `drives.body` |
| `novelty` (boredom) | curiosity | kept in dopamine's novelty memory | Only dopamine is paid for it; the hypothalamus tunes how hard it presses |

**What it works out each tick**, each part with its own strength in `drives` (at 0 the part is
off and the bot behaves as if it did not exist):

| Part | What it does | Strength | File |
|---|---|---|---|
| Body readings | `cold`, `tired` and `sick` count as needs, read from the medulla's signals in steps of 0.05. `tired` only restarts after a real sleep (100 game ticks in bed). With rest a need, a night's sleep pays by how tired the bot was, and the flat `slept_through_night` reward is dropped. | `body` | `needs.ts` (`bodyNeeds`) |
| Moving targets | Enough is base × adjustments (`TARGET_ADJUSTMENTS`: food × 1.5 when hurt, food and torches up to × 1.5 as night comes, torches × 1.5 underground). | `targets` | `targets.ts` |
| Learned targets | Running out of a thing while the need it is kept for presses above 0.5 (no food carried with the food bar under half, no torch in the dark) raises enough by a quarter, up to 3 × the base. It drifts back with a time constant of three game days. Saved in `data/<bot>/targets.json`; each change is in the trace (`learned`). | `learnTargets` | `targets.ts` |
| Looking ahead | Each need's level a minute on, at the rate of the last minute, or what is known to be coming if that is more (hunger once the reserve is gone). A need presses at the larger of its level and 0.7 × that projection. While the running skill is one dopamine expects to relieve it, it presses a third less. Rewards are always paid on the real level. | `lookAhead` | `ahead.ts` |
| Body clock | One phase for the day (0 at sunrise), `dusk` rising over the last three minutes of the day and `dawn` over the last three of the night. A need of the night (rest) presses half as hard by day; one of the day (stocking up, curiosity) half as hard by night. | `clock` | `clock.ts` |
| Stress | Rises over about a minute toward the largest of alarm, how close a threat is, `pain` and poor `vitals`, and fades over about five. Under stress the needs that can wait (stocking up, curiosity) press down to half. | `stress` | `stress.ts` |
| Competition | Danger silences the rest, as before. The top drive is the need pressing hardest by its weight, and is sticky (a rival must beat it by 0.1, or it must fall under 0.2). A need of the body (not safety, not a provision) above 0.8 is desperate. The top drive pressing with nothing learned that relieves it is unmet. | `desperate`, `unmet` | `compete.ts` |

**What it shares, and who reads it.**

| Shared | Meaning | Read by |
|---|---|---|
| `ws.needs.readings` | Every need: `level`, `pressing`, `rank`, `weight`, and `projected` and `target` where they apply | Dopamine (rewards on `level`, wants on `pressing`), serotonin (the outlook), noradrenaline (alarm, search), the arbiter (the hold), the progress check |
| `ws.needs.top` | The top drive: name, kind, score, since when | The planner's line; a change of kind asks for a new plan (at most once in 30 s, never while danger presses) (`drives.tellPlanner`) |
| `ws.needs.clock` | Phase, night, how far through the night, `dusk`, `dawn` | The reticular formation (`sleepy` comes on over dusk and lifts over dawn), targets, `night_light`, the planner's line |
| `stress` (signal) | Slow stress, 0 to 1 | Serotonin: counts in the outlook like a need, by what the danger of the moment does not already account for (`patience.stress`). The reticular formation: less sleepy, by what is not tiredness itself (`arousal.stress`). The planner's line. |
| `desperate` (signal) | How far past 0.8 the worst need of the body is | The arbiter: the brake on costly skills is up to half weaker. The defence circuit: the flight distance is up to a quarter shorter. Hard reflexes, the medulla's hard rules and `last_stand` do not read it. |
| `unmet` (signal) | The top drive's score while nothing learned relieves it | Noradrenaline's search (an input beside `getting_nowhere`) |

With `hypothalamus` left out (`--regions`), each reader works the plain reading out from the
state (`needsNow` in `needs.ts`): the seven needs the bot is born with at their base targets,
with none of the parts above. With every strength at 0 the result is the same.

**Stress and alarm.** Alarm is fast and follows the vital needs; stress is slow and fed by
alarm among other things. They are kept apart: stress takes the largest of its sources, not
their sum; it does not raise reflex gains, lower a defence threshold or wake a sleeper; and
where both reach the same thing (the outlook, sleep) only the part of stress the fast signal
does not already carry is counted.

**Trace.** Each tick: for every need its level, pressing, projection, target and why it was
silenced or eased; the top drive; stress with its load and what set it; the clock; anything
learned; and the slowest tick so far (it must stay under 2 ms: `slow` is logged on any tick that
does not). `pnpm brain-report` adds the time each drive was on top, the time each need spent
above 0.5, how often looking ahead acted first, stress by minute, and targets learned.
`pnpm drives-check` runs the live scenes; `pnpm replay-needs` replays recorded runs through the
regions that read the needs and checks they say what they said.

## The thalamus: what the deciding layers are told

The brain keeps the **full state** for its own work: the reflexes, the medulla, the colliculus,
the defence circuit, the hypothalamus, the dials and memory all read `ws.state`. The thalamus
(`thalamus` region, `packages/region-thalamus`; Minecraft side in
`packages/minecraft/src/brain/thalamus.ts` and `thalamus-channels.ts`; per bot in `bots.json`
under `thalamus`) builds a separate **view** of it for each deciding layer, instinct and the
planner, and stores it in the workspace. They read `ws.view("instinct")` and
`ws.view("prefrontal")`. A view only selects and shortens: it never changes a value or makes
one up. The thalamus runs every tick, never calls a model, and is listed just before instinct
so that instinct reads this tick's view (the planner, which starts before the tick's other
regions, reads a view at most one tick old). Left out with `--regions`, both read the full state.

The encoder no longer cuts the state by the attention budget. It keeps the nearest 32 of each
kind of nearby thing (`NEARBY_CAP`), a safety cap against a crowd, and the whole brain reads
those.

**With the gate off** (`gate: 0`) a view is the nearest few of each kind of thing (the attention
budget: 5 to 15 by focus, 10 at rest), then the field of view. This is what the deciders were
told before there was a thalamus.

**The field of view** (`fieldOfView`, off by default; `brain/field-of-view.ts`). With it on, the
deciding layers are told only about things that are seen, heard (a sound from where they
stand, which is how the footsteps stand-in reports an unseen hostile) or within 2 blocks. A
thing seen lately stays known for 10 seconds after it leaves view, marked
`lastSeen: { msAgo, at }`. The bot `Wary` in `bots.json` has it on.

**Channels and forms** (`thalamus-channels.ts`). The Minecraft side splits the state into
channels, each a list of items:

| Channel | Its items | Base |
|---|---|---|
| `threats` | Mobs that are hostile or that the defence circuit has sized up | 0.45 |
| `players` | Other players | 0.35 |
| `changes` | Things that just changed and are on no list: a projectile, a block placed or broken | 0.35 |
| `things` | Chests, ripe crops, bells | 0.3 |
| `hazards` | Lava, fire, drops, blocks known to hurt | 0.3 |
| `sounds` | What was heard | 0.3 |
| `creatures` | Every other mob | 0.25 |

Each item has three forms: **full** (as the state has it, with how the defence sized it up and
that it is news), **brief** (id, kind, distance and bearing; a mob keeps `hostile` and
`reachable`, which its shape needs), and **counted** (left out, and added to a count). The
body, what it carries, the time, the feeling of the place, the running skill and the defence's
choice are not channels: they are always passed whole. The Minecraft side also gives each
form's cost (its size as JSON) and puts the kept forms back together as a state of the same
shape, so Jev's questions and the planner's text are built as before. What was held back is in
the view as `told: { heldBack: { creatures: 3, ... }, new: [...] }`, and the planner's text says
"Not shown: 3 more creatures".

**Priority** (`priority.ts`). Each item starts from its channel's base (the driver: the message
itself) and is raised or lowered by modulators, each with a weight in one table (`WEIGHTS`):

| Modulator | Weight | Strength in `bots.json` |
|---|---|---|
| It is the attended thing (from the colliculus) | +0.5 | `spotlight` |
| It is the running skill's target | +0.5 | `spotlight` |
| A threat the defence calls "seen" / "coming" or "on it" | +0.35 / +0.6 | `threats` |
| The planner asked for it (`detail`) | +0.3 | `detail` |
| It is wanted (dopamine's want for its kind, 0 to 1) | up to +0.3 | `wants` |
| Its kind is in the goal's `watchFor` | +0.25 | |
| It is new or just changed | +0.2 | |
| It is near (1 at the bot, 0 at 16 blocks) | up to +0.15 | |
| It has been got used to (the colliculus's habituation) | down to −0.25 | |

**The gate** (`gate.ts`). Each channel is open or turned down. It is open when it holds the
attended thing, the running skill's target, a threat in view, a wanted thing, or something the
goal asks for (`watchFor` or `detail`). Items of a turned-down channel can be brief or counted,
never full.

**The budget and the fill** (`budget.ts`, `fill.ts`). Each reader has a size limit in characters
of JSON (`limits`: 1,500 for instinct, 4,000 for the planner). In order of priority each item
gets its full form while there is room, then brief, then it is counted.
- *Focus sets the shape* (`shape`): the share of the room that may go to full forms is the focus
  level. High focus: few things in full, the rest counted. Low focus: many things, in brief.
- *Arousal sets the size* (`size`): below 0.3 the limit is a third; it is whole from 0.5. Above
  0.9 the limit stays but only the top three items get any form. While the deciding layers are
  paused (asleep), no view is built.
- *Never held back*, whatever the budget: the body, the attended thing, the running skill's
  target, any threat "coming" or "on it", anything coming at the body, and any hazard within 3
  blocks. If these alone pass the limit they are passed anyway and the trace says by how much.
  A threat in view (any hostile in the threats channel) is never only counted: it gets its
  brief form at the least, so Jev is always offered it as a target.

**The burst** (`burst.ts`, `burst`). When something new appears or changes in a turned-down
channel it is passed once, marked as new (`told.new`), in brief form even if the budget is full
(the lowest full item gives way to brief). After that it stays only if it earns its place by
priority. News is told once for each source: the item itself, or, for an item with a rough
`place` (a sound: each one heard has its own id), its kind at that place. A source bursts again
only after it has been quiet for a minute (`QUIET_MS`), so a mob that groans every few seconds
is one piece of news. A burst while the colliculus's `orienting` is 0.6 or more sets the `burst` signal for
the tick, which lets the deciding layers run at once (the same urgent path an alarm interrupt
uses).

**The planner talks back** (`asks.ts`, `detail`). A goal may carry `detail`: up to five kinds or
ids the planner wants to be told about in full. They open their channel and are raised. One
that matches nothing for a minute is dropped. The planner's prompt says that what it is shown
is a selection and that it can ask.

| Signal | Meaning | Read by |
|---|---|---|
| `burst` | 1 on a tick when strong news burst through a turned-down channel | The rate gate: instinct and the planner are not held back that tick |

**In the trace** (`thalamus`): `fullSize`, `fixed` (what is always passed whole), `focus`,
`arousal`, `asks`, and for each reader `limit`, `spent`, `size`, `over`, each channel (`open` and
why, and how many items in full, brief and counted), the items given a form (with priority and
which modulators moved them), `bursts`, `gaveWay` and `heldBack`; and the region's own time,
`ms` and `worstMs` (the tick log's time for a region includes those queued before it). `pnpm brain-report` has a
THALAMUS section: view sizes over time, Jev's request size and answer time, what opened
channels, bursts, and blind spots (hurt by, or a skill failed on, something instinct was told of
only in brief or as a count in the 5 seconds before). `pnpm thalamus-check [--runs 3]` runs the
live scenes; `pnpm replay-views <logs>` checks, on recorded runs, that with the gate off the
deciders are told what they were told when the run was made.

## The colliculus: where is it, and how sudden

The colliculus (`colliculus` region, `packages/region-brainstem/src/colliculus-region.ts`;
Minecraft side in `packages/minecraft/src/brain/colliculus.ts`, `colliculus-percepts.ts` and
`glance.ts`; per bot in `bots.json` under `colliculus`) keeps one map of the space around the
bot, scores every place on it, picks one winner and turns the head to it, before the rest of
the brain has worked out what the thing is. It runs every tick, never calls a model, and can be
left out with `--regions` (then nothing turns the head, and `attended` stays null).

Each part of it is one small file in `region-brainstem/src`:

| File | What it holds | Its strength in `bots.json` |
|---|---|---|
| `salience.ts` | How striking a thing is, from six physical features | `sight`, `hearing`, `looming` |
| `darkness.ts` | A thing in the dark stands out less (one table) | `darkness` |
| `field.ts` | Up and down: the upper, lower and level fields | `elevation` |
| `priority.ts` | The boost for a kind that is watched or wanted | `topDown`, `wants` |
| `fixation.ts` | The brake: the gaze held on what the running skill is aimed at | `fixation` |
| `lean.ts` | Sky and ground: avoid, freeze or approach, from physical facts | `fields` |
| `orienting.ts` | The fast "something happened" signal | `event` |
| `worth.ts` | Whether a look was worth it | `followUp` |
| `habituation.ts` | Getting used to what brings nothing | `habituation` |

With `elevation`, `wants`, `fixation`, `fields`, `event`, `darkness` and `followUp` all at 0 the
colliculus is the flat map it was before (`COLLICULUS_AS_BEFORE`).

**What the eyes and ears deliver** (state schema 19; `encode/perceive.ts`, `senses.ts`):

| Field | What it says |
|---|---|
| `bearing` (on each nearby mob, player and listed block) | Which way it lies from where the head faces: `side` (ahead, left, right, behind) and `angle` in degrees, positive to the left |
| `seen` | Within the field of view (110 degrees either side; 30 is the sharp middle) with nothing opaque in the way. Glass does not block sight. |
| `closing`, `speed` | How fast it is coming nearer by its own movement, and how fast it is moving at all, in blocks per second. Walking up to a still thing does not make it close in. |
| `nearby.sudden` | Things that just changed in view: `appeared`, `started_moving`, `changed` (a block placed, broken, opened or shut within 8 blocks) or `looming` (closing at 4 blocks a second or more, or a projectile heading this way) |
| `nearby.heard` | Sounds in the last 2 seconds: `{ type, bearing, dist, position, loudness }`. It replaces `nearby.loud`. |
| `self.gaze` | What the head is pointed at: the nearest seen thing within 12 degrees of straight ahead (or null), the compass heading in degrees, and `pitch` (degrees up) |
| `elevation`, `height`, `light` (on each nearby mob, player and listed block) | Degrees above or below eye level, from the eyes to the thing's middle; how tall it is in blocks; the light where it stands, 0 to 15. Things in `nearby.sudden` carry `elevation` too. |

`seen` still goes by the sideways angle only: the bot sees what is overhead without looking up.

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

**Two dimensions** (`elevation`; `field.ts`). Every thing on the map has an angle and an
elevation in degrees. More than 20 degrees up is the `upper` field, more than 20 down the
`lower`, else `level`. (A pig two blocks off on flat ground is in the lower field: the eyes are
1.6 blocks up.) `attended` carries `angle`, `elevation` and `field`; the trace gives the `jump`
the head would make.

**Sight in the dark** (`darkness`; `darkness.ts`). What is seen is scaled by the light where the
thing stands. In complete darkness nearness keeps 0.2 of its weight, suddenness 0.5, motion 0.7
and looming 0.8: a still thing is lost first, a moving one last. Sound and touch are not scaled.

**Priority: salience plus what the bot wants** (`topDown`, `wants`; `priority.ts`). Salience
stays physical. A kind gets up to 0.4 added, × the larger of "watched" (the goal's `watchFor`
names it: 1) and "wanted" (how much dopamine wants that kind right now, 0 to 1, from its cues).
So a bot short of food has its eye drawn to what it has learned gives food, with no goal
asking. Wanting is worked out once, by dopamine, and handed over (`wants.ts` in `run-bot`). A
want never wins against a pressing thing (touch, or looming of 0.5 or more).
The threshold falls with alarm (by up to 0.25) and arousal, and rises by 0.3 during a skill that
marks itself `demanding`. Asleep, only touch and sounds of loudness 0.5 or more get through.

**Holding the gaze on the task** (`fixation`; `fixation.ts`). While the running skill is aimed at
a thing (it has a target, and is not the look itself), that thing is fixated: anything else
must beat the threshold by a further 0.3 to win, unless it is pressing. The fixated thing itself
is never looked at again or got used to. With a demanding skill the two raises never exceed 0.4
in all. The trace says when the brake stopped a winner (`brake`).

**Sky and ground** (`fields`; `lean.ts`). From where a thing is and how it moves, never from what
it is, the winner may carry a `lean` on `attended`:

| Lean | When (the table in `lean.ts`) | What is done with it |
|---|---|---|
| `avoid` | In the upper field and looming (0.5 or more) | The defence circuit, when it flees and the threat is not yet on the bot, runs for a roof (`take_cover`) instead of running in the open |
| `freeze` | In the upper field, crossing at 1 block a second or more, coming nearer no faster than 0.5 | With nothing coming, the defence circuit holds still and watches (`hold_still`) |
| `approach` | Not in the upper field, no taller than 1 block, moving but no faster than 2 blocks a second, within 6 blocks, not coming at the bot, and no need for safety pressing | The look is held up to 3 seconds, and Jev is told in one line that it may be worth a closer look |
| none | Anything else | As before |

The lean follows a held thing from tick to tick. It is advice: the two defence lines are in
`brain/defence.ts` (`defence.lean` in `bots.json`), the defence's own choice comes first, and a
lean never overrides a threat that is on the bot. Because the reflexes run before the
colliculus, the flee rule also asks the same table about its own threat (`leanFromState`), so
the first tick of a dive is not lost.

**Habituation** (`habituation`, `followUp`; `worth.ts`). A look was worth it if, while the thing
was attended or within 2 seconds after, the body was hurt or rewarded, a skill was started that
targets it, a need moved by 0.1 or more, or the defence circuit changed mode because of it. A
thing that was worth the look is not got used to and gets back what it had lost; each release is
logged with why. A thing that wins a look and brings nothing counts 0.8 as much next time, per thing and per kind-at-place (to 8 blocks). What was lost
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
- *The fast "something happened" signal* (`event`; `orienting.ts`): `orienting` is the new
  winner's strength (its salience, up to 1) and fades to 0 within half a second. Something the
  bot caused itself is looked at but sends none: a block it just broke or placed, a creature it
  struck (as for the startle), and anything at the target of its running or just-ended skill
  (the lid of the chest it opened). It is not a
  reward and raises no alarm. Its readers, each with its own strength:

  | Reader | What it does | Strength |
  |---|---|---|
  | Dopamine | A run that ends within 2 seconds of it is learned from at no less than that share of the usual step (`noticed`); it pays nothing | `focus.eventLearning` |
  | Acetylcholine | One of 0.5 or more raises focus for 5 seconds, fading (`justNoticed`) | `focus.orienting` |
  | The reticular formation | Novelty for 2 seconds (it used to read `attended.since`) | `arousal.orienting` |

**When nothing stands out** (`scanning`). Travelling, the head looks where the body is going.
Standing or idling, every 4 seconds it glances toward the compass direction looked at longest
ago, so things behind get seen. With `elevation` on, every fourth glance goes up or down: the
sky when outdoors; under a roof, the ceiling and the floor ahead in turn (`glance.ts`). The
`idle` skill no longer looks around itself.

**Seeing only what is in view** is now the thalamus's (`thalamus.fieldOfView`, below).

**In the trace** (`colliculus`): `threshold`, `top` (the three most striking things, each with
its parts, angle, elevation, field, light, and its boost and where that came from), `winner`
(why, its field, the jump, its lean, what kind of boost drew it), `look` (target, urgency, and
`how`: alongside, takes over or competes), `brake` (what the held gaze stopped), `fixated`,
`released` (was the look worth it, and why), `worthAfter`, `orienting`, `scan`, `damped` and
`worstMs` (the map should stay under 2 ms). `pnpm brain-report` has a COLLICULUS section: looks
per minute, what drew them, the median time from event to head turned, how the looks ran, what
was habituated to, "blindsided" events, and for the two-dimensional map: looks by field, leans
and what the defence circuit did with them, winners stopped by the brake, looks drawn by a
want, and how often a look was worth it. `pnpm colliculus-check [--runs 3]` runs the live
scenes (the map's own are in `scripts/colliculus-map-scenes.ts`).

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
  `targetBlock`, `targetChanged` (the same block in another state: a lever thrown), `health`,
  `food`, `targetHurt`, `targetGone`, `opened`, `closed`, `drops`, `sneaking`. Each primitive declares in one line what it expects when it works
  (`expects: ["targetBlock=air"]`), and `changes.asExpected` says whether that happened (by the written list, or by what the cerebellum has learned the movement does in this situation: see The cerebellum). Each run
  is also noted in the body's movement log (`movements.ts`), which the cerebellum reads. A
  movement made inside a longer skill (a hit in `attack`, a dig in `dig_out`, a bite in `eat`)
  raises no skill event, so the skill wraps the call in `watched()` (`primitives/watch.ts`) and
  it is noted the same way, without holding the skill up.
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
- *Late*: when the route is known, the journey's time is estimated from its length and the gait,
  or from the pace the cerebellum has learned on this ground. Past twice that, or past the
  learned time for the ground crossed plus three spreads, the result's changes say `late: true`
  (see The cerebellum, The readers). The stumble check's allowance goes by the learned pace too,
  and `status().behind` says how far behind its learned pace the journey is.

**What it reports.**
- The state: `self.locomotion` is `{ moving, pattern, gait, stuck }`.
- The brainstem shares a `stuck` signal: 1 while the legs are stuck, fading over about 5 seconds.
  The hook for the search dial to read it is marked in `noradrenaline/search.ts`; it is not wired.
- Each journey's skill event carries in `changes`: `distance`, `seconds`, `patternSwitches`,
  `recoveries` (and which, in `recovered`), `late`, and `asExpected` (done and not late). This is
  the same mechanism the primitives use.
- The body's movement log gets one note for the journey and one for each stretch of it over one
  kind of ground (`locomotion/stretches.ts`: at least 3 blocks and 1 second while the legs were
  meant to be moving), with the seconds per block. The cerebellum learns the pace from these.
- `pnpm brain-report` has a locomotion section: journeys, the share that finished, stuck events
  and how each ended, and time in each pattern and gait.

`step`, `jump` and `sneak` are single movements, not journeys, and hold their own key.

## The hippocampus: where, and in what order

`packages/memory` (game-free). One region, `hippocampus`, layer 0, every tick. It never
proposes an action. It keeps three things: memories of events, a map, and the order things
came in. What a cell is, and what ends an area, is the game's side:
`packages/minecraft/src/brain/place.ts`.

**Memories** (`memory.ts`, `memory-region.ts`). A trigger (`brain/memories.ts`) fires on a
moment worth keeping; the memory has a kind, a place, what was involved, an outcome and a
strength that fades. Alarm in the minute after stamps it stronger. At rest it consolidates,
one step a tick: prune, merge, generalise (a fact from 3 agreeing memories).

**The map** (`map.ts`). Learned by moving about; no reward is needed.

| Part | What it is | File |
|---|---|---|
| Cell | A cube of 8 blocks, per dimension. Kept: the last spot stood on, visits, time spent, what was seen (kinds and counts, halving every 2 game days if not seen again) | `map.ts`; the cube: `CELL_BLOCKS` in `brain/place.ts` |
| Way | Two cells walked between, the quickest crossing, how often, and what lay between (a door, a climb) | `map.ts` |
| Area | Cells joined by plain ways and sharing a setting ("open" under the sky; "covered" where the sky's light is low, or a roof and walls are close round the body). An area keeps its name as the map grows | `map-areas.ts` |
| Familiarity | 0 to 1 per cell: half after 4 visits (half a minute spent counts as a visit) | `map.ts` |
| Route | The quickest known way between two cells, only along ways walked. A cell that led to harm counts as two minutes longer, so another way is taken when there is one | `map-route.ts` |

Each tick the region puts the bot on the map and shares `ws.place` and the signal
`unfamiliar` (1 − familiarity). Reader: dopamine's curiosity. An area known less than half
counts as something new, once (`newPlace` in `brain/cues.ts`, beside `noticedIn`).

**The order of events** (`memory.ts`, `leads-to.ts`, `trail.ts`).
- Each memory links to the one before it when they are under two minutes apart.
- Two memories are one only when they are of the same kind, involve the same things and
  their outcomes have the same sign. A good and a bad meeting are kept apart.
- The region keeps the last ten minutes of cells, in order.
- At rest a fourth step, `sequence`, writes a "leads to" fact when one kind of event has
  followed another three times ("creeper (danger) is often followed by ...").

**Replay** (`map-replay.ts`). Replay pays nothing and is not a new experience.

| When | What is played | What it leaves |
|---|---|---|
| After a memory with an outcome of 0.2 or more, good or bad | The recent cells, backward | Each cell on the way gets "led to good" or "led to harm": the outcome's size at the spot, 0.7 of that one cell back, and so on for 8 cells. A death is marked where the bot died, not where it woke up |
| At rest (a fifth consolidation step, `replay`) | The cells since the last rest, in order | Each way gone over counts as half a walk, so routes prefer it |
| Before a journey | The route, forward | For the planner: one line beside a known place ("the way passes where this happened: ..."). For locomotion: the feared cells as avoid areas, and the known spots to pass |

**Journeys on the map** (`brain/map-routes.ts`, `locomotion`). The pathfinder takes one goal at
a time, so known spots are walked as legs: `goTo` asks `routeHint` once as a journey starts,
heads for each spot in turn, and drops the spots left when it is within 12 blocks of the end
or a leg has no route. Spots are given only for a way of three cells or more, and only when
the way by them is no more than one and a half times the straight line (`DETOUR`): a known way
that is a long way round is no help. A feared cell is not ringed when its circle would shut in
the start, the end or a spot to pass.

**Settings** (`bots.json`, under `memory`; each 0 to 1, and at 0 that part is off):

| Setting | At 0 | Above 0 |
|---|---|---|
| `map` | No map is kept, `ws.place` stays null, `unfamiliar` is not shared | How fast a cell becomes familiar |
| `order` | No links between memories, good and bad may merge, no "leads to" facts | On |
| `replay` | No marks, nothing gone round, the planner told nothing | How strongly a cell is marked |
| `waypoints` | Locomotion is given no spots | On |

**Reports.** The region's trace carries `place` each tick (cell, area, familiarity, map size,
time taken and the slowest tick, how many journeys used the map), `replays`, and
`consolidation`. `pnpm map-check` runs three live scenes: `wander` (a ground with a house and a
tunnel, then to a chest out of sight), `route` (two ways between two corners, a death on one,
and the way then given) and `replay` (a trip that ends in being fed).

## The amygdala: what predicts harm, and what predicts good

`packages/region-amygdala` (game-free; per bot in `bots.json` under `amygdala`). One region,
`amygdala`, layer 0, every tick, listed after the hippocampus (it needs `ws.place`). It never proposes an action and calls no model.
What a cue is, and what counts as an outcome, is the game's side:
`packages/minecraft/src/brain/amygdala.ts`.

It is the one place that learns what predicts harm. The older rules (the threat record's
danger, `hurts.json`, `bad-foods.json`, the feeling of a place from memory) are still there:
each reader has its own strength in `amygdala.readers`, and at 0 that reader uses its old
source. The trace still says what the old rule holds next to the amygdala (`shadow`).

**An association** (`association.ts`), one per cue, saved in `data/<bot>/associations.json`:

| Field | What it is |
|---|---|
| `harm` | How strongly the cue predicts harm, from -0.5 (a sign of safety) to 1 |
| `good` | How strongly it predicts good, 0 to 1 |
| `sure` | How sure, 0 to 1. Halves every 5 game days without evidence. An unsure value is acted on at 0.4 of its size, falling back toward what the cue was born with |
| `safe` | "Safe here": per area, how fully its harm has been found not to come there. Halves every 3 game days |
| `born` | What the bot is born believing of it (an inborn fear), if anything |
| `met` | How many times it has been around with no harm following (up to 20). Something long familiar and harmless is slow to be blamed |

What a cue predicts here and now is `harm × (1 − safe here)`. A "safe" learned in another area
counts a third.

**Cues** (`brain/amygdala.ts`, `CUE_READERS`). A cue is a name with a type before the colon.

| Cue | When it is offered | How much it stands out |
|---|---|---|
| `kind:zombie`, `kind:player:<name>`, `kind:chest` | The thing is in view (or has just struck the bot) | 1 if attended to or it just struck; else 0.3 to 0.6 by nearness |
| `block:cactus` | The body touches it, or it is a hazard close by (a hazard only seen close by is `apart`: no harm then says nothing about touching it). A block is `direct`: it is blamed for a hurt only when the hurt points at it | 0.15 |
| `food:bread` | Just eaten; it stays around for a minute and is blamed only for what comes through the gut | 0.8, fading |
| `area:a3` | The area the hippocampus says the bot is in | 0.2 |
| `time:night` | Always: day, dusk, night or dawn | 0.1 |
| `sound:explosion` | Heard in the last second | 0.6 × loudness |
| `sign:danger\|creeper` | An event just remembered that a "leads to" fact starts from | 0.5 |

Inborn fears are a cue's starting point: `defence.innateThreats` (0.5, as the threat record
starts), `reflexes.innateHurts` (0.8) and `medulla.innateBadFoods` (0.8). The listed ones are
held from the first tick, met or not (`inbornFears`); with `innateThreats: "game"` a kind is
known when first met.

**Outcomes** (`playerOutcomes`).

| Outcome | Size |
|---|---|
| Health lost | Its felt size: the square root of the share of full health (1 health is 0.22, 5 is 0.5, 20 is 1), so that a small hurt is still plainly a hurt (`feltSize`). It points at the attacker, or at the block the game names |
| Death | 1, and it teaches in one go |
| An illness starting | Half the effect's sickness, through the gut |
| A need dropping by 0.1 or more in a tick (not a need about danger) | The drop |

Not outcomes: a hurt the bot caused itself (`selfCaused`), a hurt of the body's own doing
whatever is around (`OWN_DOING`: a fall, flying into a wall, drowning, starving), and a first
hit from a player (the two-hit rule, shared with the threat record: `createPlayerHits`).
Replay in the hippocampus is not an outcome either: only the body's own health, illness and
needs are read.

**Learning** (`learn.ts`, pure).
- The cues of the last 5 seconds share one surprise: the outcome less what they predicted
  together. Each moves by rate × its share × the surprise. So a cue that adds nothing to what
  was already predicted learns nothing.
- Shares go by how much each cue stands out. A cue the outcome points at counts in full; the
  others then count a quarter.
- A cue long familiar and harmless is slow to be blamed for a harm that points at nothing: its
  share is divided by 1 + half its harmless meetings (`met`). So the ground and the time of
  day give way to whatever is new (the cave it has just walked into). A harm that points
  straight at a cue ignores this, and the cue is familiar no longer.
- The rate grows with the outcome: 0.3 of full for the smallest, all of it for the largest.
- Harm is never erased, and a hurt never lowers it (a small hit from a feared thing changes
  nothing). A feared cue that was around with no harm (`presence.ts`: it left, or
  a minute passed) moves "safe here" a tenth of the way to 1, less for a meeting under 20
  seconds. Harm in that area takes the safety away again.
- A cue that is not feared, around with no harm while the other cues predict 0.2 or more, goes
  below zero: a sign of safety. It moves by its share of how much everything around stands
  out, so the ground underfoot gets there very slowly.
- Good fades a little when nothing good follows.

**Spreading** (`spread.ts`, `brain/alike.ts`). A cue never met starts with half of what the
most similar known cue of its type predicts, times how alike they are. Likeness is from
physical facts (size, the game's word for how it moves, whether it shoots, the game's hostile
flag). Only kinds of creature can be compared so far.

**What it shares** (`signals.ts`), each 0 to 1, of the cues that are here now:

| Signal | What it is |
|---|---|
| `fear` | The strongest harm any cue around predicts here and now, less any signs of safety around (cues below zero) |
| `appeal` | The strongest good any cue around predicts |
| `matters` | The larger of the two |

It also tells the thing attended to how much harm it predicts (`attended.harm`), and the
threat sense writes the same for each threat it sizes up (`harm`, beside `danger`).

**Who reads it.** Each is one line where the reader is put together (`apps/run-bot/src/brain.ts`,
`amygdala.ts` and `loop-mode.ts`), with its own strength in `amygdala.readers`:

| Reader (`readers.` name) | What it takes | At 0 |
|---|---|---|
| The defence circuit (`defence`) | A kind's `danger` is the harm its cue predicts here. A kind is a threat if it is born one or predicts 0.12 or more (`KNOWN_HARM`). What is known about fighting it (beatable, shoots, kills) stays the threat record's | The threat record's danger and learned threats |
| Possible danger (`wary`) | A feared area, or a sign of harm happening now, makes danger "possible" with nothing in view, which sets `wary` | A bad memory within 24 blocks |
| Noradrenaline (`alarm`) | Fear counts beside the vital needs, at half its size (`FEAR_ALARM`): alarm rises before any harm | Fear does not move alarm |
| The hippocampus (`memory`) | A fresh memory's strength is the larger of alarm and `matters` | Alarm alone |
| The thalamus (`thalamus`) | A feared thing's priority rises by 0.6 × its harm (`WEIGHTS.feared`), as much as a threat coming, so it is passed in full | Fear does not count |
| The hypothalamus (`stress`) | Fear is one more load on the body: lasting fear builds stress | It is not |
| Acetylcholine (`focus`) | `appeal` is a focus input ("promising") | It is not |
| Safety checks, pathing, the about-to-touch reflex (`blocks`) | A block is known to hurt if it is on the inborn list, or its cue predicts 0.12 or more here | `hurts.json` |
| Food helpers, the medulla's eating urge (`foods`) | A food is bad if its cue predicts 0.12 or more | `bad-foods.json` |

The threat sense, the safety checks and the food helpers are asked when the state is made,
before any region runs, so they read what the amygdala held at the end of the last tick. A cue
it has not met yet is rated as it would begin (born with, or like a similar kind). With the
amygdala left out of the brain (`--regions`), every reader goes back to its old source.

**What never reads it.** The hard reflexes (in lava or fire, drowning, last stand, cornered
fight, buried, falling right) and the medulla's hard rules. The inborn hurts stay fixed for the
safety checks, because the about-to-touch reflex is built on them. A kind born never-to-fight
stays so. `last_stand` goes by the game's hostile flag.

**Moving the old files over** (`brain/amygdala-move.ts`, `moveOldLearning`). On the first start,
`threats.json`, `hurts.json` and `bad-foods.json` are copied to `data/<bot>/before-amygdala/`
and laid over the associations: a threat predicts its recorded danger, a block or food the old
rule knew predicts 0.5. The folder marks it done. The old files stay and keep being written.

**The log.** Each tick the trace carries `fear`, `appeal`, the cues that predict anything, what
was `learned` and why (with `rated`: what the cue the harm pointed at was rated before, and
`spared`: how many cues around were not blamed), `returned` (a fear that came back, and why),
and `shadow`: for whatever is around, the old rule's answer and the amygdala's. `pnpm
brain-report` sums these up with the map. `pnpm amygdala-check` runs six live scenes (a feared
place, a warning, unlearning, a tag-along, a shelter, a similar kind). `pnpm shadow-check
[minutes]` plays the whole brain by the base with nothing scripted; `pnpm shadow-report <log>`
prints the comparison with the old rules for any log.

## The cerebellum: what each movement comes to

The cerebellum (`packages/region-cerebellum`, game-free; a `cerebellum` region, layer 0, every
tick) learns, for each movement the body makes, what that movement comes to in that situation:
how long it takes, how far it carries, which changes follow. It learns from **error, not reward**:
a reward says good or bad, an error says how far off and which way. It never chooses, blocks or
starts an action, and it calls no model.

It was built in two steps: first it learned in shadow, then its readers were switched over. Each
reader has a strength from 0 to 1 in the bot's `cerebellum` block; at 0 that reader goes by the
bot's fixed rule exactly as before (see The readers, below).

**What a movement reports.** The Minecraft side (`packages/minecraft/src/brain/cerebellum.ts`)
hands the region each movement that ended since the last tick, as three things:

| | |
|---|---|
| Kind and name | `primitive` (`hit`, `break_block`, ...), `journey` (`goTo`, `follow`, `awayFrom`), `pace` (one stretch of a journey over one kind of ground: `walk`, `swim`, `dash`), `skill` (`eat`, `attack`, ...) |
| Situation | A list of short keys from specific to general, physical only. Hands and head: `stone\|wooden_pickaxe` → `stone` → any (what it was aimed at, what was in the hand). The head alone: what it was aimed at → any. Legs: `soul_sand\|sneak` → `slow\|sneak` → any (the block underfoot, how such a block behaves, in water, sneaking, a slowed or quickened body). Travel: `jog\|ice\|up` → `jog\|slippery\|up` → `jog` → any (gait, ground, climbing or dropping, in water, sneaking, a slowed or quickened body). A skill: any. |
| Measures | `seconds` for a primitive or a whole skill that finished (not for a journey or a stretch: their time goes by how far they went); `secondsPerBlock` for a stretch and a journey; `recoveries` for a journey; `moved` for a movement of the legs; and for every movement the list of changes it caused (`moved`, `targetBlock=air`, `targetHurt`, `food+`). |

Where they come from:
- Primitives and journeys: **the body's movement log** (`packages/minecraft/src/movements.ts`),
  written by the primitive wrapper, by `watched()` for a movement inside a longer skill, and by
  the locomotion controller. A skill event alone would miss these: only the outermost skill
  raises one.
- Whole skills: the skill events in the workspace, timed from `started` to the end.

**What teaches nothing.** A movement that was interrupted, a skill cut short by a reflex, given
up on or timed out, and any movement during which the body lost health. One exception: a stretch
already walked still tells the pace when the journey is interrupted afterwards. A failed
movement teaches its changes (what did not follow) but not its time.

**Learning by error** (`learn.ts`, pure; the same runs give the same models). For each movement
in each situation, each measure keeps `{ value, spread, seen, at }`:
- error = actual − predicted; the value moves by rate × error, so the sign carries through; the
  spread moves toward the size of the error the same way.
- The rate is 1 over the count while the model is new and settles at 0.1.
- Forgetting: nothing is lost for one game day unused; after that the count halves every three
  game days, so a new tool or a changed body is relearned quickly.
- Each measure is kept inside stated bounds (`MEASURE_BOUNDS`: seconds 0 to 600, seconds per
  block 0.05 to 20), so one strange run cannot teach a strange number.
- Changes: how often each change followed. One that follows nine times in ten is a learned
  expectation. Older runs fade at the same settled rate, so a change that stops following stops
  being expected.
Every key in the list learns from the run. Saved in `data/<bot>/models.json`.

**Trust and falling back** (`predict.ts`). A model is used once it stands on five runs. A
specific key with too few uses the more general one; with none, nothing is predicted and the
bot's fixed rule stands.

**The log.** Each tick with a movement, the region's trace lists it under `runs`: the movement,
its key, each measure's `predicted`, `spread`, `from` (the key the prediction came from),
`actual` and signed `error`, the `changes`, the `expected` changes and any `missing`, and
`today`: what the bot goes by now (the written `expects` and `asExpected`, the journey's
estimate and `late`, the gait's fixed speed, the 2-minute clock). `worstMs` is the slowest tick.

**The readers.** The region is listed straight after the reflexes, so what it shares is read the
same tick. Its numbers reach their readers through `playerCerebellum`
(`packages/minecraft/src/brain/cerebellum-readers.ts`), one function per reader. Every reader
uses a trusted model only, moves the fixed number toward the learned one by its strength
(`toward` in `readers.ts`), and is back on the fixed rule at strength 0 or with the region left
out (`--regions`).

| Strength | Reader | What it takes | The fixed rule (strength 0) |
|---|---|---|---|
| `estimates` | The locomotion controller (`locomotion/learned-pace.ts`) | The journey's estimate: its length × the learned pace on the ground it starts on | Length ÷ the gait's fixed speed |
| `late` | The locomotion controller | Late once past the learned time for the ground actually crossed (each stretch at its own pace) plus three spreads, and never under 4 s. Ground with no trusted model is priced by the fixed rule | Past twice the estimate |
| `pace` | The stumble check (`feel.ts`, one line in `controller.ts`) | Its allowance of ground covered is scaled by fixed pace ÷ learned pace here, between ½ and 1½ | 0.5 blocks in 1.5 s everywhere |
| `giveUp` | Serotonin's give-up clock (`baseOf` in `persistence.ts`) | The clock's base: the skill's usual time plus three spreads, kept between ¼ and 3× of two minutes (30 s to 6 min). Patience and the chance of payoff scale it as before | Two minutes for every skill |
| `mismatch` | Focus, alarm, the striatum | The `mismatch` signal (below) | No signal |
| `expectations` | The primitives' `asExpected` (`setLearnedExpectations` in `movements.ts`) | An empty written list is filled by the changes that follow nine times in ten. A written list is replaced only in one particular situation (never by the any-situation model) where a written change follows less than half the time; the run's `today.used` says which list was used and why | The written list |
| `timing` | The defence (`due` in the threat sense) | Harm that usually follows a sign about now makes the thing it comes from "coming" while it is in view and can reach the bot | Never due |

**The `mismatch` signal** (`mismatch.ts`): "that went wrong", at once.

| Signal | 0 means | 1 means | Read by |
|---|---|---|---|
| `mismatch` | Movements are coming out as predicted | A movement just came out five spreads or more from its prediction | Focus (an input beside `surprised()`), noradrenaline (a rise of at most 0.2 in alarm, only for 0.5 and above), the striatum (0.5 and above is notable: a habit gives way) |

- The size goes by spreads off: one spread is nothing, three is 0.5 ("large"), five is 1. One
  spread is never taken as under a tenth of the predicted value.
- A change that nearly always follows and did not this time is a mismatch too, but never a
  large one (under 0.5): one miss is weak evidence, and a drop can simply be seen late.
- Slower and faster both count (a new tool is a mismatch until its own model is trusted).
- Only a prediction made for a particular situation counts. A guess from the any-situation model
  being off is not something gone wrong.
- A run that was cut short raises nothing. It fades to nothing within a second.
- It is also raised while a journey is well behind its learned pace (`status().behind` of the
  locomotion controller: seconds over the learned time for the ground covered, in spreads).
- It never touches the scorebook: what a skill is worth is dopamine's to learn.

**Timing** (`timing.ts`). Each "leads to" fact of the hippocampus is a pair: a sign, and what
follows it. The delay between them is learned like any movement (kind `timing`, measure
`seconds`), from the events the bot remembers (`memory.latest()`, `memory.leadsTo()`). While a
sign is waited on and its delay is trusted, what follows is "due" from 2 s before its earliest
usual time (the delay less three spreads) to its latest. No signal is shared for this: the
threat sense runs before the regions each tick, so the defence asks directly, and the region's
trace lists what is due under `due`.

**Guardrails.** The cerebellum never chooses, blocks or starts an action. The hard reflexes, the
medulla's hard rules and `last_stand` never read it. Readers use trusted models only, every
learned number is bounded, and only the bot's own movements that were not interrupted teach it.
It is deterministic and calls no model.

**Settings** (`cerebellum` in bots.json; checked in `bot-config.ts`): `learn`, `estimates`,
`late`, `pace`, `giveUp`, `mismatch`, `expectations`, `timing`, each 0 to 1 (default 1).

**Checks.** `pnpm cerebellum-check` runs the live scenes on the test server: `practice` (in
shadow: each kind of movement several times, then the shadow report), `pace`, `late`, `giveup`,
`mismatch`, `newtool` and `expectations` (the readers on; each prints what was predicted, what
happened, the error over the tries and who read it). `pnpm cerebellum-shadow [minutes]` plays
the whole brain by the base in shadow. `pnpm cerebellum-report <log> [data/<bot>/models.json]`
prints the shadow report and the readers' report for any log, and with the models the table of
what each movement does. `pnpm brain-report` has the same under CEREBELLUM. `LIVE_OUTPUT=<file>`
before any live check keeps what the bot printed.

## The basal ganglia: who goes ahead

One place decides which proposals go ahead: `createArbiter` in `apps/run-bot/src/brain.ts`, built
from `packages/basal-ganglia`. Every candidate is held back by default; one is released in each
channel. The basal ganglia only choose. They never change a proposal or make one up (the
striatum's habit proposal is a region's, like any other).

**The score.** `score = (urgency + every go term) × every no-go term`. The highest wins; a tie
goes to the faster layer, then to the first listed. The log has, for every candidate on every
tick, what each term added or scaled, the go total, the no-go total and the score
(`selection` in the tick log), and the winner's reason names the terms that decided it.

**The terms**, in the order they are listed:

| Term | Kind | Applies to | What it does |
|---|---|---|---|
| `given-up` | gate | deciders | A skill just given up on is not started again yet |
| `standing-choice` | keeps a candidate | deciders | The running skill's choice stands while the layer that made it is silent |
| `learned-value` | go | all | + 0.2 × what dopamine has learned the skill is worth here |
| `stay` | go | all | + the bonus for the running skill, while it is getting somewhere |
| `switching` | works on `stay` | all | Searching shrinks the stay bonus, settling grows it |
| `urge-loosens-stay` | works on `stay` | all | A bodily urge shrinks it: × (1 − urge) |
| `hold-for-want` | no-go | deciders | While something is wanted, options that do not serve the pressing need are scaled down |
| `restraint` | no-go | deciders | The patience brake on what has cost the bot |
| `desperate-eases-restraint` | works on `restraint` | deciders | A desperate need takes up to half of the brake off |
| `body-first` | no-go | deciders | A request of the body in the same contest scales rivals down (below) |

A term is a name, a kind, the layers it applies to and one function
(`packages/basal-ganglia/src/term.ts`). A term that "works on" another scales that term's
strength, not the score. The order matters only for those.

**Body first.** While a layer-0 proposal with urgency `u` is in a contest, every option of a
deciding layer that would use the same body parts and is a different action is scaled by
`1 − 0.25 × bodyFirst × u`. So a freeze at 0.78 beats a decider's flee at 0.79, and a weak
reflex at 0.3 is still easily overridden. The striatum's habit does not count as the body.

**Waiting on a near tie.** A conflict is: the top two in a contest are different actions and
their scores are within `0.05 × wait`. Then whatever is running is kept, and `conflict` (0 to 1,
by how close) is shared. The reticular gate lets the deciders through at full rate and focus
rises while it is up. If the tie is still there after 300 ms it is settled: the faster layer
wins; on the same layer the one already running; with neither running the higher go total. The
settlement stands while the same two stay that close. The loop is asked for a tick in time
(`againInMs`), so a wait ends on time.

**Channels.** `CHANNELS` in `apps/run-bot/src/body-channels.ts`: `body` (legs and hands) and
`head`. A candidate is in the contest of every channel its skill's `parts` touch (no parts: the
body's; parts not given: both). The body's winner is the action; the head's runs alongside
through the executor's second place. A skill that uses both must win both, or it gets neither.
A look that wins the head while the running skill needs the head (or while nothing runs) is
the action. A reflex that uses no part of the body (a flinch) needs no contest.

**Habits (the striatum).** `packages/basal-ganglia/src/striatum.ts`, a layer-0 region listed
just before instinct, with the bot's side in `apps/run-bot/src/habits.ts`. It keeps a strength
from 0 to 1 for each skill in each situation (the scorebook's situation key), saved in
`data/<bot>/habits.json`.

- A choice of a deciding layer (or of the habit itself) that ends "done" with no bad surprise
  closes 15% of the gap to 1. So does every 5 s that the choice is still under way with
  nothing gone wrong (a skill that never ends, like idling, can be a habit too). A failed
  skill or a bad surprise halves it. Unused, it halves in two hours.
- Above 0.8, with nothing notable, the striatum proposes the action (at the urgency Jev used to
  give it) and shares `habit`. While `habit` is up instinct is not asked.
- Nothing notable means: no near tie, no threat seen or worse, nothing striking just now, no
  safety need pressing, predictions holding (the reading focus uses, from dopamine's surprise;
  an unfamiliar place alone does not count), and the same top drive as when the habit was
  last used (`habit.blind` 1 ignores the drive).
- Jev is still asked at least every 5 s. If it wants something else the habit loses 30%.
- A skill marked `risky` is never a habit.
- A habit is aimed the way the scorebook files things: at the same fixed thing, or at whatever
  of the same kind is in view now. With nothing to aim at it stands down.

**Never touched.** A proposal at urgency 1 wins its channel at once: no term, wait or habit is
asked. A wait never holds back a layer-0 proposal above 0.8, never lasts past 300 ms, and never
starts while a threat is on the bot. The same inputs give the same winners (time comes from the
state), so a run can be replayed: `pnpm replay-selection <logs>`. No model is called.

**Settings** (`selection` in `bots.json`, each 0 to 1; all at 0 is the plain list of terms):

| Setting | Default | What it does |
|---|---|---|
| `bodyFirst` | 1 | How strongly a request of the body holds back the deciders' rivals |
| `wait` | 1 | How wide a near tie is, as a share of 0.05 |
| `channels` | 1 | Above 0: a contest for each channel. At 0: one contest, and the older rule for what runs alongside (`--same-time`) |
| `habits` | 1 | How fast habits form. At 0 none form and none are used |
| `habit.blind` | 0 | How far a habit ignores a change in what the body wants most |

`pnpm brain-report` prints, under BASAL GANGLIA: wins by layer, what ran alongside, how often a
decider went ahead over the body and the reverse, near ties and how they were settled, the
share of ticks by habit with calls saved and wrong habits, and how often each term changed the
winner. `pnpm selection-check` runs the live scenes.

## The neuromodulators

Each bot's settings for these live in `bots.json`. What each bot learns and remembers is saved
in `data/<name>/`.

**Dopamine** (`dopamine` region): teaches which skills pay off, and what to want.
- Pays the signed change in each need's level, as the hypothalamus read it: `before² − after²`,
  so a need that falls pays and one that rises costs the same. Things that happen (a death, a
  failed skill) are reward rules of their own (`rewards.ts`). Boredom is a need kept in its own
  novelty memory: a new kind of thing relieves it, by half as much each time it is met.
- Adds rewards up per skill run. When the run ends the scorebook learns from the surprise
  (expected value, benefit and cost, per skill, situation label and thing aimed at), and what
  relieved which need (`skill ⇒ need`). Effort that came to nothing is charged.
- Shares DA, a slow level of recent reward. The arbiter values each skill by benefit and cost,
  with DA setting the weights.
- Wants: proposes heading to a thing (in view or remembered) by how hard a need presses × how
  well going there has relieved it. While something is wanted, the arbiter holds back options
  that would leave a pressing need unmet.

**Serotonin** (`serotonin` region): patience.
- The outlook is `1 / (1 + Σ (weight × level)²)` over the needs, plus stress (see the
  hypothalamus). Patience falls to a worse outlook within seconds and climbs back slowly.
- Patience changes three things: persistence (a stay bonus for the running skill that lasts
  while it makes progress, and a give-up time), the planner's horizon, and a brake on options
  learned to be costly (weaker while a need is desperate).

**Noradrenaline** (`noradrenaline` region): alarm and search.
- **Alarm** (fast) is never below what the vital needs press at, nor below half the amygdala's
  `fear`; a need suddenly worse, or a startle, adds a jump; it fades within seconds once the cause has gone. It takes the planner
  out of charge (offline above 0.8 until back under 0.5), and a jump interrupts the running skill
  (the goal is kept).
- **Search** (slow) rises while a need presses and the bot is getting nowhere, or knows nothing
  that relieves it (`unmet`), and falls while things move. It makes switching easier, widens the
  options offered, and tells the planner to rethink.

**Acetylcholine** (`acetylcholine` region): focus, "trust your senses and learn this now".
- Rises while the bot's predictions are failing and in an unfamiliar place; falls with routine;
  lowest while asleep.
- Focus sets how far remembered facts are trusted against the senses, how much detail and how
  many memories are taken in, how strongly new memories start, whether memories are consolidated
  (only at rest), and a cue pulse for things the goal said to watch for. How fast a run is
  learned from follows the size of its own surprise.

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
| Make the bot know only what it sees | `bots.json`: `thalamus.fieldOfView: 1` (the old `colliculus.fieldOfView` still works, with a warning) |
| Add a channel | `CHANNEL_BASE` in `packages/minecraft/src/brain/thalamus-channels.ts`, and say which items are its own in `splitState` (and how they go back in `assemble`) |
| Change what a decider is told | The modulators' weights: `WEIGHTS` in `region-thalamus/src/priority.ts`; what opens a channel: `gate.ts`; one bot: the strengths in `bots.json` under `thalamus` |
| Give a decider a bigger view | `bots.json`: `thalamus.limits.instinct` or `.prefrontal` (characters of JSON) |
| Add a reader | Add its region name to `DECIDERS` in `apps/run-bot/src/brain.ts`, give it a limit in `thalamus.limits`, and have it read `ws.view("<name>")` instead of `ws.state` |
| Change the size of a map cell | `CELL_BLOCKS` in `packages/minecraft/src/brain/place.ts` (an old `map.json` then no longer fits: delete it) |
| Change what ends an area | `createCellReader` in `brain/place.ts`: the `setting` (open or covered) and `barrier` (door, climb) |
| Make a bot at home sooner, or never | `bots.json`: `memory.map` (higher: familiar sooner; 0: no map) |
| Change how far back replay reaches | `BACK` in `packages/memory/src/map-replay.ts` |
| Change how strongly a feared cell is gone round | `HARM_MS` and `FEARED_CELL` in `packages/memory/src/map-route.ts`; the avoid areas: `AVOID` in `brain/map-routes.ts` |
| Add a measure for the cerebellum | `measuresOf` in `packages/minecraft/src/brain/cerebellum.ts` (one line), its bounds in `MEASURE_BOUNDS`; if the body must report something new, add it to the note where the movement ends (`primitives/watch.ts`, or `noteJourney` in `locomotion/controller.ts`). Nothing in `region-cerebellum` changes |
| Add something to a movement's situation key | Sense it in `factsNow` (`primitives/watch.ts`) or in `locomotion/stretches.ts`, add the field to `MovementFacts` (`movements.ts`), and put it in `handKeys`, `legKeys` or `travelKeys` in `brain/cerebellum.ts`, specific keys first |
| Have a skill's inner movement noted | Wrap the call: `watched(bot, "<primitive name>", { block } or { entity }, () => doX(...), signal)` |
| Turn one of the cerebellum's readers down or off | Its strength in the bot's `cerebellum` block in bots.json (0 = the fixed rule) |
| Give the cerebellum's numbers a new reader | A function on `playerCerebellum` (`packages/minecraft/src/brain/cerebellum-readers.ts`) that answers with the fixed rule when untrusted, a strength in `CerebellumSettings` and `READERS` (`settings.ts`), and one line where the reader is built (`loop-mode.ts`, or `brain.ts` for a region) |
| Change how big a mismatch is, or how long it lasts | `NOTHING`, `FULL_AFTER`, `MISMATCH_FADE_MS`, `LARGE_MISMATCH` in `packages/region-cerebellum/src/mismatch.ts`; how far it raises alarm: `MISMATCH_ALARM` in `apps/run-bot/src/brain.ts` |
| Change when a journey is late or the bounds of the give-up clock | `SPREADS`, `LATE_FACTOR` in `locomotion/learned-pace.ts`; `LIMIT_BOUNDS` in `packages/region-cerebellum/src/readers.ts` |
| Change how fast the cerebellum learns, trusts or forgets | `DEFAULT_CEREBELLUM` in `packages/region-cerebellum/src/settings.ts`: `settledRate`, `trusted`, `forgetAfterMs`, `forgetHalfLifeMs`, `expectedAt` |
| Add a kind of cue for the amygdala | `packages/minecraft/src/brain/amygdala.ts`: write a reader (name it `<type>:<name>`, give it how much it stands out) and list it in `CUE_READERS`. Nothing in `region-amygdala` changes |
| Add an outcome the amygdala learns from | `playerOutcomes` in `brain/amygdala.ts` (a size from 0 to 1, a sign, and what it points at if the game says) |
| Make a bot more fearful, or more forgiving | In `bots.json` under `amygdala`: `learn` (how fast anything is learned), `safeHere` (how far a fear is let go where it proved harmless; 0 never), `spread` (how far a new thing starts feared like a similar one). What it is born fearing: `defence.innateThreats`, `reflexes.innateHurts`, `medulla.innateBadFoods`. The rates themselves: `LEARNING` in `packages/region-amygdala/src/learn.ts` (`slowest`, `harmless`, `familiar`); how long things last: `LIMITS` in `association.ts`; how big a hurt feels: `feltSize` in `brain/amygdala.ts` |
| Add a reader of fear | Read the `fear` signal (or `appeal`, `matters`) where the reader is put together in `apps/run-bot/src/brain.ts`, scaled by a new strength in `AmygdalaReaders` (`packages/region-amygdala/src/settings.ts`). For a yes-or-no about one thing (a block, a food, a kind), add to `PlayerAmygdala` in `apps/run-bot/src/amygdala.ts`: the harm its cue predicts here against `KNOWN_HARM` |
| Send one reader back to its old rule | `amygdala.readers.<name>: 0` in `bots.json` (`defence`, `wary`, `alarm`, `memory`, `thalamus`, `stress`, `focus`, `blocks`, `foods`) |
| Change when something counts as known to bring harm | `KNOWN_HARM` in `packages/minecraft/src/defence/threat-record.ts` (a learned threat, a hurtful block, a bad food, a feared place) |
| Change how alike two kinds of creature are | `DIFFERS` in `packages/minecraft/src/brain/alike.ts`; to compare another type of cue, add its facts in `createAlike` |
| Add what a memory trigger records | `packages/minecraft/src/brain/memories.ts` (write the trigger, add it to `playerMemories`) |
| Turn the gate off | `bots.json`: `thalamus.gate: 0` (views are then the nearest few of each kind, by the attention budget) |
| Make a bot more distractible while it works | `bots.json`: lower `colliculus.fixation` (0: nothing holds its gaze); the size of the brake is `BRAKE` in `region-brainstem/src/fixation.ts` |
| Change what counts as overhead | `FIELD_BEYOND` in `region-brainstem/src/field.ts` (degrees up and down); what a dive, a fly-over or a small thing is: the `LEAN` table in `lean.ts` |
| Stop wants drawing the eye | `bots.json`: `colliculus.wants: 0` (a goal's watched kinds still do; `topDown: 0` stops both) |
| Stop the defence taking the colliculus's advice | `bots.json`: `defence.lean: 0`; no leans at all: `colliculus.fields: 0` |
| Change what darkness hides | `LOST_IN_DARK` in `region-brainstem/src/darkness.ts`; off: `colliculus.darkness: 0` |
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
| Make a bot a heavier sleeper | `bots.json`: `arousal.wakeThreshold` (0.5 is usual; higher takes more to wake) |
| Change when it goes to bed | `BEDTIME` and `URGENCY` in `packages/region-brainstem/src/bedtime.ts`; how sleepy night and tiredness make it is `SLEEPY` in `arousal.ts`; a bot's strengths are `arousal.bedtime` and `arousal.sleepPressure` |
| Add something that wakes it | Nothing to list: anything that raises `startle`, `pain`, alarm, `threat` or the medulla's `urge` wakes it once it is stronger than depth × 0.6. To add a new kind, add it to `wakeDrive` in `arousal.ts` |
| Change which skill is bed, or what counts as restful | `packages/minecraft/src/brain/reticular.ts` |
| Change why sleep is not possible | `sleepProblem` in `packages/minecraft/src/skills/sleep.ts` |
| Change how low arousal slows the deciding layers | `rateOf` in `arousal.ts`; the usual intervals are `USUAL_MS` in `apps/run-bot/src/brain.ts`; a bot's strength is `arousal.gate` |
| Change a bot's bravery | `bots.json`: `brainstem.bravery` (0 timid, 1 brave) |
| Turn part of the brainstem off | `bots.json`: set its strength in `brainstem` to 0 |
| Add a need | `packages/minecraft/src/brain/needs.ts`: write its level with `need(...)` (or `fromBody(...)` for one of the medulla's signals) and add it to `playerNeeds` (or `bodyNeeds`). Dopamine, serotonin, noradrenaline and the arbiter follow it with no further code. |
| Change a target, or what moves it | `FOOD_STOCK_TARGET`, `TORCH_TARGET` and the `TARGET_ADJUSTMENTS` table in the same file; how running out raises it is `LEARNING` in `packages/region-hypothalamus/src/targets.ts`; a bot's strengths are `drives.targets` and `drives.learnTargets` |
| Make a bot prepare earlier | `AHEAD` in `packages/region-hypothalamus/src/ahead.ts` (how far ahead, and how much a projection presses); what is known to be coming is `COMING` in `needs.ts`; dusk's length is `CLOCK` in `clock.ts`; a bot's strengths are `drives.lookAhead` and `drives.clock` |
| Make a bot more anxious | `STRESS` in `packages/region-hypothalamus/src/stress.ts` (how fast it builds and fades); a bot's strengths are `drives.stress`, `patience.stress` and `arousal.stress` |
| Change how much a need weighs | `bots.json`: `drives.weights` (by class) or `drives.weight` (one need by name) |
| Change when a need is desperate, or how sticky the top drive is | `COMPETE` in `packages/region-hypothalamus/src/compete.ts` |
| Add a reward for something that happens | `packages/minecraft/src/brain/rewards.ts` (write a rule, add it to `playerRewards`) |
| Change the scorebook's situation labels | `packages/minecraft/src/brain/situation-labels.ts` |
| Change what the outlook or alarm follow | Nothing to list: both follow the needs. Add or change a need (above). |
| Change what moves search | The `searchInputs` list of the noradrenaline region in `apps/run-bot/src/brain.ts` (an input is `{ name, read }`, see `search.ts`) |
| Add or remove a focus input | `packages/minecraft/src/brain/focus.ts` (edit `playerFocus`) |
| Change what the bot remembers | `packages/minecraft/src/brain/memories.ts` (edit `playerMemories`) |
| Change what Jev is asked | `packages/minecraft/src/player-questions.ts` or `src/brain/instinct.ts` |
| Change what the planner sees | `packages/minecraft/src/brain/situation.ts` |
| Add or change a rule about who wins | A term: one small file in `packages/basal-ganglia/src/terms/`, listed in `createArbiter` in `apps/run-bot/src/brain.ts`. What the terms read is in `apps/run-bot/src/selection-inputs.ts`. Check with `pnpm replay-selection <logs>` |
| Make reflexes stronger against the deciders | `selection.bodyFirst` in `bots.json` (0 to 1), or `BODY_FIRST` in `packages/basal-ganglia/src/terms/body-first.ts` for every bot |
| Add a channel | One entry in `CHANNELS` in `apps/run-bot/src/body-channels.ts` (the executor has one place beside the main skill, so a third channel also needs a place there) |
| Make a bot more a creature of habit | `selection.habits` (how fast they form) and `selection.habit.blind` in `bots.json`; the thresholds are `HABIT` in `packages/basal-ganglia/src/habits.ts` |
| Change what counts as "nothing notable" for a habit | `notable` in `apps/run-bot/src/habits.ts` |
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
pnpm start -- --engine jev --same-time               # only with selection.channels 0: let a look run alongside a skill that leaves the head free
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
