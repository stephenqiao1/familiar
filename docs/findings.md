# Findings to revisit

Things we noticed while building that work but may need attention later. Each entry says what we
saw, why it happens, and what would fix it. Newest first.

## Live testing, 2026-11-16: the primitives

*Found by running every primitive on the test server with `pnpm skill-check` (20 scenes, each run
once to completion and once interrupted), checked against an observer bot and the server console.*

**Found and fixed.** None of these showed up in the unit tests.

- **Items moved into a chest were not reported.** While a container is open, Mineflayer tracks the
  bot's own items in that window, not in `bot.inventory`, so the before-and-after snapshot saw no
  change. The snapshot now reads the open window when there is one.
- **`hit` did not report the target as hurt** when given no target. The wrapper only watched a
  named target. A primitive can now say what it acts on by default, and that is watched too.
- **A stopped dig on a very hard block reported progress 0.** One second into obsidian by hand is
  0.4% of the way. Progress is now kept to three decimals.

**Status.** Fixed. All 20 scenes pass.

## Primitives: looking while walking works by pressing other keys, with limits

*Found 2026-11-16 while building "different body parts at the same time" (`--same-time`).*

**What we saw.** The pathfinder walks by turning the head toward the next step and pressing
"forward", so at first no walking skill left the head free. Movement keys are relative to where
the head faces, though, so a held look (`packages/minecraft/src/primitives/gaze.ts`) now takes
the head and presses the same direction of travel as a combination of forward, back, left and
right. Live: the bot walked 9.7 blocks east with its head pointed north, stayed on its line, and
arrived. `go_to`, `return_to_base` and `flee` now leave the head free.

**Limits.**
- Keys give eight directions. A heading between two of them is walked by switching between the
  two nearest tick by tick, so it is right on average but wobbles slightly.
- The look gives way, for that tick, whenever the pathfinder jumps, swims, sneaks to an edge,
  digs or places a block. In rough ground the head flicks back to the path.
- Sprinting only works straight ahead, so the bot slows to a walk while it looks aside. While
  fleeing, a look costs speed.
- A look alongside a walk lasts one second, then the head goes back to the path.
- The storage skills, `attack`, `sleep` and the two escape skills still use the whole body.
- It reads and writes the pathfinder's keys around its tick. A new pathfinder version that
  steers differently could break it; the live check (`pnpm skill-check walk_and_look`) would show it.

**Status.** Open (the limits). The mechanism works.

## Primitives: a look that runs alongside is invisible to the rest of the brain

*Found 2026-11-16 (`apps/run-bot/src/loop-mode.ts`).*

**What we saw.** A movement run alongside the main skill is logged (in `skillEvents` with
`alongside: true`, and as the tick's `alongside`), but it is not added to the workspace. Dopamine
does not learn from it and patience does not time it.

**Why.** Those regions assume one skill at a time: a second "started" event while another skill
runs would be read as the first one ending.

**What would fix it.** Teach episodes and persistence about side movements, once one matters.

**Status.** Open.

## Primitives: what `changes` cannot see

*Found 2026-11-16 (`packages/minecraft/src/primitives/snapshot.ts`).*

**What we saw.**
- The target block's **type** is compared, not its state. Opening a door changes nothing in
  `changes` (the block is still `oak_door`), so `use_on` expects nothing and is always "as expected".
- `targetHurt` comes from the game's hurt event, which only arrives if the target is in view.
- `drops` counts dropped items within 5 blocks before and after. A block's drop that lands
  further away, or is picked up at once, shows as `gained` or not at all.
- `jump` reports `moved` of about 1.2: the snapshot is taken at the top of the jump.
- `look_at`, `brace`, `jump`, `use_item`, `use_on` and `move_item` expect nothing, so
  `asExpected` is true whenever they finish.
- The snapshot waits 100 to 300 ms after the movement for the world to catch up. A slower effect
  (a crop growing, a mob dying later from fire) is missed.

**What would fix it.** Compare block states as well as types; let each primitive name a sharper
expectation as the prediction checker needs it.

**Status.** Open.

## Live testing: a bot that logged out far from base would not start

*Found 2026-11-16 re-running `pnpm neuro-check` after the primitives work.*

**What we saw.** After the ambush scene the bot had fled 73 blocks from base. On its next start
it stopped with "No chest within 16 blocks of spawn": the saved base's blocks were not loaded
from where it stood, which was read as the base being gone. The scene runner then hung instead of
reporting it.

**Why.** Before the brainstem layer the bot fought or fled a short way; with defence by distance
it keeps retreating while the zombie follows. The base check was always this fragile.

**What we did.** A saved base that is too far to see is kept; only a base whose blocks can be
seen to be gone is replaced. Every scene now starts by bringing the bot to base, and the runner
reports a bot that fails to start.

**Status.** Fixed. Still open: the bot flees a long way from a single zombie and does not come
back by reflex; getting home is left to Jev and the planner.

## Live testing: the night and dark scenes depend on what Jev picks

*Found 2026-11-16 re-running `pnpm neuro-check` after the primitives work.*

**What we saw.** In one full run the `night` scene failed (the bot idled all night) and the `dark`
scene failed (focus stayed at 0.5). Both passed when re-run with no code change.
- Night: Jev was offered `idle` and `sleep` and preferred idle (0.72 to 0.28) on every tick. The
  planner's goal was "check the base chest for supplies, then sleep".
- Dark: Jev chose `sleep` 500 blocks from the bed. The skill spent the scene walking there, and a
  running `sleep` counts as rest, which pulls focus down even though the bot is walking in the dark.

**Why.** Nothing but Jev decides to go to bed, and "restful" is judged by the skill's name, not
by what the bot is doing.

**What would fix it.** Count `sleep` as restful only once the bot is in bed; consider a soft
"sleepy at night" reflex so bedtime does not rest on Jev alone.

**Status.** Open.

## Same-time: a reflex that fired blocked the look beside its own skill

*Found 2026-11-16 in the `glance` scene.*

**What we saw.** A zombie appeared while the bot was eating. No look ran alongside, because the
"eat when starving" reflex had fired that tick and a look is only proposed when no reflex spoke.

**What we did.** A look that runs alongside the running skill takes nothing from it, so it is now
proposed whatever reflexes fired. Live: the bot looked at the zombie and kept eating.

**Status.** Fixed.

## Primitives: things left as they are

*Found 2026-11-16.*

- **`step` takes one block, not "one or two".** A target carries a direction but no count. Two
  steps is two calls (or a two-step chain).
- **`sneak` and `open` leave something held on purpose.** Sneaking stays on until the next `sneak`
  or `brace`; a container stays open until `close` or the next primitive that is not container
  work. A chain always ends tidy (keys released, window closed).
- **`item:<name>` is a fourth new target format.** The spec listed three (`ahead`, `dir:`,
  `held`), but `equip`, `craft` and `move_item` need to name an item.
- **`dir:forward` is the block beside the bot's feet,** not at eye level. `dir:up` is the block
  above its head.
- **`use_on` a bed waits until the bot is lying in it,** and fails with the game's reason by day.
- **`pick_up` and `step_toward` walk with the pathfinder,** so they use the head as well as the legs.
- **Eating changed slightly.** `eat` now holds the food through the shared `use_item` function,
  which watches for the food being used up, instead of Mineflayer's `consume()`. Live it behaves
  the same (the hunger scene passes), but a bite now ends on the item count or food bar changing.
- **The old skills check moved.** `pnpm skill-check` now runs the primitives pass. The older
  script that drives each full skill through the CLI is `pnpm skill-check:skills`; it was written
  for an earlier world and container and has not been re-run.
- **Learned skills are on Jev's menu like any skill,** with whatever description the file gives.
  Nothing checks that a chain is useful or safe beyond each step's own checks.

**Status.** Open, by choice.

## Live testing, 2026-11-15: the spinal cord and brainstem layer

*Found by running the real bot on the test server with `pnpm neuro-check` (scenes `lava`,
`drowning`, `far`, `loaded`, `hold`, `bang`, `brave`, `timid`, `sleepgate`) and reading the logs
with `pnpm brain-report`. Nothing here showed up in the automated tests.*

**Found and fixed.**

- **Mineflayer's air level is wrong on 1.21.11.** `bot.oxygenLevel` fell to 0 on dry land. On
  newer versions Mineflayer sets it from *any* entity's air, so a mob in water nearby makes the bot
  look breathless. Air is now read from the bot's own entity (`packages/minecraft/src/body.ts`).
- **The bot stayed "on fire" after dying.** The server only sends flags that changed, and a new
  body's flags are the defaults, so the old burning flag was never cleared. `escape_hazard` then
  ran for good. The flags are now reset on death and respawn.
- **Explosions are not heard through Mineflayer's sound event.** A real TNT blast produced no
  `soundEffectHeard` at all, and the sound names that do arrive are off on this version (a fire
  being put out arrived named as an explosion). Explosions are now read from the server's own
  `explosion` packet. This is not a public Mineflayer event, which the spec asked to avoid; it is
  five lines and Mineflayer uses the same packet itself.
- **`escape_hazard` hopped over the water instead of into it.** It held jump the whole way, so it
  bounced above a one-block pool while still burning, and died. It now jumps only in lava or
  against a ledge.
- **A fright interrupted the bot's own escape.** Lava damage made alarm jump; the interrupt stopped
  `escape_hazard`, which restarted a tick later, costing about 200 ms in lava. An interrupt no
  longer stops a skill a hard reflex is running.
- **An alarm jump wiped a "hold back" goal the moment the threat appeared.** Interrupts clear the
  goal. A goal that prepared for trouble (it has `ifThen` or `holdBack`) is now kept.
- **A look at urgency 0.35 never won.** Idling scores about 0.9 once its learned value and stay
  bonus are added. A look is now proposed at full urgency, but only when the bot is idle (or doing
  nothing) and no reflex, startle or loaded response spoke on the same tick. This departs from the
  spec's number to keep the spec's intent ("it only beats idling").
- **Jev fled from a far zombie by itself.** The reflexes stayed quiet at 12 blocks, as designed,
  but Jev picked `flee` (its instructions said to attack or flee within 16 blocks). The
  instructions now say to leave alone anything more than 8 blocks away or unable to reach the bot.
  In the next run Jev kept idling (flee at 0.11 to 0.17). This is persuasion, not a guarantee.
- **Sleep was treated as a skill taking too long.** Over a full night the "give up" clock would
  stop it. Being asleep and undisturbed now restarts that clock each tick.

**Seen, left as it is.**

- **Lava is only survivable with health and water to spare.** Lava does 4 damage every half
  second, and the bot keeps burning afterwards. From full health with water 3 blocks away the bot
  got out in 0.6 s and lived (lowest health 13). From 11 health, before the fixes above, it died.
  With no water within 6 blocks it stands still and burns, which can kill it.
- **Claude loaded a response nobody asked for, and it fired at a zombie that could not reach the
  bot.** In the `far` scene Claude's own plan carried "if zombie then attack". The zombie appeared
  12 blocks away across a gap and the bot started `attack`. Loaded responses fire on sight; they do
  not check distance or whether the thing can reach the bot. The `far` scene now uses a fixed plan.
- **Brave and timid, one run each.** Same ambush, armed, zombie 6 blocks away. Brave (0.8): flee
  gain 0.85, attack gain 1.48; it attacked once and never fled. Timid (0.2): flee gain 1.40, attack
  gain 0.98; it fled 5 times and attacked 5 times. Where each bot stood when the zombie appeared
  was not controlled (they wander the plaza), so the distances are not comparable.

- **Holding back flee killed the bot in one run of two.** In the `hold` scene `last_stand` pulled
  the bot out at 3 health both times. In the second run the zombie came back; the held-back flee
  reflex fired at 0.26 and lost to Jev, which tried `attack` (refused at low health), and the bot
  died. The run printed `!! DIED WITH DEFENCE OVERRULED` with the gain (0.36). `last_stand` only
  covers a hostile within 4 blocks, and nothing lifts a hold-back once the bot is badly hurt.
- **The sleep gate over a full night.** 515 s asleep; instinct and the planner were paused for
  502 s. Jev: 137 calls made, 1009 saved, none while paused. About 33 planner runs saved. A hit at
  300 s woke both on the same tick, and the bot went back to sleep.
- **At dawn `sleep` is started and refused about 65 times.** Mineflayer says it is still night
  until the day counter turns over, but the game stops allowing sleep a little earlier. Not new,
  and unseen before because the night was always skipped when the only player slept.

**Status.** Fixed, except the items above.

## Brainstem: "can it reach me" is a guess

*Found 2026-11-15 while building defence by distance (`packages/minecraft/src/encode/scan-mobs.ts`).*

**What we saw.** A hostile counts as reachable when it is within 3 blocks of the bot's height and
nothing solid is between its eyes and the bot's. A zombie across a pit at the same height counts
as reachable. One behind a fence or glass does not, though it may walk round.

**Why.** Real reachability needs a path search per mob per tick, which is too slow.

**What would fix it.** Run the pathfinder for the nearest one or two hostiles only, every second or
so, and cache the answer.

**Status.** Open.

## Brainstem: a far threat gets no reflex, even one that shoots

*Found 2026-11-15 (`packages/minecraft/src/brain/reflexes.ts`).*

**What we saw.** Beyond 8 blocks no defence reflex fires. A skeleton shoots from 16. The bot only
looks at it until it is hit (which startles it) or the skeleton comes within 8.

**Why.** The zones are the same for every mob. Ranged mobs are only special in contact (always
flee, never attack).

**What would fix it.** Give ranged mobs a wider "approaching" zone, as far as they can shoot.

**Status.** Open.

## Brainstem: an unreachable mob close by still keeps alarm up

*Found 2026-11-15 (`packages/minecraft/src/brain/alarm.ts`).*

**What we saw.** The reflexes treat a hostile that cannot reach the bot as far. Alarm does not: it
counts any hostile within 8 blocks as a threat, so alarm will not fade while a zombie stands
behind a wall. Reflex gains stay high and ticks stay fast.

**Why.** The spec said to keep alarm's existing rules. Alarm and the reflexes now disagree on what
a threat is.

**What would fix it.** Have `threatPresent` and `hostile_appeared` use the same zones.

**Status.** Open.

## Brainstem: the first tick of a threat is damped

*Found 2026-11-15 (`apps/run-bot/src/brainstem-behaviour.test.ts`).*

**What we saw.** When a hostile appears, the reflex fires with last tick's alarm (0), so its gain
is 0.6: fleeing is proposed at 0.42, which Jev can outvote. One tick later (150 to 500 ms) alarm
has risen and the gain is above 1.

**Why.** The reflex region is listed before noradrenaline, so it reads alarm one tick late. The
spec allowed this. A hostile first seen within 3 blocks is covered by the startle (urgency 1).

**What would fix it.** List noradrenaline before reflex, or compute this tick's alarm bump inside
the gain.

**Status.** Open.

## Brainstem: a close ambush now takes the planner offline every time

*Found 2026-11-15 (`packages/minecraft/src/brain/alarm.ts`).*

**What we saw.** A hostile appearing within 3 blocks raises alarm by 0.6 (hostile appeared) plus
0.3 (startle), to 0.9. Above 0.8 the planner goes offline until alarm is back under 0.5.

**Why.** Triggers add up. Before the startle existed the same ambush reached 0.6 unless the bot
was also hit.

**What would fix it.** Take the larger of the two instead of the sum, or lower the startle's share.

**Status.** Open. It seems right for an ambush; revisit if the planner is offline too often.

## Brainstem: holding back flee leaves an unarmed bot with nothing until last_stand

*Found 2026-11-15 in the `hold` scene.*

**What we saw.** With `holdBack: ["flee"]` the flee reflex fired 41 times at gain 0.30 to 0.42
(urgency at most 0.38) and never won. The bot stood its ground, fell to 3 health, and `last_stand`
then pulled it out at urgency 1. It lived.

**Why.** That is the design: defence is tunable, and the cost is real. Naming a skill in
`holdBack` damps every soft reflex that proposes it, in every zone. If the bot dies this way the
run prints `!! DIED WITH DEFENCE OVERRULED` (only if the reflex was overruled in the 10 seconds
before the death, with a hostile within 8 blocks).

**What would fix it.** Nothing needs fixing. If it proves too costly: raise `last_stand`'s health
threshold, or let the planner hold back one zone at a time.

**Status.** Open, by design.

## Brainstem: most strengths are on or off

*Found 2026-11-15 (`packages/region-brainstem/src/settings.ts`).*

**What we saw.** `gains` and `holdBack` scale smoothly from 0 to 1. `startle`, `orienting`,
`loadedResponses`, `arousalGate` and `bodySignals` are on above 0 and off at 0.

**Why.** There is no natural "half a startle". The noradrenaline and focus effects work the same way.

**What would fix it.** Give each a meaning for in-between values (e.g. startle strength scales the
alarm it adds).

**Status.** Open.

## Brainstem: startle and orienting miss some things

*Found 2026-11-15 (`packages/minecraft/src/brain/brainstem.ts`).*

**What we saw.**
- Damage with no attacker (a fall, fire, hunger) does not startle. Otherwise a starving bot would
  startle every 5 seconds.
- An explosion startles, but the state does not say which way it was, so the bot braces without
  turning. Thunder and other loud sounds are not sensed at all.
- A look happens once, when a hostile or player first comes into view within 16 blocks. Friendly
  mobs and blocks never draw a look.

**What would fix it.** Add the explosion's position to `nearby.loud`; add thunder once sound names
can be trusted on this version.

**Status.** Open.

## Brainstem: a cue can wake a sleeping bot

*Found 2026-11-15 (`packages/region-brainstem/src/brainstem-region.ts`).*

**What we saw.** While asleep and undisturbed, Jev is paused, so the brainstem proposes staying
with `sleep` at urgency 0.5. Dopamine's cues (at most 0.3) lose to that. A focus cue pulse (0.6)
would win and get the bot out of bed. Not seen live.

**Why.** Something has to speak for staying asleep once Jev is silent, and 0.5 is a guess.

**What would fix it.** Skip cue pulses while `upper_paused` is up.

**Status.** Open.

## Primitives: two are not quite "tiny", and most are untested live

*Found 2026-11-15 (`packages/minecraft/src/primitives/`).*

**What we saw.**
- `break_block` runs until the block breaks, which can take many seconds. Digging cannot be
  paused and resumed, so it cannot be cut into one-second pieces.
- `use_item` starts using the item and returns after a quarter of a second; the item stays in use
  (eating carries on) until something else stops it.
- Only `look_at` and `brace` have run on the server. The others have no tests: they are thin
  wrappers over Mineflayer calls that need a real world.
- Body signals (`air`, `pain`, `hunger`) are shared but nothing reads them yet.

**What would fix it.** A `skill-check` pass for each primitive on the test server.

**Status.** Closed 2026-11-16. `use_item` now holds until the use finishes or 3 seconds, then
always lets go. `break_block` is marked `long`, reports its progress, and stops cleanly. All 19
primitives have unit tests and a live scene (`pnpm skill-check`): each completed, was interrupted
cleanly, and reported changes that matched what an observer bot and the server saw. Body signals
still have no reader (that is a later drives region, not a primitives gap).

## Live testing, 2026-11-14: what was found and fixed

*Found by running the real bot (Jev + Claude) on the test server with `pnpm neuro-check`, and
reading each run with `pnpm brain-report`.*

Seven scenes now pass: calm, ambush, remembered (restart), hunger, night (sleep), dark, and a
five-minute mixed soak. These problems only showed up live, and are fixed:

- **Sleep woke itself up.** Once in bed, `sleep` could not be started again, so it dropped off
  Jev's menu, Jev picked `idle`, and that got the bot out of bed. The running skill is now always
  on the menu, marked "in progress". (This was the earlier "stay bonus" finding, seen for real.)
- **Dopamine was pinned near its ceiling.** Everything in view on joining counted as new at once,
  and DA followed the total of recent reward, not its rate. Several new things at once now pay at
  most one full bonus, and DA's gain is lower, so it keeps room to move (mean 0.74 over the soak).
- **A good surprise raised alarm.** Escaping a zombie, or meeting something new, is a big surprise;
  it tripped alarm and took the planner offline. Only a bad surprise raises alarm now.
- **Dopamine wanted to walk up to a skeleton.** Seeing a new mob while walking toward it taught
  "going to skeletons pays off". Cues now fire only for friendly mobs, useful blocks and players.
- **A zombie at the edge of range kept re-alarming.** Each step across the 8-block line was a new
  "hostile appeared". The same mob coming back within 30 s is no longer a new threat, and one
  ambush is one memory.
- **Skills that did nothing were restarted every tick.** `flee` with nothing to flee from and
  `return_to_base` at base ended at once and were picked again (124 starts in 73 s). They can no
  longer run when they would do nothing.
- **A skill that finished mid-tick was restarted, and failed.** The choice to keep going arrived
  just after it finished. That is now ignored.
- **"Cannot run" counted as a failure.** It cost reward and lowered the outlook. It no longer does.
- **Tiny rewards wore down real ones.** Health coming back a sliver at a time counted as repeats,
  halving the reward for real healing. Small rewards now count for little.
- **The biome was always unknown,** because its name is empty on this Minecraft version. It is
  looked up by id now.
- **Night was not dark.** Sky light does not change with the time, so the light level read as full
  at midnight. It is dimmed at night now, the way the game does it.
- **The sleep reward was missed,** because the clock still read "night" for a tick after waking.
- The bot can now tell it is asleep (Mineflayer reports it), and a close call with a hostile is
  remembered even when no damage is taken.

**Not yet exercised live** (covered by automated tests only): the cue pulse, the learning window's
effect over time, search climbing on a dead-end goal and telling the planner, the panic lock,
giving up on a skill, a remembered chest being rejected at high focus, general facts from three
matching memories, and two bots with different temperaments side by side.

**Status.** Open: run those scenes next.

## Live testing: the bot mostly idles at base

*Found 2026-11-14 in the five-minute soak.*

**What we saw.** With nothing threatening it, the bot spends most of its time on `idle` at base.
The planner sets goals like "explore to find oak trees", but nothing carries them out.

**Why.** There are only eight skills, and none gathers, builds or explores. This is not a
neuromodulator fault, but it limits what they can be seen to do: search, giving up and cues need
goals that take effort.

**What would fix it.** More skills (gather, explore, build), then re-run the live scenes.

**Status.** Open.

## Live testing: Jev sometimes times out

*Found 2026-11-14 in several live runs.*

**What we saw.** A few ticks per run fail with "Jev request failed: Request timed out after 1500ms".
On those ticks instinct proposes nothing, so only reflexes and cues can act.

**Why.** The Jev call has a 1.5 second limit and occasionally exceeds it.

**What would fix it.** Reuse the last answer for a tick or two when Jev is late.

**Status.** Open, low priority (under 1% of ticks).

## Focus: the learning window slows learning from quiet disappointments

*Found 2026-11-14 while building focus (`packages/neuromodulators/src/dopamine/dopamine-region.ts`).*

**What we saw.** With the learning window on, skill values are fully updated only within 2 seconds
of a notable event (a reward of 0.1 or more, a death, an alarm jump, a cue). When a skill ends and
nothing happened (it expected a reward and got none), no window is open, so the update is a fifth
of its usual size.

**Why.** The window is opened by events, and "nothing happened" is not an event. This makes the
earlier finding worse: the urge to check an emptied chest now fades five times more slowly.

**What would fix it.** Treat a skill ending well short of what was expected as notable too, or add
the "wasted time" penalty so an empty trip produces a reward signal.

**Status.** Open. Turn it off with `learningWindow: 0`.

## Focus: only chest contents are checked for trust

*Found 2026-11-14 while building focus (`packages/minecraft/src/chest-memory.ts`).*

**What we saw.** "Use a remembered value only if trust is above focus" applies to chest contents
alone. That is the only remembered value the bot acts on today. Where a resource was, or where
another player was last seen, is not remembered at all, and event memories given to the planner are
not trust-checked (they fade by strength instead).

**Why.** The state is almost all live perception; nothing else is carried over from the past.

**What would fix it.** When last-seen positions are added, route them through the same trust check.

**Status.** Open.

## Focus: the attention budget is a count, not a size limit

*Found 2026-11-14 while building focus (`packages/neuromodulators/src/acetylcholine/attention.ts`).*

**What we saw.** The state has no overall size limit to spend. Focus instead sets how many of each
kind of nearby thing are kept (6 to 14) and how many memories the planner is given (7 down to 3).
How far the bot looks does not change. The "swamped" guardrail counts ticks where any nearby list
reached its limit.

**Why.** Each scanner has its own fixed range and count; there is no shared budget.

**What would fix it.** Give the encoder one budget (e.g. a number of items across all lists, filled
by priority), and let focus trade range against detail.

**Status.** Open.

## Focus: a cue only fires for kinds of things the planner named

*Found 2026-11-14 while building focus (`packages/minecraft/src/brain/focus.ts`).*

**What we saw.** The cue pulse fires when something in the goal's `watchFor` list (kinds of things,
set by the planner) is seen twice in a row. The bot then gets a proposal to `go_to` it for 5
seconds. There is no extra decision tick: the proposal is made in the tick the cue is confirmed,
so the delay is at most one tick. Items the goal wants are not watched for, and the only action is
going there.

**Why.** Goals had no target, so `watchFor` was added; the things in view are mobs, players, useful
blocks and hazards; and `go_to` is the only skill that heads toward a thing besides `take_items`.

**What would fix it.** Watch for chests known to hold a wanted item; let the planner name the
skill to use on a cue.

**Status.** Open.

## Focus: memories are consolidated only while the sleep skill runs

*Found 2026-11-14 while building focus (`apps/run-bot/src/brain.ts`).*

**What we saw.** Consolidation needs focus under 0.2 and alarm under 0.2. Focus is forced that low
only while "asleep", which means the `sleep` skill is running, not that the bot is actually in bed.
Resting safely while awake almost never gets focus under 0.2, so a bot that never sleeps never
consolidates and never forms general facts.

**Why.** The state does not say whether the bot is asleep, and the inputs that lower focus (routine,
idling, a well-known place) rarely add up to enough.

**What would fix it.** Add "is sleeping" to the state; count a long safe idle at base as rest too.

**Status.** Open.

## Focus: only skills can mark a task as demanding

*Found 2026-11-14 while building focus (`packages/minecraft/src/brain/focus.ts`).*

**What we saw.** The "task needs care" input reads a `demanding` flag on the running skill, and only
`attack` has it. The planner cannot mark a goal as demanding.

**Why.** Kept small: a plan field for it was left out. There is a TODO in `focus.ts`.

**What would fix it.** Add a "needs care" flag to the plan, and flag more skills as they are added.

**Status.** Open, low priority.

## Alarm: faster ticks mean more Jev calls

*Found 2026-11-14 while building alarm and search (`apps/run-bot/src/loop-mode.ts`).*

**What we saw.** As alarm rises, the time between ticks drops from 500 ms to as little as 150 ms.
Instinct asks Jev every tick, so a long fight can more than triple the rate of Jev calls.

**Why.** "Shorten the decision interval as alarm rises" was applied to the whole tick, and every
tick runs every per-tick region.

**What would fix it.** Run only the reflexes on the extra ticks, or cap how often instinct asks Jev.

**Status.** Open. Worth checking the cost before long live runs. Turn it off with `focus: 0`.

## Alarm: the planner's weight has only three levels in practice

*Found 2026-11-14 while building alarm (`packages/minecraft/src/brain/instinct.ts`).*

**What we saw.** `plannerWeight = 1 − alarm²` is computed and logged as a smooth number, but it
changes behaviour in three steps: the goal is shown to Jev in full, shown as "less important right
now than staying safe" (weight under 0.75), or left out (planner offline).

**Why.** The arbiter never weighs the planner's goal: the planner only writes a goal, which reaches
behaviour through the text Jev is given. There is nothing in the arbiter to scale.

**What would fix it.** Let the planner (or a region acting for it) propose actions, so the arbiter
can scale those proposals by the weight.

**Status.** Open.

## Alarm: an interrupt has little to cancel

*Found 2026-11-14 while building alarm (`packages/neuromodulators/src/noradrenaline/noradrenaline-region.ts`).*

**What we saw.** On a sudden jump, an interrupt clears the goal and stops the running skill (if
nothing new replaces it that tick), then asks for a new plan once calm. The spec also says to
cancel the current plan step and clear short-term working notes: neither exists yet.

**Why.** Plans are a goal with a list of steps; nothing executes a step or keeps working notes.

**What would fix it.** Nothing until those exist. When they do, clear them where the goal is cleared.

**Status.** Open.

## Alarm: narrowing attention hides things, which then look new again

*Found 2026-11-14 while building alarm (`packages/minecraft/src/encode/encode-state.ts`).*

**What we saw.** Above alarm 0.6 the state drops friendly mobs and useful blocks. When alarm falls
they reappear, so novelty counts them as coming into view again (a smaller, halved reward), and
dopamine's cues toward them vanish while alarm is high. Also, "keep escape routes" is not done: the
state has no notion of an escape route.

**Why.** Narrowing is done by leaving things out of the state, and other parts read the state.

**What would fix it.** Keep the full state for the brain's own bookkeeping and narrow only what Jev
is shown; add an escape-route sense (e.g. the nearest open direction away from the threat).

**Status.** Open.

## Alarm: some triggers can't be sensed yet

*Found 2026-11-14 while building alarm (`packages/minecraft/src/brain/alarm.ts`).*

**What we saw.** Alarm rises on damage, a hostile appearing close by, and a big surprise. Two
triggers from the design are missing: a hostile targeting the bot, and a loud nearby event (an
explosion, another player being attacked). The focus-dial check on surprises (Step 6) is also
skipped, since there is no focus dial yet.

**Why.** The state doesn't say who a mob is after, and explosions or other players' fights aren't
sensed. There are TODO comments for all three in `alarm.ts`.

**What would fix it.** Add those senses to the state, then one small trigger each.

**Status.** Partly done 2026-11-15: explosions are sensed and reach alarm through the startle. A
hostile targeting the bot and another player being attacked are still missing.

## Alarm: the forced retreat goal can be overwritten

*Found 2026-11-14 while building the panic-lock guardrail.*

**What we saw.** After a minute of alarm above 0.8, a retreat-to-safety goal is set. The planner is
paused while alarm is that high, so the goal holds. But as soon as alarm drops below 0.5 the planner
runs again and may replace it, even if the bot has not reached safety.

**Why.** The retreat goal is an ordinary goal; nothing marks it as one to keep.

**What would fix it.** Hold the retreat goal until a "safe" condition is met (no threat, at base or
sheltered), or tell the planner in its prompt that a retreat is in progress.

**Status.** Open.

## Search: "wider options" only offers more of Jev's picks

*Found 2026-11-14 while building search (`packages/minecraft/src/brain/instinct.ts`).*

**What we saw.** When search is above 0.6, instinct proposes Jev's top 5 options (down to 5%
likely) instead of its top 3. It does not add things further away or less familiar, as the design
suggested.

**Why.** How far the bot looks is fixed in the state scanners, and Jev is already asked about every
skill that can run.

**What would fix it.** Let the scan ranges grow with search, or add remembered places as targets.

**Status.** Open.

## Search: the goal-hopping guardrail counts every dropped skill

*Found 2026-11-14 while building search.*

**What we saw.** The guardrail should fire when search *causes* more than 4 goal switches in 5
minutes. It counts every skill dropped for another while search is above 0.6, whatever the cause
(a reflex interrupting counts too).

**Why.** Nothing records why the arbiter picked a different skill, only that it did.

**What would fix it.** Have the arbiter say when the reduced stay bonus changed the winner, and
count only those.

**Status.** Open.

## Memory: recalling keeps the same few memories strong

*Found 2026-11-14 while building memory (`packages/memory/src/memory.ts`).*

**What we saw.** The planner is given the top 5 memories every 15 seconds, and each recall bumps a
memory's strength. The same few memories near the bot keep getting stronger, and others fade.

**Why.** Recall strengthens by design, and the planner recalls often.

**What would fix it.** Bump strength only when a recalled memory was actually used, or cap how
often one memory can be bumped.

**Status.** Open.

## Memory: summaries and place names are plain

*Found 2026-11-14 while building memory (`packages/minecraft/src/brain/memories.ts`).*

**What we saw.** Summaries are built by code from what the state holds, so they are generic:
"Something went well while doing eat in plains", and places are named like "danger: zombie". There
is no "near the river" or "cave entrance", and no social memories.

**Why.** The state has a biome and what is nearby, but no landmarks; social features don't exist.

**What would fix it.** Add landmark sensing (water, cave mouths, structures) to the state, and a
social trigger once the bot can trade or chat.

**Status.** Open.

## Shelter: the check only looks straight up and straight out

*Found 2026-11-14 while simplifying the shelter check to "a roof and three walls"
(`packages/minecraft/src/encode/scan-enclosure.ts`).*

**What we saw.** The bot counts itself as sheltered when there is a solid block overhead and on at
least three of its four sides, each within 6 blocks, looking in straight lines from head height.
That misses things:

- A gap that is not straight ahead (a doorway off to one side, a hole in the roof next to the
  bot) is not seen, so a leaky room can read as sheltered.
- One open side is allowed on purpose, so a three-walled alcove counts though mobs can walk in.
- In a room wider than 12 blocks, walls can be out of reach, so it reads as not sheltered.
- Doors, trapdoors and fence gates count as walls whether open or closed: the game data has one
  "solid or not" flag per block type.
- A single block counts as a wall: a tree trunk beside the bot is one "wall".

**Why.** We chose the simple, cheap check (5 short lines of blocks per tick) over a full scan of
the surrounding space. The full scan was accurate but cost up to 300 block checks per tick.

**What would fix it.** Go back to spreading through the open space around the bot (it finds any
gap), cached so it only reruns when the bot moves or a block changes. For doors, read the block's
`open` property.

**Status.** Open, low priority. Accepted trade-off for now.

## Patience: an input can honestly sit at 0 and still trigger the "check" warning

*Found 2026-11-14 while replacing the stuck-low warning with per-input checks
(`packages/neuromodulators/src/serotonin/input-health.ts`).*

**What we saw.** The serotonin region now warns when an outlook input has read 0 for 5 minutes.
Some inputs can do that without being broken: `light_and_shelter` is 0 for a whole night spent in
the open and dark, and `fed` is 0 for a starving bot with no food.

**Why.** The check cannot tell "broken" from "really that bad"; both look like a long run of 0.

**What would fix it.** Let an input opt out or set its own time limit, or only warn when the input
is 0 while the state it reads from says otherwise. Kept on purpose for now: a bot standing in the
dark all night is worth noticing too, and the warning says "check", not "broken".

**Status.** Open, low priority.

## Mood can't be shared between brain parts yet

*Found 2026-11-14 while building patience and mood (`packages/neuromodulators/src/mood.ts`).*

**What we saw.** Mood (-1 to 1) is only written to the log, in the dopamine region's trace. No
other brain part can read it.

**Why.** Brain parts share numbers through workspace signals, which are forced into 0 to 1.

**What would fix it.** Let `setSignal` take a range (e.g. `{ min: -1, max: 1 }`) stored with the
value, keeping 0 to 1 as the default so existing signals don't change (the `reward` signal relies
on negatives being cut to 0). Then the dopamine region shares `mood`. There are TODO(mood) comments
in `mood.ts` and `packages/contracts/src/brain.ts`.

**Status.** Open. Deferred until something needs to read mood.

## Planner steps: a finished step is noticed up to 15 seconds late

*Found 2026-11-14 while adding `stepsDone` to goals (`packages/region-prefrontal/src/prefrontal-region.ts`).*

**What we saw.** The planner says how many steps of the goal are done, but only when it runs,
every 15 seconds. Until then the bot does not know a step is finished.

**Why.** Only the planner (an LLM) judges steps, and it runs on a clock to keep calls down.

**What would fix it.** Have the planner give each step a simple "done when" condition that code
checks every tick (carrying an item, near a place, time of day), with Jev judging steps that fit
no condition. Then call the planner only when needed: no goal, all steps done, a step stuck, a
death or shock, and a safety net every few minutes. That also cuts LLM calls by roughly 10 to 20
times. Deferred on purpose: we chose not to optimize yet.

**Status.** Open.

## Planner steps: the count restarts if the planner rewords its steps

*Found 2026-11-14 while adding `stepsDone` to goals (`packages/region-prefrontal/src/prefrontal-region.ts`).*

**What we saw.** The steps-done count carries over only while the goal's steps stay exactly the
same. If the planner rewrites them even slightly, the count goes back to 0.

**Why.** "Same steps" is checked by comparing the text. Patience's progress input is not affected:
it uses the time a step was last finished, which is kept across goals.

**What would fix it.** Tell the planner to repeat unchanged steps word for word, or give steps
stable ids so a reworded step keeps its place.

**Status.** Open. Matters once something reads the count itself (e.g. showing Jev the next step).

## Planner steps: the echo planner never marks a step done

*Found 2026-11-14 while adding `stepsDone` to goals.*

**What we saw.** With the free `echo` planner no step is ever marked done, so patience's progress
input is only the share of recent skills that succeeded.

**Why.** Judging steps needs a real planner; echo returns a fixed plan.

**What would fix it.** Nothing needed for real runs (`--planner claude`). For offline runs, the
"done when" conditions above would work without an LLM.

**Status.** Open, low priority.

## Patience: the stay bonus only protects a skill that is proposed again

*Found 2026-11-14 while building persistence (`packages/neuromodulators/src/serotonin/persistence.ts`).*

**What we saw.** The running skill gets a stay bonus in the arbiter, so a challenger must be
clearly better to take over. But the bonus is added to the running skill's own proposal. If no
region proposes the running skill this tick, there is nothing to add it to, and any challenger
takes over freely.

**Why.** The arbiter only scores the proposals it is handed. Instinct proposes Jev's top 3
options, and the running skill is not always among them.

**What would fix it.** Always put the running skill among the candidates (a "keep doing this"
proposal at a modest urgency), so the stay bonus always has something to lift.

**Status.** Open.

## Patience: a skill the bot gave up on can be picked again at once

*Found 2026-11-14 while building persistence (`packages/neuromodulators/src/serotonin/persistence.ts`).*

**What we saw.** After the bot gives up on a skill, nothing stops Jev from picking the same skill
on the next tick. It restarts with a fresh clock.

**Why.** Giving up only ends the current run. Nothing tells instinct or the arbiter to avoid that
skill afterwards. It is softened, not prevented: each give-up counts as a failure, which lowers the
skill's chance of payoff, so the wait gets shorter each time; and past 3× the base time with no
success, the over-persisting guardrail ignores patience.

**What would fix it.** A short cool-off after giving up: leave the skill out of instinct's options,
or have the arbiter score it down, for a while.

**Status.** Open.

## Dopamine: disappointment fades the urge to check, but never ends it

*Found 2026-11-14 in the dopamine behaviour tests (`apps/run-bot/src/dopamine-behaviour.test.ts`,
"disappointment: then the chest is empty").*

**What we saw.** The test passes. After the bot learns that a chest holds food (10 good trips),
the chest is emptied:

- every empty trip gives a negative surprise;
- the learned expectation for `go_to→chest` drops more than 90%;
- the pull toward the chest (its cue boost) weakens on every trip.

But after 30 empty trips the pull is still above zero: below 10% of its peak, never gone. The
doc's test says the bot should "gradually stop checking". It only *nearly* stops.

**Why.** An empty trip is worth 0, not something negative. Each surprise is 0 minus what the bot
expects, so the expectation only shrinks toward 0 (by 10% a trip) and never crosses it. A cue fires
while the expectation is above 0, so it keeps firing, just more and more weakly.

**What would fix it.** Make a wasted trip cost something. The "wasted time" negative reward from
the reward table would do it; it is still a TODO in `packages/minecraft/src/brain/rewards.ts`.
Other options: a small minimum expectation before a cue fires, or treating a trip that found
nothing as a failed skill.

**Status.** Open. Deferred along with "wasted time".
