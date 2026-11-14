# Findings to revisit

Things we noticed while building that work but may need attention later. Each entry says what we
saw, why it happens, and what would fix it. Newest first.

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

**Status.** Open.

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
