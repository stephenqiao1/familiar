# Findings to revisit

Things we noticed while building that work but may need attention later. Each entry says what we
saw, why it happens, and what would fix it. Newest first.

## Problems with the current design

*Written 2026-11-19 by reading every entry below. Nothing new was tested. Each item is a problem
that shows up in several findings and comes from how the brain is built, not from one bug. The
entries named in brackets hold the evidence.*

1. **One urgency number decides everything, and habit usually wins.** Every proposal competes on
   the same 0 to 1 scale. Jev's `idle` scores about 0.9 once its learned value and the stay bonus
   are added, so anything soft loses to it: a look at 0.35, the urge to breathe until air 7, bed
   at 0.2 to 0.6, a held-back flee, a starving sleeper. Each case was patched by itself (looks
   at full urgency when idle, the `urge` signal shrinking the stay bonus, upkeep skipping the
   gain), so the rules for who wins are now spread over several places. *(Reticular: "Jev outvotes
   bedtime"; medulla: "the urge at its strongest still lost to habit"; colliculus: "the spec's
   look urgency never wins"; "The first tick of a threat is damped".)*
   **Would fix:** rank by layer before urgency (a body need outranks a habit), or score the
   layers on separate scales that the arbiter combines by one stated rule.

2. **The planner can only talk to Jev.** A goal reaches behaviour as text in Jev's prompt. The
   arbiter never sees it, nothing carries out a step, and a finished step is noticed up to 15
   seconds late. So the planner's weight has three levels in practice, "leave far threats alone"
   is persuasion, a goal that says "stay still" can drown the bot, and the forced retreat goal
   can be overwritten. Its controls over the lower layers are coarse too: a hold-back is all or
   nothing and lasts as long as the goal. *("The planner's weight has only three levels";
   "An interrupt has little to cancel"; "Planner steps"; "The forced retreat goal can be
   overwritten"; medulla: "holding back is all or nothing".)*
   **Would fix:** let the planner (or a region acting for it) make proposals the arbiter can
   weigh, with a "done when" condition per step that code checks every tick.

3. **What the bot does depends on what Jev picks, and most live checks leave Jev out.** With Jev
   in, the same scene passes one run and fails the next. So the dependable checks run on
   reflexes alone, which shows that a reflex fires and its skill works, not that it wins in the
   real brain. The whole-brain results are mostly one or two runs each. *("The night and dark
   scenes depend on what Jev picks"; medulla: "the live scenes other than the dives run without
   instinct"; demo runner: "three demos do not show their limit every time"; "Jev sometimes
   times out".)*
   **Would fix:** a recorded or seeded Jev for scenes, and repeat counts for whole-brain runs.

4. **The brain assumes one skill at a time, and waits for it.** The loop does not tick again
   until a stopped skill has ended, so a skill that cannot be stopped stops every reflex (the
   chest that froze the brain for 20 seconds). A movement run alongside is invisible to dopamine
   and patience. Only one defence is chosen each tick, so a held-back flee is replaced by
   nothing. The stay bonus protects the running skill only if someone proposes it again.
   *(Medulla: "a skill that cannot be stopped stops every reflex"; "A look that runs alongside
   is invisible"; "Holding back flee leaves an unarmed bot with nothing"; "The stay bonus only
   protects a skill that is proposed again".)*
   **Would fix:** a deadline on stopping a skill, a standing "keep doing this" proposal, and
   episodes that know about side movements.

5. **Everything waits for a tick, and every tick runs everything.** The loop polls for change
   every 100 ms with ticks at least 150 ms apart, so a reaction starts 5 to 174 ms after its
   event and a fall is noticed up to half a second late. Regions run in a fixed order, so some
   signals arrive a tick late and are worked out twice instead (looming, this tick's threat).
   And a faster tick speeds up the costly parts too: alarm can triple the Jev calls, while a
   drowsy bot still ticks every 500 ms. *(Startle: "Speed"; posture: "the righting reflex needs
   a brain tick"; startle limits: "looming is read from the state"; "Faster ticks mean more Jev
   calls"; reticular: "drowsy ticks still run every 500 ms".)*
   **Would fix:** let a raw event wake the loop, and give the fast layers their own short tick
   that does not run instinct.

6. **One state serves both Jev and the brain's own bookkeeping.** Attention is narrowed by
   leaving things out of the state, and other regions read the same state. Things hidden by
   alarm look new when they come back, the field of view changes what Jev picks, and there is
   no single budget to spend: Jev is sent the whole state, which keeps growing. *("Narrowing
   attention hides things, which then look new again"; "The attention budget is a count, not a
   size limit"; colliculus limits: "the field of view filters only..." and "the state is
   bigger".)*
   **Would fix:** keep the full state for the brain and build a separate, budgeted view for Jev
   and the planner.

7. **Learning blames by timing and nearness, and mostly cannot unlearn.** A bad meal, a kill,
   a hurtful block, a self-caused bang and a dangerous player are all decided by "it happened
   within a few seconds, close by". Two coincidences teach a wrong fact, and several kinds of
   fact are then kept for good (a block that hurts, a player who is a threat). In the other
   direction, disappointment only shrank toward zero and never ended an urge (closed 2026-11-19:
   wasted effort now costs something, though only where a payoff was expected). *(Reflex limits:
   "blame is a guess" and "learning is all or nothing"; medulla limits: "blame for a bad meal is
   by timing alone"; defence: "kills are credited by timing", "fleeing a player by reflex may
   not be wanted"; "Disappointment fades the urge to check, but never ends it"; "The learning
   window slows learning from quiet disappointments".)*
   **Would fix:** graded confidence that fades without fresh evidence. (The cost for wasted time
   was added 2026-11-19.)

8. **The protections live in different places, and a journey slips past most of them.** Stance
   and self-caused are known only through the primitive wrapper, so skills that move the body
   directly are not covered. While the bot travels, the route checks, `about_to_touch`, `pushed`
   and the posture check are skipped on trust in the pathing rules, which is how a fleeing bot
   ran off the sky plaza and how a flight into a dead end goes unnoticed. The pathfinder's own
   digging teaches nothing. *(Posture limits: "only primitives get stance", "loose blocks are
   learned only from `break_block`"; defence: "while the bot is travelling the checks are
   skipped", "a flight hides a shove"; colliculus: "fleeing took the bot off the sky plaza
   once"; startle limits: "self-caused covers only what a primitive reports".)*
   **Would fix:** route every body movement through the one doorway, and run the cheap checks
   during a journey as well.

9. **Most thresholds are hand-set, and several strengths are on or off.** Zone distances (8, 16,
   48, 64 blocks), sound weights, balance numbers, time windows and the 0.5 that speaks for
   staying asleep were chosen by hand, each tuned in its own scene. Nothing checks them against
   each other, and a change to one moves which proposal wins elsewhere (problem 1). *(Startle
   limits: "those weights are hand-set"; posture limits: "the balance numbers are hand-set";
   "Most strengths are on or off"; locomotion limits.)*
   **Would fix:** one table of the numbers with what each was tuned against; a whole-brain
   regression that reports wins and losses when one changes.

10. **Signals are built before anything reads them.** `cold`, `reserve`, `vitals`, `stuck`,
    `headroom` and mood are worked out and logged with no reader; `sore` changes two numbers.
    Mood cannot be shared at all, because signals are forced into 0 to 1. The lower layers were
    built ahead of the drives region meant to use them. *(Medulla limits: "nothing acts on
    `cold`, `tired`, `reserve` or `vitals`"; locomotion limits: "the `stuck` signal has no
    reader"; "Mood can't be shared between brain parts yet".)*
    **Would fix:** build the drives region next, or stop adding signals until it exists.

11. **There is too little to do for the upper layers to show anything.** There are only a few
    skills and none gathers, builds or explores, so a safe bot idles at base. Search, giving up,
    cues and the planner's steps have little to act on and are mostly untested live. A bot that
    flees far does not come home by reflex. *("The bot mostly idles at base"; "Live testing,
    2026-11-14": "not yet exercised live"; "A bot that logged out far from base would not
    start".)*
    **Would fix:** gather, explore and build skills, then re-run the live scenes.

12. **The body is not a real player's body.** On 1.21.11 Mineflayer misreports air, knockback,
    projectile speed and sound names; pistons, slowness, soul sand and honey do not affect this
    client. The fixes read the server's own packets, which a new version can break, and some
    learning (slippery, slow) cannot happen on this body at all. *(Brainstem live testing;
    reflexes: "the bot could not be knocked back at all"; colliculus: "arrows never loomed",
    "sound names cannot be trusted"; posture: "slippery and slow cannot be learned on this
    body".)*
    **Would fix:** keep the packet readers in one place with a live check for each, and re-run
    them on every Minecraft or Mineflayer upgrade.

13. **Dopamine pays the running skill for whatever happens, and the rewards read any change as
    an achievement.** Credit goes by timing alone, so `idle` is paid for animals wandering up and
    wounds mending, and a respawn reads as health and food regained (a death netted +0.46 live).
    Rewards pay on the way up and cost nothing on the way down, so they can be looped. And what
    is learned is filed under one situation and one kind of thing, so it neither carries from day
    to night nor tells one chest from another. *("Live testing, 2026-11-19: dopamine".)*
    **Partly closed 2026-11-20:** rewards are now the signed change in a need, so a loop pays
    nothing, a death is a loss and `idle` nets about zero. Still open: credit goes by timing, and
    what is learned is filed under one exact label.
    **Closed 2026-11-20** for filing and credit: the scorebook is a sum of adjustments, and a
    skill is credited with the difference it made. A cue can now win (2026-11-21: its pull is what the thing would pay for the needs pressing right now), also for a remembered thing out of the state (same day).

**Status.** Open. A summary: when an entry below closes one of these, update it here too.

## Dopamine: a want that cannot be carried out is neither hammered at nor unlearned

*Built and run live 2026-11-21. Closes "a want that cannot be carried out is retried at once
and unlearned in seconds" (noted three times in the entries below).*

**The problem.** When `take_items` could not get to the chest it failed within a fraction of
a second, and the want proposed it again on the next tick. Each failure was learned as "this
chest gave nothing". Nine failures in three seconds took the want from 0.9 to nothing; 29
started-and-dropped trips near a standing husk took it from 0.86 to 0.5. A few seconds of bad
luck erased what many good trips had taught. Seen from three different causes in one day (a
route blocked by a threat's avoid area, a death that moved the bot away, a threat on the only
route), so the weakness was dopamine's own.

**The change: two rules, both general.**
- **A run that failed did not finish either** (`dopamine-region.ts`, `scorebook.ts`). Only a
  run that ends as done shows what its thing gives (an empty chest ends as done). A failed run
  is now treated as one cut short: what it had not yet delivered is taken as still to come,
  trusted less each time in a row (halving every four). One failure teaches nothing about the
  chest; a string of them still gives up on it. A failed run no longer starts that count again:
  only a finished one does.
- **A thwarted want waits before it is tried again** (`retryAfter` in `wanting.ts`). After a
  run toward a thing does not finish, the want for it is not proposed for 1 s; 2 s after the
  second in a row, then 4, 8, and so on up to a minute. A finished run ends the wait.

**Seen live.**

| Scene | Before | After |
|---|---|---|
| Whole brain, a standing husk on the only route (`threat_with_jev`) | The trip was started and dropped 29 times in 15 s; the want fell 0.86 → 0.5 | Started twice in one run and not at all in the other; the want stayed 0.86 |
| The same, husk gone | Got its bread | Got its bread, 4 s and 22 s later |
| Chest walled off for 15 s (`no_path`, new) | | `take_items` kept looking for a way and did not fail at all; the want stayed 0.90; bread fetched once the wall went |
| Seven other dopamine scenes; `neuro-check` calm, ambush, remembered, hunger | No problem; pass | No problem; all pass |

**Limits.**
- **The fast "no path" failure was not reproduced on demand.** A plain wall makes the skill
  keep searching, not fail. The quick failures came from a route blocked by a threat's avoid
  area, which is what the standing-husk scene exercises. The nine-in-a-row case is covered by
  a unit test only.
- **Nine failures in a row still leave about a fifth of what was learned** (before: under 3%).
  With the waits they now take about three minutes, not three seconds.
- **The wait is the same whatever stopped the run.** A trip cut off once by a glance waits a
  second before the want returns, though nothing was wrong with the trip.
- **The waits are not saved**: a restart forgets them (the count of unfinished runs is saved).
- **A failed run now leaves the skill's expected value nearly untouched the first time**
  (it still pays the fixed cost of a failure and of the effort wasted). A skill that fails
  every time is learned as bad more slowly than before.

**Status.** Built. Open: the limits above.

## Cornered: when fleeing is not working, hold and fight

*Built and run live 2026-11-21. Closes the first limit of the next entry (the bot died in both
attacking-husk runs).*

**What the plan was, and what tracing changed.** The plan had two parts: count a failing
flight as cornered, and make the way-out check ask a better question. Tracing the death tick
by tick showed the way-out check was right (there was a way out, past the husk along the far
wall), so it is left alone. Three other causes turned up instead, each of which got its fix.

| What went wrong | Why | Fix |
|---|---|---|
| `flee` refused to run ("cannot run") on a dozen ticks while the husk walked up | `flee` took "out of the threat's sight" as safe. The bot was tucked behind the glass corner; the husk was after it all the same | Out of sight is safe only from a threat that is not after the bot: one that has noticed it and can get to it keeps coming (`skills/flee.ts`, reading the defence circuit's sizing up) |
| The bot never believed it was cornered | Nothing read whether fleeing was working | Fleeing chosen for 1.5 s with the threat nearer than when it began counts as no way out, until the bot has made 2 blocks of ground (`threat-sense.ts`) |
| Cornered, the defence circuit chose to fight, and lost the vote | As a soft reflex the fight (0.95, held back by the patience brake) lost to Jev's `flee` already under way (0.76 plus the stay bonus) | With a threat on the bot and no way out, the fight is a hard reflex, `cornered_fight`: nothing outvotes it (`brain/reflexes.ts`) |
| A husk the bot had just run from stopped counting at 8 blocks | It had not yet shown any sign of noticing | A threat that was on the bot or coming counts as having noticed for 5 s after (`threat-sense.ts`) |

**Seen live** (`pnpm dopamine-check threat_with_jev_live`; whole brain, attacking husk, the
plaza now walled all round for this scene).

| | Before | After, three runs |
|---|---|---|
| Deaths | 1 in each run | 0, 0, 0 |
| At the corner | Kept choosing `flee`; hit and knocked off | Held still, then fought (`attack` won 18 to 24 ticks); health 20 at the end in the run traced |
| Chest wanted with the husk within 16 blocks | 3 times in one earlier run | 0 ticks |
| Husk removed | | Got its bread in every run |
| `defence-check`, eleven scenes | | Ten pass; `shooter` failed (one arrow landed; the flaky one) |
| `threat_with_jev`, `threat_first`, `death`; `neuro-check` calm, ambush, remembered, hunger | | No problem; all pass |

**Limits.**
- **Two earlier fatal runs were on the open platform.** In those the bot was hit off the edge
  even once it fought. The scene is now walled, so "cornered" means walls. Fighting with a drop
  behind it is still as dangerous as it was; nothing here keeps the bot away from an edge.
- **The husk was never killed.** Unarmed, the bot fought for five seconds and held it off; a
  longer fight, a stronger mob or two of them were not run.
- **A hard reflex ignores hold-backs.** A goal that holds the fight reflex back does not hold
  `cornered_fight`.
- **"Fleeing is not working" can be wrong for a moment**: a bot stuck on a block for 1.5 s while
  a threat closes turns to hold and fight. It is cleared once 2 blocks of ground are made.
- **A mob the bot cannot outrun now ends in a fight** by the same rule. Not run.
- **Cornered and only being approached, the bot's `freeze` (0.78) still loses to Jev's `flee`
  (0.79)**, so it runs on the spot until the threat is on it, then fights.
- **A threat that was once on the bot counts as having noticed for 5 s**, so backing off from an
  unaware mob is now fled, not frozen for.
- **An unaware threat sitting on the only way to the chest makes the bot dither.** With the
  standing husk, once the 5 s were up the bot wanted the chest again (the husk was 13 blocks
  off and unaware, which by the rule does not press), walked toward it looking for a way round,
  and backed off each time it came to 8 blocks: 29 ticks of `take_items` started and dropped in
  one run, the want falling from 0.86 to 0.5 as each trip was cut short. It never came nearer
  than 7 blocks. The scene's plaza is too narrow to go round; in the open it would.
- **In `defence-check blank` the new rule fired once**: after fleeing 9 ticks the bot held and
  fought for 2. The scene still passed; whether it was truly out of room there was not checked.
- **Each flee still stops at about 11 blocks and Jev idles until the threat is back at 8.**
  Left as it was.

**Status.** Built. Open: the limits above.

## The whole brain, starving, with a threat that can reach it

*Run live 2026-11-21, with one fix that came out of it. Closes "the whole brain with Jev and a
threat was not run" (two entries below).*

**What was run** (`pnpm dopamine-check threat_with_jev threat_with_jev_live`). Jev and every
region on; the bot knows a full chest and is out of bread; a husk is put 3 blocks off with
nothing between, standing still in one scene and attacking in the other. After 15 s the husk is
removed.

**What it showed.**
- **Standing husk: the rule held.** On 65 ticks with the husk inside 8 blocks the chest was
  never wanted, no option was loosened, and Jev fled (62 ticks; the reflex 3). The husk gone,
  the want took the bot to the chest 2 s later and it got its bread.
- **Attacking husk: the rule held where it applied, and still got the bot killed.** The bot
  fled; at 9 blocks the husk no longer counted as danger (the range was 8), the chest was wanted
  at once (0.84) and the bot turned back toward the husk. Three times: flee, turn back, flee.
  The husk caught it at the end of the platform and knocked it off.

**The fix: a threat that has noticed the bot counts from further off** (`nearestThreat` in
`brain/read-state.ts`). One that has not noticed counts inside 8 blocks as before; one that
has noticed (it is coming, facing the bot, or has hurt it) counts out to 16, as far as threats
are sized up at all. The danger need is graded over that wider range, so being chased at 9
blocks still silences every lesser need.

| Scene | Before the fix | After |
|---|---|---|
| Attacking husk, chest wanted while the husk was near | Three times, at 9 blocks; the bot turned back each time | 0 of 52 and 0 of 51 ticks (two runs) |
| Attacking husk, after it was removed | | Went for the chest 2 s and 21 s later; got its bread |
| Standing husk | Rule held | Rule held |
| `defence-check`, eleven scenes | | Ten pass; `shooter` failed again (one arrow landed; the flaky one) |
| Three dopamine scenes; `neuro-check` calm, ambush, remembered, hunger | Pass | No problem; all pass |

**Limits.**
- **Closed the same day (see the entry above).** The bot still died in both attacking runs, of the fall. It fled to the corner of the
  scene's platform, which stands 150 blocks up with an open edge; the husk hit it and knocked
  it off. Part of that is the scene. Part is not: cornered at an edge, it kept trying to flee
  (`flee` failed with "cannot run" on a dozen ticks) and never turned to fight, and Jev idled
  for 13 to 15 ticks while the husk walked up from beyond the flight distance.
- **Dying moves the bot to its base**, where the remembered chest on the platform cannot be
  walked to. In one run the want then won 65 ticks to no end (the retry problem noted two
  entries below).
- **The danger reward is now paid over 16 blocks for a threat that has noticed**, so fleeing is
  paid for further and a chasing mob costs more as it comes. Total for coming and going is
  still nothing, by the unit test.
- **Noticing lapses a few seconds after a mob stops coming**, and with it the wider range.
- **A bare state with no word on a mob's movement counts it as having noticed** (the cheap
  rules' default), so there the range is 16.

**Status.** Run; the turning back is fixed. Open: the limits above, first the cornered case.

## Defence: watch first, take the all-clear, and remember the place

*Built and run live 2026-11-21. Closes the two unexplained `defence-check` failures of the next
entry.*

**The problem.** Working out whether a mob can get to the bot takes a real route check, about
one to two seconds. Until it answers, the bot uses a cheap guess (in sight and at about its
height). For a husk in a pit the guess is wrong. In two runs of three the bot acted on it: it
fled for a tick and alarm rose to 0.6; when the answer came the bot stopped, but alarm only
faded by itself and was still 0.4 at the end. It was a race between the answer and the reaction.

A real brain has the same two routes, a fast rough one and a slow careful one, and reacts to
the rough one on purpose. But its first reaction is small (freeze and look), the careful route
can cancel the alarm, and it stops reacting to what proved harmless. The bot now does all three.

**The change.**
- **Watch first** (`settling` in `defence/routes.ts`, `size-up.ts`; the chooser in
  `region-brainstem/defence.ts`). While the first route answer for a mob is being worked out,
  a mob that counts as coming only on the guess is frozen for, not fled from. This holds only
  while it is beyond half its flight distance, for at most 2.5 s, and never for a mob that is
  looming, has hurt the bot in the last 10 s, or whose check was given up as unsure.
- **The all-clear** (`falseAlarm` in `brain/alarm.ts`; `allClear` on the noradrenaline region).
  When a threat that was pressing is found unable to harm the bot, and nothing else presses,
  alarm drops at once to a quarter of itself.
- **Remember the place** (`defence/reach-memory.ts`). Every route answer is kept by where the
  mob and the bot each stood (within 2 blocks, 64 places). The next mob in that spot, or the
  same one later, is known at first sight, with no guess and no wait.

**Seen live** (`pnpm defence-check`).

| Scene | Before | After |
|---|---|---|
| `pit`, when the answer is slow (1.75 s) | Fled for a tick; alarm 0.6, still 0.4 at the end; failed | Froze for a tick; alarm 0.6, cut to 0.10 by the end; passed |
| `pit`, four runs | 1 of 3 passed | 4 of 4 passed |
| `pit_again` (new): a second husk in the same pit | | Known unable to reach on all 17 ticks, though the guess said it could; no defence; alarm 0 |
| All ten earlier scenes | 8 passed | 10 passed (`shooter` too, once) |
| Five dopamine scenes (`threat_first`, `with_jev` among them); `neuro-check` calm, ambush, remembered | No problem; pass | No problem; pass |

**Limits.**
- **A mob that really can reach the bot is now fled from up to a second or two later**, if it
  is first seen beyond half its flight distance and the route check has not answered. In `open`
  the husk was still fled from at 8 blocks, but a fast mob first seen at 5 could gain ground.
  Not measured.
- **The all-clear is one fixed cut** (to a quarter), whatever else raised alarm in the same
  moment (a hit taken while the guess stood would be cut with it).
- **The memory of places is lost when the bot restarts**, and is not checked against changes to
  the world: fill the pit in and a mob there is still taken as unable to reach until the route
  check answers again (asked about once a second, so about a second).
- **An old answer is noted for a new place for up to a second** when a mob moves, until the
  route check is asked again.
- **`shooter` passed once with these changes** after failing 5 of 5 before them. Nothing here
  should change it (the scene needs two arrows to land), so it is most likely the same luck;
  it was not rerun.
- **Only the nearest two threats get a route check**, so only they are watched first or
  remembered.

**Status.** Built. Open: the limits above.

## A threat that cannot get to the bot is no threat

*Built and run live 2026-11-21. Closes a limit of the next entry ("a threat that cannot reach
the bot counts the same as one that can").*

**The problem.** The bot had more than one opinion of the same mob. The defence circuit sizes
each threat up, with a real route check and, for mobs that shoot, a clear line. But the danger
need, the "threatened" label, memories and the outlook all used a cruder rule: any hostile mob
within 8 blocks. Tracing a caged husk live showed two more places with the same fault: the
defence chooser froze the bot for a husk that could not reach it (45 s, starving), and journeys
were routed round it in a circle so wide that no path to the chest was left.

**The change: one test of whether a threat counts** (`couldHarm` in `defence/size-up.ts`): it
can get to the bot or hit it from where it is, it is on the bot or has just hurt it, or it
would blast through a wall (a creeper).
- `nearestThreat` (`brain/read-state.ts`) now reads the defence circuit's sizing up through
  that test. The danger need, the "threatened" label, memories and the outlook all follow,
  with no change of their own. Threats the bot has learned are counted too.
- The defence chooser only watches a seen threat that cannot reach (`wary`), noticed or not:
  there is nothing to hide from (`region-brainstem/defence.ts`).
- Journeys are routed round a threat only if it could harm (`threat-sense.ts`).
- **Priority is now strict** (`pressingNow`): a lesser need is silent while danger presses at
  all. The first version let it fade with distance, and a leftover want of 0.04 slipped in
  between two flee runs and started a trip toward the threat.

**Seen live** (`pnpm dopamine-check threat_first`).

| Moment | Before | After |
|---|---|---|
| Out of bread, a husk in a glass box 3 blocks off | Froze for 45 s; no path to the chest; no bread | Walked past it; had its bread in 3.5 s |
| The same husk with nothing between | A weak want started trips between flee runs | Fled; wanted nothing while it was inside 8 blocks |
| Caged husk appearing and leaving (`threat_gone`) | Paid −0.39 then +0.39; the bot froze | Paid nothing; the bot did nothing |
| Five other dopamine scenes; `neuro-check` calm, ambush, remembered, hunger | No problem; all pass | No problem; all pass |
| `defence-check`, ten scenes | | Eight pass; `pit` and `shooter` failed (see limits) |

**Limits.**
- **Closed for a threat that has noticed the bot (same day, entry two above).** Out of range, out of mind. Danger counts inside 8 blocks only. The bot fled a husk that
  stood between it and the chest, and at 8 blocks wanted the chest again and turned back (seen
  in an early run of the scene: flee, return, flee). A threat that has just been fled is not
  remembered for even a moment. This was so before; strict priority makes the edge sharper.
- **Until the route check answers, reach is a guess** (line of sight and similar height). A mob
  round a corner with no line of sight counts as unable to reach for that moment, so the bot
  does not freeze or steer round it until the answer comes. Only the two nearest threats get a
  route check.
- **A cage that opens is noticed only when the route is checked again.**
- **Only creepers are counted as hurting through a wall.** The list is one line to extend.
- **A want that cannot be carried out is retried at once and unlearned in seconds.** With no
  path to the chest, `take_items` failed nine times in three seconds and each failure lowered
  the want, from 0.9 to nothing. The no-path case is now gone for a caged mob, but any other
  cause of "no path" would do the same. Not fixed.
- **`defence-check shooter` failed 5 of 5 runs with this change and 1 of 3 without it.** I could
  not find a cause in the change. The scene needs two arrows to hit within 25 s; in a failing
  and a passing run the bot did the same things tick for tick until the arrows flew, and the
  difference was whether its flinch at the first volley made that arrow miss. So the scene
  looks flaky, but eight runs do not rule out that the change makes a miss more likely.
- **`defence-check pit` failed 2 of 3 runs** (and passed once with the freeze rule put back):
  in the second before the route check answers, the husk in the pit is guessed reachable, the
  bot flees for one tick and alarm rises to 0.6, ending at 0.4 against a limit of 0.3. The
  earlier write-up recorded alarm at 0 for this scene. Not explained.
  **Explained and closed the same day:** see the entry above.
- **The scene's plaza is 9 blocks wide**, so a route round a threat that could harm is still
  impossible there; the free-husk half only shows the fleeing and the silence.
- **The "threatened" label now differs for a caged mob**, so what was learned under it before
  (in a saved scorebook) is filed under a label the bot no longer gets in that case.

**Status.** Built. Open: the limits above.

## Dopamine: staying alive comes before any other need

*Built and run live 2026-11-21. Closes the first limit of the next entry ("two needs pressing at
once are not weighed against each other").*

**The problem.** Every need counted alike. Out of food with a hostile mob close, the want for a
known chest stayed at full strength (up to 0.9), and Jev's pick to defend itself was loosened
like any other option, so the bot could set off for the chest past the threat. Food is there
to mend health; it is never worth more than not being killed.

**The change: needs have a rank** (`rank` on a reward rule; `pressingNow` in
`dopamine/rewards.ts`).
- A need with a higher rank quietens every lower one as it presses: with the more vital need at
  v, a lesser one keeps (1 − v)² of its level. No threat: all of it. A mob half way in (4 of 8
  blocks): a quarter. A mob on top of the bot: none.
  **Changed the same day to strict** (see the entry above): a lesser need is silent while a
  more vital one presses at all.
- `danger` has rank 1; every other need has rank 0. A new vital need takes one number.
- Both places that act on needs read the quietened levels: what the bot wants (the cues) and
  how far Jev's options are loosened (the arbiter). So with a threat close the chest is not
  wanted, nothing is loosened, and the defence keeps its full hold.
- What is learned still goes by the true levels, so a chest's relief is learned the same with
  or without a mob about.

**What a soft reflex is** (asked while this was built). A hard reflex fires at full urgency (1)
and nothing can outvote it: in lava or on fire, drowning, the last stand at low health, pulling
away from what hurts, being buried. A soft reflex is graded and capped at 0.95, so the rest of
the brain can outvote it: the defence circuit's freeze, flee and fight, the milder protective
ones, and the body's upkeep urges such as eating.

**Seen live** (`pnpm dopamine-check threat_first`, reflexes only).

| Moment | Seen |
|---|---|
| Out of bread, a caged husk 3 blocks off | Wanted nothing on 0 of 17 ticks; froze throughout |
| Husk gone | Went for the chest and got its bread, 23 s later |
| Six other dopamine scenes (`with_jev` among them); `neuro-check` calm, ambush, remembered, hunger | No problem; all pass |

**Limits.**
- **The 23 s is not the want being slow.** The alarm drops the goal that wants bread, and
  `take_items` only takes what a goal wants, so nothing can be wanted until the planner sets the
  goal again. A bot with no goal asking for food does not want a chest of it at all.
- **Only a hostile mob within 8 blocks counts as danger.** Lava, a fall, fire, drowning and low
  health do not quieten other needs (the hard reflexes cover the first four). Low health is
  rank 0: it is not a threat by itself, and food is what mends it.
- **A threat 6 to 8 blocks off quietens little** (a husk at 6 leaves 56%), so the bot may still
  set off, and the want fades as it gets nearer. Whether a trip then turns back was not run.
- **A threat that cannot reach the bot counts the same** as one that can (the caged husk). **Closed the same day:** see the entry above.
- **The whole brain with Jev and a threat was not run** for this; the unit test covers the
  arbiter (Jev's `attack` keeps its hold, the chest is not wanted). **Run the same day:** see the entry
  three above.
- **Seen in the first run of the scene:** a trip cut off by a husk appearing was learned as
  "going to this chest makes danger worse". One such run lowers the want a little; several
  would put the bot off a good chest because of where a mob happened to be.

**Status.** Built. Open: the limits above.

## Dopamine: a pressing need loosens the hold of a skill that does not serve it

*Built and run live 2026-11-21. Closes the first limit of the next entry ("a want still cannot
interrupt a skill Jev is running").*

**The problem.** Jev bids about 0.72 to 0.8 for the skill already running, whatever the bot
needs. A want for a known chest of bread bid 0.42 from memory, so a bot with no food at all
finished its walk home first. Raising the want's cap would not be how a brain does it: there,
the protection of the current task weakens as a need grows, and the question is whether the
task is still worth it next to what else is on offer.

**The change** (`holdNow` in `dopamine/wanting.ts`, applied in `createArbiter`).
- Dopamine publishes the strongest want on offer as a signal (`want`; 0 when nothing is wanted).
- While something is wanted, the arbiter scales each option of the deciding layers (Jev, the
  planner) by how much of its hold it keeps: 1 − 0.5 × (the worst need it is not expected to
  relieve)². What an option relieves is the relief already learned for that skill, at that
  thing if it names one.
- So a mild need changes almost nothing (a need at 0.25 costs 3%), and with a need at 1 an
  option that does not serve it keeps half. The square is the same curve as the need's reward.

**Kept narrow on purpose, so it cannot make other things worse.**
- **Reflexes are never scaled** (only layers 1 and up are), so nothing here weakens a defence.
- **The want itself is never scaled.**
- **With nothing wanted, nothing changes**: a starving bot that knows of no food is not made
  restless for nothing.
- **Every deciding option is scaled by the same rule, not the running one alone.** Scaling only
  the running skill would make two options that do not serve the need take turns each tick.
- `personality.wanting` scales it (0: off), so there is no new setting.

**Seen live.**

| Scene | Before | After |
|---|---|---|
| `with_jev`: out of bread, Jev walking home (bid 0.71), chest remembered | The want (0.42) lost; the walk was finished first | The want (0.54) won; the bot turned for the chest |
| The same run, flip-flopping between skills | | None: each trip ran to its end |
| `with_jev`: carrying 8 bread | Not wanted | Not wanted on 0 of 49 ticks |
| Seven reflex-only scenes; `neuro-check` calm, ambush, remembered | No problem; pass | No problem; pass |
| `neuro-check` hunger | Pass | Failed once on "it ate (0 times)", passed on the rerun (see limits) |

**Limits.**
- **Closed the same day (see the entry above):** two needs pressing at once were not weighed against each other. The rule goes by the worst
  need an option leaves unmet. Starving with a threat about, Jev's pick to defend itself is
  loosened like any other, so the bot may set off for the chest. The reflexes still act, and a
  full-urgency one always wins. Not run live.
- **A soft reflex is still not interrupted by a want** (a reflex below full urgency against a
  want capped at 0.9 is as before).
- **An option with no target is judged by its skill alone.** Jev's own `take_items` (no target)
  shows only part of the learned relief, so the want wins over it for the same trip. No restart
  follows, but the log names dopamine as the winner.
- **Early on, what does serve the need is loosened too**, because its relief is only partly
  learned.
- **Curiosity is not counted** among the needs here (the arbiter reads the body's needs only).
- **The floor (half) is hand-set.**
- **One wasted interruption is possible**: a want for a chest that has since been emptied
  interrupts Jev once, until the chest memory says it holds nothing.
- **The `hunger` check is flaky, and not from this change.** In the failed run the bot ate three
  bread, but each `eat` run was cut off by Jev's next pick the moment the food bar was back to
  half, and the check counts only `eat` runs that end as done. The `want` signal was 0
  throughout, so the new rule never acted. Not fixed.
- **Seen once in `sated`: a teleport while `take_items` was walking left it standing for ten
  seconds.** The scene emptied the bot before moving it, so the want started a trip that the
  move then stranded. The scene now moves first. The stall itself (locomotion after a teleport
  mid-walk) is a separate problem, not followed up.

**Status.** Built. Open: the limits above.

## Dopamine: wanting a remembered thing, and knowing what a run was aimed at

*Built and run live 2026-11-21. Closes the first limit of the next entry ("a want is only for
what is in the state now").*

**The problem, as first written, was half wrong.** I had said a chest the bot "is not looking
at" pulls nothing. Checked against the code: dopamine reads the full state, where a chest is
listed whenever it is within 16 blocks, whichever way the bot faces. What is true is that a
want fired only for a thing listed in the state at that moment. A chest leaves the state when
the bot is more than 16 blocks off, when more than 10 nearer useful blocks crowd it out, or
when alarm is high enough to narrow attention (seen live: alarm above about 0.6 dropped a chest
4 blocks away).

**A second, larger cause turned up in the Jev runs.** A run's aim was known only if the skill
was given a target and that target was in the state when it started. Jev picks `take_items`
with no target (the skill chooses the chest), so nothing Jev did was ever learned about that
chest, and no want for it could form.

**The change: three small general pieces.**
- **Memory of places** (`rememberedThings` in `brain/cues.ts`). Nothing new is stored. The
  scorebook already files each fixed thing under its position, so `scorebook.things()` lists
  every particular thing it has learned about. Those that are useful blocks and not in the
  state now are handed to dopamine beside the things in view, with the distance from here
  worked out each tick. Only the nearest 16 are weighed.
- **The longer walk costs** (`Thing.extraWork` in `dopamine/cues.ts`). A remembered thing costs
  the walk beyond sensing range on top of a usual trip, at the same rate effort is charged
  (about 0.003 a block, times `wastedEffort`). 100 blocks costs about 0.3, so a far chest is
  wanted with nothing left and not when only a little short.
- **A run's aim is settled at its end if not known at its start** (`episodes.ts`). A skill
  that chooses its own thing says so in its result (`aimedAt`; `take_items` and
  `deposit_items` do, through `atContainer` in `skills/storage.ts`). A target out of the state
  at the start is looked up again when the run ends.

Anything new plugs in: a new kind of block the scan lists is remembered with no further code,
and a new skill that picks its own thing only has to return `aimedAt`.

**Seen live** (`pnpm dopamine-check`, twelve scenes, none showing a problem).

| Scene | Before | After |
|---|---|---|
| `out_of_range`: 30 blocks from the known chest, out of bread | No want | Set off from memory (want 0.76 to 0.91), got its bread; two runs |
| The same, carrying 8 bread | | No pull on 0 of 16 ticks |
| `with_jev`: Jev's own untargeted `take_items` | Learned with no aim: the chest never wanted (0 cues in the run) | Filed under the chest; the chest was then wanted, also with the chest dropped from the state by alarm |
| `with_jev`: the pull against Jev | Won in 1 run of 4 | In one run, started three trips (0.44 over `idle` 0.39; 0.63; 0.71) |

**Limits.**
- **A want still cannot interrupt a skill Jev is running.** From memory the pull was 0.42 against
  a running `return_to_base` at 0.72; it won only between Jev's skills.
  **Closed the same day:** see the entry above.
- **Gone things are not forgotten.** Nothing is deleted from the scorebook. A chest that is gone
  stops being wanted only because `take_items` cannot run on a block that is not there; a spot
  reached with `go_to` has to be walked to and found empty several times.
- **Beyond the loaded chunks nothing is wanted by `take_items`**: it cannot run on a block the
  client has not loaded. Only `go_to` could, and only if `go_to` itself learned the relief.
- **Positions carry no dimension.** A chest remembered in the overworld is weighed by its
  numbers in the Nether too.
- **Only useful blocks are remembered** (containers, ripe crops, bells). A remembered ripe crop
  is wanted after it is harvested until trips there teach otherwise.
- **The extra walk is straight-line distance**, not the path, and a long trip also raises that
  chest's learned usual work, so it is charged a little twice afterwards.
- **A run's aim is still lost** if the skill names no target, reports none, or the thing is in
  neither the state nor memory when the run ends (a first visit ending under high alarm).
- **The `with_jev` verdict is weak**: its time windows do not line up with what Jev does. The
  result above is from reading the trace tick by tick, one run.
- **`two_chests` behaved differently in one run** (it went straight to the full chest with the
  empty one nearer). Not followed up; it may be run-to-run variation.

**Status.** Built. Open: the limits above.

## Dopamine: wanting what a need calls for, and giving up on what never finishes

*Built and run live 2026-11-21. This is step 3 of the dopamine rework (steps 1 and 2 are the
next entry), plus the fix for a run that is always cut short.*

**The problem.** The pull toward a learned thing (a cue) was a fixed, small number: what aiming
at the thing had been learned to add, capped at 0.3. It did not know whether the bot needed the
thing, and it could not beat Jev's `idle` (0.8 plus value plus the stay bonus). On the logs of
2026-11-19 cues fired on thousands of ticks and won none.

**The change: the pull is what the thing would pay right now** (`dopamine/wanting.ts`, `cues.ts`).
- Every need rule now also says how pressing it is (0 to 1). In `rewards.ts` that is free: a
  need written with `need(...)` already had its level.
- When a run ends, the region learns what it did to each need: how far the level fell from the
  run's start to its end (its relief). This is filed like a skill of its own
  (`take_items ⇒ food_stock`), so it is learned by the same levels as everything else: the skill
  in general, each situation label, the kind of thing, that particular thing. The usual work of
  the run is learned the same way (`take_items ⇒ (effort)`).
- For each thing in view: want = for each need, the reward for that need moving from its level
  now to where the learned relief would leave it (the same `before² − after²` every reward
  uses), less the usual work of getting there, less what aiming there has cost (a death).
- The urgency is the want itself, times DA (×1 at rest), capped at 0.9: under a hard reflex.

So nothing is tuned per thing or per need. A chest of bread pulls at 0.9 with no food left, at
under 0.1 nearly stocked, and not at all with enough. A new need gets its pull by being written.

**A need already met teaches nothing.** A stocked bot that opens a full chest shows no relief,
and that says nothing about the chest. A relief below what was expected is believed only if the
need stood high enough at the start to have shown it.

**A run that never finishes is given up on.** A run cut short was taken to have been going to
earn the rest of what was expected, every time, so a skill that is always interrupted never
learned it does not pay. With the pull now able to win, that is a loop: want it, set off, get
cut off, want it again. Each cut-off in a row, with no finished run between, now halves the
trust in "the rest was coming" every four cut-offs (kept per thing: that chest, else that kind,
else the skill). The same trust is used for the relief. One cut-off still teaches nothing.

**Live** (`pnpm dopamine-check`, now eleven scenes: `sated` and `with_jev` are new):

| Scene | Before | After |
|---|---|---|
| Out of bread, a known full chest in view (reflexes only) | Pull capped at 0.3 | Want 0.90 (food stock +0.92); went and got its bread |
| Carrying 8 bread (enough), same chest in view, skill able to run | Same pull as when short | No pull on 0 of 21 ticks; pulled again as soon as it was short |
| A learned trip cut off six times by a typed `stop` | Flat at +0.24 for ever | +0.24 → +0.22, trust 1.00 → 0.42: first cut-off teaches nothing, then it wears down |
| Two chests, night, death, fall, idle, threat, sword loop, light loop | No problem | No problem |
| Whole brain with Jev, out of bread, chest known (four runs) | Cues won 0 ticks of 97,487 | One run: the pull won at 0.64 against Jev's `idle` at 0.54 and started the trip. Three runs: nothing to test, see below |

Ten reflex-only scenes, none showing a problem. Whole-brain regression (`neuro-check` calm,
ambush, remembered, hunger): all pass.

**With Jev the result is thin: one clear win in four runs.** In the other three the chest was
never in the bot's view while it was short and not already on its way (0 ticks each), so the
pull had nothing to fire on. Either the chest was not in the state, or Jev picked `take_items` by itself and fetched the
bread first. *Corrected 2026-11-21:* an earlier version blamed a glance turning the head. That
cannot be: dopamine reads the full state, where a chest is listed whenever it is within 16
blocks, whichever way the bot faces (and Tester has the field of view off). A chest leaves the
state only when the bot is more than 16 blocks from it (`return_to_base` walks it away), when
more than 10 nearer useful blocks crowd it out, or when alarm is high enough to narrow
attention (`narrow` in `encode-state.ts` drops every block). Which of these it was is not
checked. Whenever the chest was in view and the bot was short, the
want fired (0.55 to 0.69), and stocked with 8 it fired on 0 of 184 ticks across the four runs.

**Limits.**

- **A want is only for what is in the state now.** "In view" here means listed in the state:
  within 16 blocks (through walls, facing any way), among the 10 nearest useful blocks, and
  alarm not narrowing attention. A chest the bot knows about outside that pulls nothing; the
  chest memory and the scorebook's own `pos:` entries are never consulted. With Jev running the
  chest 13 blocks off was out of the state for 7 seconds at a stretch (cause not checked; not a
  glance). **Would fix:** a memory of places, so that remembered things are weighed the same
  way as things in the state, less the work of the longer walk.
- **The pull starts the trip; Jev then carries it.** Once the skill is running Jev proposes it
  itself at 0.8 with the stay bonus, so the tick log credits the pull with one tick per trip.
  The scene counts the ticks on which the bot did what was wanted, whoever proposed it.
- **It cannot interrupt a skill Jev is sure of.** Jev at p near 1 scores about 1.1 with value
  and stay bonus; the pull stops at 0.9. It wins against a lukewarm pick (`idle` at 0.54 lost
  to the pull at 0.64 plus value). It also loses a tick to a glance, which runs at 1.00 when idle.
- **Relief is whatever happened to the need during the run**, whoever caused it. A husk walking
  up while the bot heads to a chest is learned as "this chest raises danger". The credit shift
  of step 2 (the worth of the situation) is not applied to reliefs.
- **Nothing is learned about a thing while the need is met.** A bot that is never short of food
  never learns which chest holds it.
- **Only a skill that finishes the job learns a relief.** `take_items` at a chest relieves the
  food stock; `go_to` the same chest relieves nothing, so walking up to things is wanted only
  where arriving itself helps (light at night).
- **Giving up after cut-offs is slow outside a learning window.** Live, six cut-offs by a typed
  `stop` took the trust to 0.42 and the expectation down 5%: nothing notable happened, so the
  step was a fifth of the usual. A reflex that cuts a run off jumps the alarm and opens the
  window; that case was not run live.
- **The usual work is kept per thing, not per distance.** It is an average over wherever the
  trips started.
- **The arbiter still weighs skills by benefit and cost, not by need.** Jev's `eat` is not
  worth more to the arbiter when the bot is hungry. The reliefs are learned for every skill, so
  this could use them; it was not built.
- **An untried chest was not tested.** Boredom is a need with a level now, but noticing a thing
  relieves it on sight, not on arrival, so nothing yet pulls the bot to look inside.
- **The scorebook grows faster**: one more set of adjustments per skill for each need it has
  changed, and one for its work.
- **New settings:** `personality.wanting` (1; 0 learns but never pulls). The half-life of trust
  (4 cut-offs) and the cap (0.9) are hand-set.
- **The live scenes ran once or twice each**; `with_jev` four times, with one usable run.

**Status.** Built. Open: the limits above. The first (a want needs the thing in the state) was closed the same day: see the entry above.

## Dopamine: learning by adjustments, and credit for the difference made

*Built and run live 2026-11-20, in two steps. Together with the signed needs (next entry) these
are the two causes behind the problems found on 2026-11-19. The third step (wanting as need
times expectation, so that a cue can win in the whole brain) is not built.*

**Step 1: adjustments, not pages** (`dopamine/scorebook.ts`). The scorebook kept one page per
exact situation and kind of thing, so a new label doubled the table and nothing carried over.
A skill's value is now a sum of adjustments, learned level by level, the most general first:
the skill in general; each label of the situation; the kind of thing aimed at; that particular
thing, by id (blocks only: a mob's id does not last). Each level takes one step of what is still
unexplained. The cue weighs every thing in view by itself and takes the best of each kind.
Situation labels are a plain list (`situation-labels.ts`): a new one is one line and one
adjustment per skill.

**Step 2: credit for the difference made** (`dopamine/dopamine-region.ts`, `episodes.ts`).
- The region learns what each situation is worth by itself (what tends to follow from it,
  whatever is running), and a skill is credited with the change in that worth from where it
  started to where it ended. A new "body" label (falling, burning, underwater, steady) lets it
  tell trouble already under way.
- A run cut short is taken to have been going to earn the rest of what was expected, so only
  what actually happened to it is learned.
- A tick's rewards go to the skill that ran for the most of that tick, by the events' own times.
  A reward that is about one skill (it failed; the sleep it finished) goes to that skill alone.

**Live** (`pnpm dopamine-check`, nine scenes, the last full run; fall and interrupted run again after a fix):

| Scene | Before these two steps | After |
|---|---|---|
| A full chest far off, an empty one put nearer | Went to the empty one, then wanted no chest | Went to the full one both times it ran short; got its bread |
| Learned by day, then dusk | No pull at night | Pull fired at night (3 ticks); got its bread |
| A learned trip cut off six times on the way | Expectation fell 11% (57% once learning was faster) | Flat: +0.24 six times running |
| Ten hard falls, then three with a pool in reach | Not testable (nothing ran) | The reflex is paid +0.02 to +0.04 for landing in the water; the skill running when the bot fell is charged -0.03 |
| Death, idle, threat, sword loop, light loop | No problem (signed needs) | No problem |

Nine scenes, none showing a problem. Whole-brain regression (`neuro-check` calm, ambush,
remembered, hunger): all pass, calm on its second run (the first hit the known Jev timeout and
ran only 12 ticks).

**Found and fixed on the way.**

- **The reflex was charged for another skill's failure.** With rewards going to whoever ran for
  most of the tick, the -0.1 for `idle` being cut short landed on `air_steer`, which had just
  taken over (-0.09 for each unhurt landing). A reward can now name the skill it is about.
- **The harm of a fall shows a tick after the fall is over.** The body reads "steady" about
  200 ms before the health drop is seen, so the hurt was put down to standing still and falling
  was never learned as bad (worth -0.00 after ten falls costing -0.25 each). A surprise is now
  also put down to the situations of the last second or so.
- **Rest was a list of two skill names** in the effort measure. It is now any skill that uses no
  part of the body, read from the skill itself.

**Limits.**

- **Learning is faster overall.** A surprise used to move a skill 10% of the way. It now moves
  the total 19% (two levels) to 34% (aimed at a particular thing, four levels), since each level
  takes its own step. In the behaviour test the bot gives up on an emptied chest after 9 trips
  when it is near and 5 when far (it was 29 and 12). `personality.learningRate` is now the step
  per level.
- **One label on its own learns slowly.** The labels of a situation share one step between
  them, so what a single label changes is learned at a sixth of the pace. Live, after ten falls
  costing 0.25 each, falling was worth only -0.02 and moved credit by 0.03 to 0.04. The direction
  is right; the size is small.
- **Situation worth only moves credit where the situation changes.** A skill that runs from
  before the trouble to after it still takes all of it.
- **An untried chest is never tried while a known one is in view.** The near chest was wanted a
  little (on what chests are worth), the far one more (it had paid), so the bot never opened the
  near one. That was the right answer here, but nothing makes it look in a new chest.
- **A skill always cut short never learns it does not pay.** The unearned part is assumed still
  to come, every time. Interrupted runs are not counted in its record of successes either.
  *(Closed 2026-11-21: trust falls with each cut-off in a row; see the entry above.)*
- **The scorebook grows with every block ever aimed at** (each chest, crop and hazard position
  has its own adjustment) and nothing is pruned.
- **Only two rewards name their skill** (`skill_failed`, `slept_through_night`). Every other
  reward in a tick goes whole to the skill that ran longest; it is not split.
- **The two half-lives are hand-set**: what follows a situation counts for half after 10
  seconds; a surprise reaches back to earlier situations for half after 1 second.
- **Saved scorebooks in the old format are ignored on load.**
- **Cues are still capped at 0.3** and still cannot win in the whole brain: step 3.
  *(Closed 2026-11-21: see the entry above.)*
- **New settings:** `personality.situationWorth` (1; 0 turns the credit shift off).
- **The live scenes ran once or twice each**, with no Jev.

**Status.** Steps 1 and 2 done; step 3 is the entry above. Open: the other limits above.

## Dopamine: rewards are now the signed change in a need

*Built and run live 2026-11-20. This is the one change behind most of the problems in the entry
below, not a fix for each.*

**The cause.** A reward was "a need got smaller", with the other half cut off: a need getting
bigger cost nothing (`Math.max(0, before - after) * before`). So anything that went down and
came back up was pure profit, and a few hand-written penalties patched the missing half without
mirroring the gains.

**The change.** Every need reward is `before² − after²` (`need-change.ts`): a fall pays, a rise
costs exactly what falling back will pay. The rules are need levels: food bar, health, danger
from the nearest threat, darkness at night, tools missing, food stock, torches
(`packages/minecraft/src/brain/rewards.ts`). `damage_taken`, `lost_items`, `threat_gone` and
`first_tool` are gone, and so is the halving of repeats. Curiosity is a need too: boredom builds
over ten minutes with nothing new, and a new thing pays back at most the boredom that had built
up. No need is compared across a death.

**Live, the same eight scenes** (`pnpm dopamine-check`, one run):

| Scene | Before | After |
|---|---|---|
| Death, hungry and hurt, a husk beside it | Net +0.46; DA 0.57 → 0.62 | Net -1.01; DA 0.44 → 0.33 |
| Idle while six animals appear and a wound mends | `idle` paid +2.60; +0.10 in the arbiter | `idle` paid -0.03; 0.00 in the arbiter; DA peaked at 0.53 (was 0.84) |
| A caged husk appears and is removed | +0.39 | -0.39 on appearing, +0.39 on going: 0.00 |
| A creeper appears and goes off | +0.33 | 0.00 |
| Drop a sword and pick it up, four times | +0.98 | -0.44 and +0.44 each round: 0.00; DA ended at 0.58 (was 0.82) |
| In and out of a lit corner at night, four round trips | +0.85 | 0.00; walking into the dark is now learned as a loss (-0.46 to -0.60 a trip) |
| Two chests | Wanted the empty one, then no chest | The same (not addressed) |
| A trip cut off on the way | Expectation fell 11% | The same (not addressed) |
| Learned by day, then dusk | No cue at night | The same (not addressed) |

Whole-brain regression (`neuro-check` calm, ambush, remembered, hunger): all pass. Eating paid
0.44, 0.31, 0.19, 0.06 over four meals.

**Limits and consequences.**

- **A hit at full health barely registers** (20 → 17 costs 0.02) and the same hit when weak
  costs a lot (6 → 3 costs 0.23). Before, every hit cost the same. Alarm, pain and the startle
  do not use this number, so the reflexes are unchanged.
- **A threat appearing is charged to whatever is running.** Live, `idle` took -0.39 when the
  husk appeared, and the +0.39 for its going went to nobody, because a reflex had cut `idle`
  short by then. The sum for the bot is zero, but not for each skill: who is running when the
  bad half lands and who when the good half lands still decides what is learned.
- **Eating when barely hungry is a small loss**: the food stock falls more than the bar gains.
- **Other items are no longer missed.** Losing cobblestone, a helmet or a bucket costs nothing;
  only food, torches and the last tool of a kind are needs.
- **Sleeping through the night is still a one-off reward**, not a need level. The time since
  the bot last slept restarts whenever it gets out of a bed, so as a need a moment's lie-down
  would pay for a whole night.
- **Dusk and dawn are free.** Darkness is a need only at night, and the change of day is not
  compared, so night falling costs nothing and day breaking pays nothing.
- **Boredom is one number for everything.** A new item in the pocket relieves it as much as a
  new animal. `personality.noveltyBonus` now means how much of its boredom one brand-new kind
  takes away (0.5: half). It starts half full on every run, and a gap in the ticks (a pause, a
  reconnect) fills it as if the time had been dull.
- **The death tick still charges the blow that killed**, when the dead body is seen before the
  respawn (health to 0). Live it was not seen: the death came out at -1.01.
- **Saved scorebooks are on the old scale.** Values learned before this change were built from
  one-sided rewards; delete `data/<bot>/scorebook.json` to start clean.
- **Not addressed, as said beforehand**: all chests are one kind and only the nearest is
  considered; nothing learned by day is known at night; an interrupted trip counts as a
  disappointment; cues never win in the whole brain; the rescue reflexes are blamed for the
  fall. The first two share a cause (the scorebook files under one exact label and never falls
  back to a more general one).

**Status.** Done for the reward side. Of the five items above, four were closed the same day (see "Dopamine: learning by adjustments, and credit for the difference made"); cues in the whole brain are still open.

## Live testing, 2026-11-19: dopamine

*Two sources. First, every existing live log was read for what dopamine did in it (593 logs,
97,487 ticks, 15 deaths). Then eight new scenes were run on the test server with
`pnpm dopamine-check`: the real bot with no Jev and no planner calls, so only the reflexes,
dopamine's own cues and typed commands act. Each scene was run once, two of them twice.*

| Scene | What it did | Numbers |
|---|---|---|
| Death: killed while hungry and hurt, a husk beside it | Dying came out as a gain | Net +0.46: died -1.00, hurt -0.60; then health back +1.00, food back +0.42, new sights +0.50, "husk gone" +0.14. DA 0.57 → 0.62 |
| Idle while six new animals appear and a wound mends | Idle took the credit | +2.60 to `idle` in 20 s; idle expected +0.26, +0.10 in the arbiter; DA peaked at 0.84 |
| A full chest 14 blocks off, the bot short of bread | The pull took it there by itself | Cue won 10 to 12 ticks per run; three trips each |
| The same, then an empty chest put nearer | It went to the empty one, then wanted no chest | Set off for the near chest; found nothing; short again with the full chest in view: 0 cues, 0 bread |
| The full chest emptied behind its back | One wasted trip, charged | `wasted_effort` -0.024 and -0.027 (two runs); expected +0.146 → +0.143 |
| A learned trip cut off on the way, six times | The expectation wore down | +0.13 → +0.11 (11%) without the chest once being reached |
| Learned by day, then dusk | Did not want the chest at night | Cues: 10 by day, 0 after dusk; bread got: 0 |
| A caged husk 2 blocks off, removed by the server | Paid for it | "husk gone" +0.39, with the bot only frozen and watching |
| A creeper going off in its cell | Paid for it | "creeper gone" +0.33 (the small blast did not hurt it) |
| Drop a sword and pick it up, four times | Paid each time | `first_tool` +0.51, +0.26, +0.14, +0.07 against -0.06 for the four losses; DA ended at 0.82 |
| At night, in and out of a lit corner, four round trips | Paid each time | `reached_light` 12 times, +0.85 in all; DA ended at 0.76 |

**Problems found.**

- **Dying pays.** Respawning refills health and food, and the reward rules read that as two
  needs being met; the threat is "gone" because the bot was moved away from it; and the respawn
  point is a new sight. Live the whole death netted +0.46 and DA went up. In the old logs the
  median death netted -0.5 (15 deaths, from -1.04 to +0.24). The skill running at death is still
  taught -5, so the scorebook is right; it is DA, mood and the reward signal that are wrong.
  **Would fix:** on a tick where the death count rose, and the next, pay no positive rewards.
- **Whatever is running takes the credit, and that is usually `idle`.** A reward goes to the
  running skill whatever caused it. An animal wandering up, a wound mending, a zombie burning at
  dawn: `idle` is paid for all of it. Live, 20 seconds of idling earned +2.60. Over the old logs
  `idle` collected +143, and its learned value in the arbiter had a median of 0.66 (0.13 on its
  score), on top of Jev's 0.8. This feeds "the bot mostly idles at base".
  **Would fix:** do not credit a resting skill with novelty, healing or a threat leaving; or
  credit a reward only to a skill whose own changes could have caused it.
- **The pull toward things works alone and never wins in the whole brain.** With nothing else
  proposing, the cue walked the bot to the chest every time. In the old logs, cues fired 126
  times and won 0 ticks of 97,487: capped at 0.3, they cannot beat `idle` at 0.8 plus value plus
  the stay bonus. **Would fix:** let a cue add to the urgency of a matching proposal, or lift the
  cap when the cue's reward matches a need the body has now.
- **All chests are one kind.** What the far chest paid made the bot want the near, empty one.
  And only the nearest thing of a kind is considered: once the near chest was known to be empty
  (so `take_items` could not run on it), no cue fired at all, with the full chest in view and
  the bot short of bread. **Would fix:** learn by the thing as well as its kind (this chest), and
  consider the nearest thing of a kind that a skill can run on.
- **Nothing learned by day is known at night.** Each of the five situation labels starts a new
  page in the scorebook. The same holds across fed and hungry, at base and away, alone and with
  a player in view. **Would fix:** fall back to a skill's average over all situations when this
  one has no entry.
- **Novelty is far larger than any need.** Over the old logs it paid +712, against +29 for
  eating, +44 for stocking food, +33 for sleeping and +16 for healing. Live, the first chest trip
  was worth +2.06, of which +1.50 was three new item kinds picked up on the way. The logs
  overstate it (each test scene starts with an empty novelty memory), but a new item in the
  inventory pays as much as finding food when out of it. Item novelty also pays again each time
  an item comes back (bread: "seen 1×", "seen 2×"). **Would fix:** a smaller bonus for items,
  and a cap on novelty per minute.
- **Rewards that pay on the way up and cost nothing on the way down can be looped.** Dropping
  and picking up a sword paid `first_tool` four times running; walking out of the light and
  back paid `reached_light` every time. Repeats are halved, and the count fades in five minutes,
  so each loop pays less, but neither stops and each raised DA to about 0.8. Nothing proposes
  such a loop today; a bot that learns skills by experiment would find it.
  **Would fix:** pay `first_tool` once per kind for good (remember it, like novelty), and make
  leaving the light cost what reaching it paid.
- **A threat leaving pays whoever is there, and escaping pays almost nothing.** The reward is
  the danger at the last tick the threat was within 8 blocks. A caged husk that vanished paid
  +0.39 though it could never reach the bot and the bot did nothing; a creeper blowing up counts
  as "gone" (+0.33). A bot that runs away is paid for the last tick before the gap reached 8
  blocks, which is close to 0: in the old logs 14 of 65 `threat_gone` rewards were under 0.02,
  and live a flight to 17 blocks paid nothing. So fighting at close range is taught and running
  is not. **Would fix:** pay for the fall in danger from its peak during the skill, and only for
  a threat that could reach the bot.
- **A trip cut off on the way counts as a disappointment.** An interrupted run is learned from
  with whatever it had earned so far, usually 0. Six cut-off trips took the expectation from
  +0.13 to +0.11. That is with the learning window on (a fifth of the step); with it off each
  interruption would take a tenth. **Would fix:** do not learn from an interrupted run that
  earned and lost nothing.
- **Wasted effort is charged, but slowly, and not at all for a very short run.** Seen live for
  the first time: -0.024 and -0.027 for a 14-block trip to an emptied chest. Two limits showed.
  A run that starts and ends between two ticks has no effort and no rewards counted (the 4-block
  trip to the empty near chest: effort 0, not charged). And with the learning window on, one
  charge moved the expectation from +0.146 to +0.143; the chest memory stopped the trips long
  before dopamine would have.

**Seen in the old logs, not reproduced live.**

- **The rescue reflexes are blamed for what they rescue from.** `air_steer` averaged -1.36 a run
  over 38 runs and was the running skill at 10 of the 15 deaths; `escape_hazard` averaged -0.17
  and took one -5. Hard reflexes win regardless, so this matters only where the same skill is
  proposed softly. The live fall scene showed nothing: no skill was running when the bot landed,
  so nobody was blamed.
- **Eating through `consume` is fined as a lost item** (29 times): only `eat` and
  `deposit_items` are let off.
- **A biome border re-pays novelty.** Standing on one flips the biome label; `frozen_river` was
  "met" again 23 times after its eighth meeting. The amounts are tiny by then, but the kind's
  novelty is used up without the bot going anywhere.
- **A skill cut short by a reflex is failed on purpose** (-0.1 and a failure on its record).
  `idle` was failed 146 times this way by `surface` in the dive scenes.

**Scenes that showed nothing.** A fall of 8 blocks (see above). A skill made to fail at once
(`go_to` into a sealed box did not fail within 6 seconds). Both were dropped from the check. The
creeper's blast was made small so the bot would live, and it took no damage, so "hurt and paid
on the same tick" was not seen.

**Limits of the check.** One or two runs a scene. The scenes test dopamine alone: with Jev
proposing, most of what the cue did here would be outvoted. The server removes bread from the
bot between trips, which is logged as `lost_items` (-0.06 each); that is the test's doing.

**Status.** Partly closed 2026-11-20 by one change (see "Dopamine: rewards are now the signed change in a need"): dying, idle taking the credit, novelty, the two loops, the threat rewards and the `consume` fine no longer show. Chests as one kind, day and night, interrupted trips, the rescue reflexes and the run between two ticks were closed the same day by two more changes (see "Dopamine: learning by adjustments"). Still open: cues in the whole brain.

## Dopamine: wasted effort, and its limits

*Built 2026-11-19 (`packages/neuromodulators/src/dopamine/wasted.ts`,
`packages/minecraft/src/brain/effort-spent.ts`).*

**What it does.** While a skill runs, the work the body does is added up: blocks travelled, seconds
spent busy, and food energy burned. When the skill ends as done or failed, having earned less than
that work was worth, the difference is charged as a negative reward (`wasted_effort` in the tick's
rewards). It is only charged where the bot expected a payoff. In the behaviour test, after eleven
good trips the chest is emptied:

| Chest | Charged per empty trip | Empty trips until the pull is gone |
|---|---|---|
| 6 blocks away | 0.019 | 29 |
| 48 blocks away | 0.15 | 12 |
| 6 blocks, `wastedEffort: 0` | 0 | never (faint but there after 30, as before) |

Once the pull is gone it stays gone on further empty trips, and comes back in under ten trips once
the chest pays again.

**Limits.**

- **A near chest is still checked many times.** A 6-block trip is cheap, so it takes 29 empty
  trips to stop, against 12 for a far one. That is the scaling asked for, but 29 is a lot. Raise
  `personality.wastedEffort` in `bots.json` to make all effort cost more (2 doubles it).
- **Only a run that expected a payoff is charged.** A first fruitless walk somewhere new costs
  nothing, and neither does going home or storing items, which no reward rule pays for. Without
  this, every unrewarded skill would slowly lose to `idle`. The price: the bot learns "this was a
  waste" only about things that once paid.
- **The charge stops when the expectation crosses zero**, so the expectation settles just below
  zero (by about a tenth of one trip's effort), not at the true cost of the trip. It then drifts
  back up toward zero on later empty trips, without crossing.
- **An interrupted run is never charged**, however far the bot had walked. Nor is one that ended
  in death (the death penalty covers it).
- **The skill and the skill-toward-a-thing were judged apart.** Closed 2026-11-20: a run has one
  expectation now (the skill, here, aimed at that thing) and is charged once.
- **Effort is three hand-set weights**: a block 1/400, a busy second 1/400, a food point 1/40,
  capped at 0.5 a run. Digging, fighting and climbing count only through time and food. Damage
  taken is not effort (it is already a negative reward).
- **"Busy" was any skill but `idle` and `sleep`, by name.** Closed 2026-11-20: it is any skill
  that uses a part of the body, read from the skill. A skill that mostly waits (a slow chest, a
  long dig) is still charged for the wait.
- **Distance is from whole-block positions**, so a tick's movement is rough. A jump of more than
  8 blocks, a respawn, or a gap of more than 2 seconds between ticks counts as no work.
- **Mending hides effort.** While health is coming back, food burned is not counted, even if the
  bot is also sprinting.
- **Wasted effort lowers DA and counts toward a learning window** like any reward, but only a
  charge of 0.1 or more opens one. With the learning window on, a cheap wasted trip still teaches
  at a fifth of the usual size (the finding below).
- **A big reward on the tick a skill ends hides the waste from DA.** The charge is added to the
  tick's total, so an unrelated gain that tick can cancel it there. The scorebook is still charged.
- **Old logs and saved scorebooks are unaffected**; the trace has one new reward name and the
  episode a new `wasted`, `gained` and `effort`.

**Status.** Open. Seen live 2026-11-19 (`pnpm dopamine-check two_chests`): charged -0.024 and -0.027 for a 14-block trip to an emptied chest. A run that starts and ends between two ticks is not charged; see the live entry above.

## Live testing, 2026-11-18: the reticular formation

*Found by running the real bot on the test server with `pnpm arousal-check`. No Jev and no
planner calls, except the no-bed scene (the offline stand-in for Jev, to count calls) and the
frazzled scene (Jev).*

| Scene | Bands visited | What woke it | Calls saved | Outcome |
|---|---|---|---|---|
| Bedtime: night, bed nearby, a day awake (three runs) | awake, drowsy, asleep | nothing | instinct off | All three: sleepy 0.68, bed proposed at 0.35 by the reticular region, asleep 2 s later |
| Not tired: the same, having just slept | awake | nothing | instinct off | Sleepy 0.36; bed never proposed |
| The same far bang early and near morning | awake, drowsy, asleep | startle (0.31 against depth 0.47) | instinct off | Early: depth 0.9, startle 0.49, slept on. Late: woke |
| Food runs down in bed | awake, drowsy, asleep | urge (0.9 against depth 0.9) | instinct off | Woke at food 5 to 6, ate, lost no health |
| Dawn | awake, drowsy | nothing | instinct off | Sleep started once, refused once, then held off for 30 s |
| Tired at night, no bed in reach | awake, drowsy, alert, over-aroused | nothing | 135 of 153 before the husk | Arousal fell to 0.20, the rate to 0.08; a husk put the rate back to 1 in 0.3 s |
| Never sleeps, idle and safe by day | awake, drowsy | nothing | instinct off | Quiet after 66 s; memories consolidated (prune, merge, generalise) |
| Three husks at once | awake, alert, over-aroused | nothing | 0 of 82 | Arousal 1.00; frazzled on 56 to 62 ticks |

Regressions: `neuro-check` sleepgate, night, dark, ambush and calm pass, and so do the medulla,
startle, defence, colliculus, reflex, posture, locomotion and skill checks. In sleepgate (a full
night with Jev): 68 Jev calls made, 1030 saved, about 34 planner runs saved, and sleep was
refused once at dawn (it was about 65 times).

**Found and fixed.**

- **A hit was logged as "getting up".** The game throws a hurt player out of bed before the
  tick that sees the hurt, so the bot was no longer "asleep" when it was judged. The hurt is
  now named whichever came first. (Arousal was right either way: no grogginess after a hurt.)
- **The hunger scene did nothing on peaceful**: food does not run down there.

**Limits of this version.**

- **Jev outvotes bedtime.** Bed is proposed at 0.2 to 0.6. An engine that prefers `idle` at
  0.8 wins, so the bot sits up tired. The offline stand-in always does this, which is why the
  bedtime scenes run without instinct. With Jev it depends on what Jev picks, as before; the
  reticular proposal only adds a vote. Not measured with Jev: in the `night` and `sleepgate`
  scenes the bot had just "slept" (fresh data), was not sleepy, and Jev chose bed itself.
- **"Waking" is not getting up.** A waking opens the gate and stops the region speaking for
  sleep. Whether the bot leaves the bed depends on what is proposed next: for hunger, `eat`
  wins. For a far bang with nothing to do about it, nothing replaces `sleep`, so the bot is
  logged as woken and stays in bed, and the gate shuts again a moment later.
- **Frazzled narrows almost nothing with Jev.** Jev offered 1.1 options on average when calm
  (2 at most) and 1.2 when frazzled: there was rarely a third to cut. And the planner was
  offline (alarm above 0.8) on 52 to 55 of the frazzled ticks, so its one-line note seldom
  reaches it.
- **The planner's saving while drowsy is small and was not measured.** At rate 0.3 it runs
  every 50 s instead of 15. Only instinct's saved calls are counted exactly; the planner's are
  an estimate from the time the gate was shut.
- **Drowsy ticks still run every 500 ms.** The gate spaces Jev's calls; it does not slow the
  loop, the reflexes or the dials.
- **Sleepiness is the same whatever the bot is doing.** A bot a day awake is 0.68 sleepy at
  nightfall and will propose bed in the middle of a job (softly: 0.35). The planner can outvote
  it but cannot hold it back by name (it is not a reflex).
- **Quiet rest needs tiredness.** A fresh bot idling by day sits at arousal 0.5 and never
  becomes drowsy, so it never reaches `quiet`. The scene's bot had been awake three game days.
  The original finding asked for "a long safe idle at base" to count; this counts only a
  drowsy one.
- **Depth follows the clock, not time asleep.** A bot that goes to bed late starts in light
  sleep.
- **"No bed in reach" is 64 blocks from the one base bed.** Other beds are not known.
- **The deep-and-light scene's bang was 0.49 early and 0.31 late.** The two were not the same
  size (the bot was facing differently), though both lie between the two bars (0.54 and 0.24
  to 0.28), so the result holds.
- **With the medulla left out (`--regions`), the bot no longer eats when starving**: that rule
  moved there from the reflexes.
- **Not run live:** a goal's alarm interrupt or failed plan passing the gate while drowsy, a
  heavier sleeper (`wakeThreshold`), the old `brainstem.arousalGate` name, and bedtime with a
  threat in view. All are unit-tested.

## Live testing, 2026-11-18: the defence circuit

*Found by running the real bot on the test server with `pnpm defence-check`. No Jev and no
planner calls: only the reflexes defend. Every scene uses a husk (zombies burn by day).*

| Scene | What it did | Numbers |
|---|---|---|
| A husk 10 blocks off, facing away, that never notices | Froze and watched it | Sized up as seen, not noticed; never noticed |
| The same husk beside a journey's route | Routed round it and arrived | Came no closer than 5.0 to 5.4 blocks; a straight walk passes at 3.5; flight distance 5.6 |
| A husk walks up over open ground | Fled | Began at 8 blocks (flight distance 8); first-tick gain 1.24, urgency 0.87 |
| The same, for a kind that has killed it before | Fled sooner | Began at 11 blocks (danger 0.9, flight distance 11.2) |
| Shut in a 5 by 5 room with a husk, unarmed | Froze, then fought | Known to be cornered 0.2 to 0.7 s after the husk appeared; lived, health 14 to 19 |
| A husk 2 blocks off, sword in hand | Fought and killed it | One kill recorded; analgesia reached 0.70 |
| A husk in a pit 5 blocks off | Nothing: only wary | The cheap guess said it could reach; the route check said no after 0.5 to 1.5 s; alarm stayed at 0 |
| A skeleton held on a pillar, shooting | Fled; learned it shoots | After two hits from afar: able to reach on 0 of 40 ticks before, 87 of 87 after |
| A bot born knowing no threats meets a husk | Nothing until it was hit, then fled | "husk became a threat" on the first hit |
| Hurt while fleeing, then left alone | Pain dulled; then rested | Pain felt 0.34 to 0.37 of 1.00 when struck; rested 5 s, health 6 to 15.8 |

**Cost.** Over the final run's ten scenes (643 logged state reads) sizing up took a median of
0.03 to 0.9 ms per scene and at most 4.0 ms, except one read of 18.8 ms. Almost all of the
ordinary cost is the route check's one slice of pathfinding; without a check it is under 0.4 ms.
Earlier settings (two slices of 2 ms) reached 5.2 ms and once 6.4, so the slice was cut to
1 ms, one per state read.

- **One read took 18.8 ms, over the 5 ms limit.** It asked no route check (the skeleton was 18
  blocks off, beyond the 16 the checks cover) and learned nothing, and the tick it fell in came
  twice as late as its neighbours. That points to the whole process stalling (a garbage
  collection, most likely) rather than to work the threat sense did, but that was not proved.
  The cost is measured by the clock, so any stall inside it is counted.
- **The slower slice makes the answers later.** The pit's "it cannot reach me" came after 0.5 s
  with 2 ms slices and 1.5 s with 1 ms ones. Until then the cheap guess stands.

**Found and fixed.**

- **A blow that knocked the threat back ended the fight.** Armed, the bot hit a husk to 4
  blocks away; that tick it was "coming" (so: flee) or even "not noticed" (so: freeze), and the
  bot dithered between attack, freeze and flee. A threat the bot has struck in the last 5
  seconds now counts as having noticed it and stays "on it" out to 6 blocks.
- **Noticing lapsed the moment a threat paused.** It is now remembered for 5 seconds.
- **Analgesia only built on the ticks the mode said "flee".** A bot outrunning its threat
  flips between flee and wary as the gap opens and closes; it reached 0.31 when struck. While
  the flee or attack skill still runs the body now counts as defending: 0.64.
- **An unnoticed threat stopped the journey meant to go round it.** A threat within 8 blocks
  raised alarm by 0.6, and an alarm jump interrupts the running skill. Alarm now counts only
  a threat that is coming or on the bot; one that has not noticed raises none.
- **The first three shooter scenes never shot.** Summoning a skeleton with a helmet gives it
  no bow; it walked off its pillar and came at the bot instead.

**Limits of this version.**

- **Freezing rarely works against a real hostile.** In this game a hostile notices a player
  within its follow range whichever way it faces; only a mob with its AI off never noticed.
  Freezing helps only out of line of sight or beyond that range. The scene proves the choice,
  not that it pays.
- **A frozen bot can stay frozen.** Nothing ends a freeze but the threat noticing, leaving, or
  another proposal outvoting it (0.5 × gain). With Jev and the planner running they compete;
  a bot left alone watches a harmless far zombie for as long as it stands there. A goal can
  hold `defence_freeze` back.
- **An armed, healthy bot still runs from what is coming.** It fights only once the threat is
  on it (or it is cornered), and it outruns a zombie, so by reflex alone it fights mostly when
  ambushed. That is the table as specified.
- **The route checks walk; they do not open doors, dig, swim well or climb.** A threat behind a
  closed door counts as unable to reach; a way out through a door does not count, so the bot
  can be "cornered" in a room with a door. A spider that climbs is judged as if it walked
  (once it hurts the bot it is "on it" regardless).
- **While the bot is travelling the checks are skipped**, as specified, so a threat met
  mid-journey, and the whole of a flight, are judged by the cheap guess and never count as
  cornered. A flight that runs into a dead end is only found out once the journey ends.
- **A detour of more than 16 blocks counts as no route**, and a way out more than 24 blocks
  round counts as none. Both bound the search.
- **Alarm was not used in choosing the mode.** The spec lists it as an input; nothing in the
  table depends on it, and the gain already carries it.
- **`colliculus.looming` at 0 no longer stops the retreat from something coming fast.** The
  defence circuit reads looming from the state. It still switches off the `looming` signal and
  its alarm trigger.
- **A blast from 5 blocks counts toward "it shoots".** Two creeper blasts that hurt from beyond
  4.5 blocks would mark creepers as shooters. Harmless in effect (they are fled either way).
- **Kills are credited by timing**: the creature died within 5 seconds of the bot's blow.
  Something else finishing it in that time is still the bot's kill.
- **Deaths by a shooter's arrow are blamed on the shooter**; a death with no attacker named in
  the last 5 seconds teaches nothing.
- **Recuperating goes home only within 48 blocks**, else it rests where it stands. It does not
  look for somewhere enclosed or lit. Well fed, the bot mends about 2 health a second, so the
  rest is short.
- **Wary at night, everywhere.** Dark alone makes danger "possible", so caution is up by 0.15
  and the head turns a little more easily all night and underground.
- **A flight hides a shove.** `pushed` is only sensed with no journey under way, so a bot
  fleeing is never "pushed" and `hold_ground` cannot fire. Seen in `reflex-check`: the player
  who shoves the bot was learned as a threat on the second hit, and the bot fled it straight
  toward the ledge (it stopped at the edge; the route does not walk off). That check's bot now
  has `defence.learnThreats: 0`.
- **Fleeing a player by reflex may not be wanted.** Two hits 2 to 60 seconds apart make a
  player a threat for good (until many harmless meetings). Friendly fire in a shared fight
  would do it.
- **Not run live on purpose:** a learned non-hostile threat (an angered wolf or golem; a
  player was learned by accident, above), three threats at once, a goal holding back `defence_flee`, last_stand when
  cornered, and a fight lost. All are unit-tested.

## Live testing, 2026-11-18: the startle circuit

*Found by running the real bot on the test server with `pnpm startle-check`. No Jev and no
planner calls, except the ambush scene, which runs the whole brain.*

| Scene | Magnitude | Flinch or full | What changed its size | Event to start |
|---|---|---|---|---|
| Bang 10 blocks behind, calm | 0.89 | Full | Nothing | 21 to 174 ms over four runs |
| Bang it watched coming (a lit fuse 8 blocks in front) | 0.18 | None | Warning 0.8 | |
| Five bangs 4 s apart, then one two minutes later | 0.89, 0.52, 0.06, 0.22, 0.17; then 0.89 | Full, flinch, then none | Habituation (and a warning on the third) | |
| The same bang in the dark, just after being hurt | 1.00 | Full | Potentiation × 1.6 | 116 ms |
| Its own explosive (placed, lit, walked clear) | 0 | None | Self-caused | |
| A far bang (40 blocks) mid-journey | 0.56 | Flinch; the one journey finished | Nothing | 29 ms |
| A prepared action released by an unrelated bang | 0.89 | Full: `return_to_base` released | Nothing | 33 to 37 ms (127 to 138 ms fired the ordinary way) |
| Ambush, whole brain | 0.72 | Full | Potentiation × 1.15 | 5 ms |
| Starving for a minute | 0.28 | One flinch in 16 hurts | Habituation | |

**Speed.** From the raw event to the brace or flinch starting took 5 to 174 ms, all under the
200 ms aim. The spread is the loop, not the reflex: the state is checked for a significant
change every 100 ms, and two ticks must be 150 ms apart, so an event waits 0 to about 150 ms
before the tick that reacts to it. Deciding and starting the skill then takes 1 to 3 ms. To make
it steadier the loop would need to be poked by the raw event itself instead of polling
(`watchMs` and `minGapMs` in `packages/core/src/brain-loop.ts`); that was not changed.

**Found and fixed.**

- **A prepared action that could not start swallowed the startle.** In the `neuro-check` bang
  scene Claude, unprompted, marked `flee` as `onStartle`. The bang released it, but with nothing
  to flee from the skill could not run, so the bot neither fled nor braced. A prepared response
  is now released only if it can be started right now; otherwise the body braces.
- **The flinch missed the legs.** The journey only looked for a pause every 250 ms, so a 150 ms
  flinch could pass unnoticed. A pause now takes hold at once.
- **In scenes with no Jev, a look took the place of the walk.** A manually started `go_to` has
  nothing proposing it, so the colliculus's competing look at the bang won the tick and ended
  the journey before the flinch ran. Those scenes use `--same-time` so the look runs alongside.
  With Jev running, the walk is proposed every tick and keeps going.
- **Two `neuro-check` checks expected the old behaviour**: "bracing won that tick" (now a
  prepared response may win instead) and "a reflex takes over" (after the startle released
  `flee`, Jev carried the same skill on and outvoted the now calmer reflex). Both were widened.

**Seen, left as it is.**

- **The five bangs are not evenly smaller.** The third fell to 0.06 because the bot was still
  looking toward the last one, which counts as having seen it coming. The fourth, with its head
  elsewhere, was 0.22.
- **An ambush that hurts still takes the planner offline** (see the closed finding above).
- **A starving bot's alarm climbs anyway.** The startle habituates to hunger ticks, but the
  separate damage trigger adds 0.15 for each one: a bot left starving reached alarm 0.58 in 20
  seconds with no startle after the first. That trigger was not part of this change.
- **Standing next to its own blast still startles.** The explosion is self-caused and silent;
  the hurt from it is a second event and is not (an event that is hurting the bot is never
  silenced). In the first run of that scene the bot lost 15 health and braced.

## Startle: limits of this first version

- **The self-caused window is 4.5 seconds, not the spec's "about 3".** An explosive the bot
  lights goes off after 4. Anything else that happens within 8 blocks of where it just dug,
  placed or lit something in that time is also taken for its own doing.
- **Self-caused covers only what a primitive reports changing** (a block broken, placed or
  replaced, a container opened) and what the bot is striking. A door opened with `use_on` leaves
  no trace in `changes`, so its sound is not known to be the bot's own; nor is anything done by a
  skill that does not go through `break_block`, `place_block`, `use_on`, `open`, `hit` or `attack`.
- **"Seen coming" is by place as well as by thing.** A bang within 3 blocks of something the bot
  was attending counts as warned, whatever that something was. A fuse lit more than 2 seconds
  before the bang, and no longer attended, does not: the default 4-second fuse gives no warning
  unless the bot keeps looking at it.
- **Looming is read from the state, not from the colliculus's signal**, which arrives a tick
  late (the colliculus runs after the brainstem). The colliculus and the startle therefore judge
  looming separately.
- **A flinch freezes the legs for 150 to about 400 ms**, not exactly 150: the journey carries on
  at its next look, up to 250 ms later. Steering (swimming, a dash) is paused the same way. A
  single `step` in progress is not.
- **Habituation is by kind and 8-block square.** Thunder from a different square startles
  afresh; an event with no place (a hurt) is habituated by kind alone, everywhere.
- **An ordinary sound never startles on its own** (it tops out below the flinch threshold), a
  door or a shot can flinch, and only explosions and thunder give a full startle by sound alone.
  Those weights (`ONSET`) are hand-set.
- **"Hostile up close" has no raw-event time**, so its event-to-start reads as a few
  milliseconds: it is timed from the tick that saw it.
- **A released response replaces the brace.** The bot does not freeze first; and if several
  entries are marked `onStartle` only the first usable one is ever released.
- **`selfCaused` and `startReact` are still on or off**, as are the other brainstem strengths
  named in the closed finding.

## Live testing, 2026-11-18: the colliculus

*Found by running the real bot on the test server with `pnpm colliculus-check`. No Jev and no
planner calls except in the field-of-view scene, which needs Jev.*

| Scene | What won | Event to head turned | How |
|---|---|---|---|
| Bang 10 blocks behind | The explosion (sound, salience 1.13) | 0.4 to 0.5 s | Startle braced toward it |
| Walking glance (`--same-time`): a pig appears to the side | The pig (sight, 0.67) | 1.6 s | Alongside; the journey finished |
| A still cow close by, a pig running in from 18 blocks | The pig (looming, 1.41, against the cow's 0.20) | 0.4 s | Competes |
| The same penned cow for two minutes | Cow, 2 looks in all: 1, 0, 0, 1 per half minute; 26 glances around meanwhile | | Alongside idling |
| A goal that watches for a pig; a cow and a pig appear at once, same distance | The pig (0.57) | 0.2 s | Takes over |
| Arrows from 12 blocks, a still skeleton at 14 | The arrow (looming, 1.06); alarm 0 → 1; `threat_approaching` fired | 0.4 s | Competes |
| Busy attacking: a pig appears, then an arrow comes from the side | The pig drew no look; the arrow did (looming, 1.13) | 0.2 s | Competes |
| Field of view on and off: a husk 16 blocks behind, with Jev | Off: Jev told at once, at 16 blocks. On: 4.5 s later, at 8 blocks (twice the same) | | |

The times are to the nearest tick. The map itself took under 1.2 ms in all but two ticks of
some sixty runs; those two took 3.3 and 7.3 ms with one or two things on it, on ticks where the
whole region call was slow (most likely the runtime pausing, not the map). The limit is 2 ms.

**Found and fixed.**

- **Arrows never loomed.** Mineflayer reports a spawned projectile's speed 8000 times too small
  on 1.21.11 (the same old-packet scale as the knockback bug), so every arrow looked as if it
  were standing still. The speed is now read from the server's own packet (`senses.ts`).
- **Glass blocked sight.** The first line-of-sight check counted any solid block, so a mob
  behind the test plaza's glass wall was never seen. See-through blocks no longer block it.
- **Sound names cannot be trusted on this version**, as an earlier finding guessed. A probe
  showed a cow's hurt arriving as "coral_block.step" and an arrow landing as
  "armor_stand.place". What is reliable is where a sound came from, its category and its volume,
  and five events with no sound name at all (explosion, lightning bolt, something hurt, a door
  changing, a projectile appearing). Hearing uses only those.
- **The spec's look urgency (0.35 to 0.7) never wins against idling**, as the old orienting
  finding already said (idling scores about 0.9). Two things were done: `idle` now uses no part
  of the body, so a look always runs beside it without interrupting it; and with nothing
  running at all, a look takes over at full urgency. Beside real work it competes at 0.35 to 0.7
  and usually loses, unless `--same-time` lets it run alongside.

**Seen, left as it is.**

- **With the field of view on, the bot learnt of the husk when it came within 8 blocks**, by the
  stand-in for footsteps, in both runs: its glances had not found it first. It was hit once or
  twice either way, and died in one of four runs (with it on). Two runs each way are too few to
  say whether the option costs lives.
- **"Blindsided" overcounts.** The report counts a hit as blindsided unless the attacker itself
  was attended. A bot that turned to the *sound* of an unseen mob attended a place, not the mob,
  so the hit still counts. Both field-of-view runs show 1 for that reason.
- **Fleeing took the bot off the sky plaza once.** In an earlier run it ran from a zombie to the
  plaza's corner, fell to the ground far below and died of the fall. Routes on a journey are not
  held to the posture check's "nothing to stand on" the way a single step is.
- **Getting used to the cow was hard to show**: penned and mostly still, it drew only two looks
  in two minutes to begin with. The scene passes, but it shows little; the unit tests carry this.
- **One event is often seen and heard at once**, and whichever scores higher wins the look. A
  pig that appears is on the map twice (its arrival makes a sound at the same spot). The head
  ends up in the same place either way, but the log may say "sound" where you expect "pig".
- **Standing with nothing to do, the bot's head is rarely where a scene put it**: it glances
  around every 4 seconds. Scenes that need it to face one way have to allow for that.

## The colliculus: limits of this first version

- **`closing` is the thing's own movement toward the bot, not the gap shrinking.** That stops a
  still cow from "looming" when the bot runs at it, but a thing the bot is carried toward (a
  minecart ride, a fall) does not loom either.
- **Movement is sampled four times a second.** Something that crosses the view in under a
  quarter of a second is seen only by where it started and ended. A projectile is caught at the
  moment it appears instead, by a straight-line guess from its first speed: one lobbed high is
  judged by where it points, not where it will land.
- **Looming flees from "the nearest hostile in sight"** when the looming thing is a projectile,
  on the guess that it threw it. With two skeletons it may run from the wrong one; with none in
  sight (a dispenser, a shooter behind a wall) it does nothing but look and take alarm.
- **Anything fast is looming, friend or not.** A wolf or a player sprinting at the bot (over 4
  blocks a second) raises alarm and can set off a retreat. That is the price of not knowing what
  things are; a soft reflex and habituation are what temper it.
- **The stand-in for footsteps knows what is hostile.** It is the one identity leak, kept in one
  function. A silent, unseen friendly mob is not heard; a hostile behind a wall within 8 blocks is.
- **"Seen" is a ray to the middle of the thing.** A mob whose feet show under a ledge is unseen;
  one whose middle is visible through a one-block gap is seen. Leaves and other see-through
  blocks do not block sight at all. Darkness does not reduce it.
- **`changed` covers blocks placed or broken and doors within 8 blocks**, including the bot's
  own digging and placing, which then draw its own eye for a moment (it is usually looking there
  already). Crops growing, levers and redstone are not changes.
- **Habituation's "nothing followed" is only damage or a reward** while the thing was attended.
  A thing that led to something useful in a way dopamine did not reward is got used to all the
  same. Kind-at-place uses 8-block squares worked out from bearing and distance, so it is rough.
- **Glances are to eight fixed compass directions at eye level.** The bot never looks up or
  down on its own, and does not glance while travelling.
- **The field of view filters only mobs, players and listed blocks.** Hazards, the base, the
  inventory and memory are told as before. "Heard" means a sound within a block of where the
  thing stands. With it on, Jev's target list shrinks, which changes what it picks; the planner
  is told less too. Nothing else was tuned for it, which is why it is off by default.
- **A look beside a skill still shows only as `attended`**: its skill events are not in the
  workspace (the earlier finding).
- **The state is bigger.** Each nearby thing now carries its bearing, sight and speed; the busy
  world test's budget went from 3 KB to 4 KB. Jev is sent the whole state.
- **`brainstem.orienting` is gone from `bots.json`.** Use `colliculus.sight`, `hearing` and
  `scanning` instead; `--regions` without `colliculus` turns all looking off.

## Live testing, 2026-11-17: balance and posture

*Found by running the real bot on the test server with `pnpm posture-check`. No Jev and no
planner calls: the scenes tell the bot what to try and drop, move and perch it.*

| Scene | Result |
|---|---|
| Dig the block underfoot, 6 high with nothing below | Refused: "would drop me 3 blocks or more". On a 1-high step: allowed |
| Dig into a wall under a gravel column, at head height | Refused: "unsafe from here (would bring the gravel down beside my head): stand to the side". From the side: done, the gravel came down, never buried |
| Break a block at a cliff edge | Sneak held during the dig and let go after; not held for the same dig on open ground; did not fall |
| Walk a one-wide bridge over a 6-block drop | Unsteady 0.50; crossed at 0.9 blocks a second (sneaking); did not fall |
| Fall 8 blocks, a one-block pool one block to the side | Steered into the water unhurt, 3 of 3 |
| Fall 8 blocks, nothing in reach | Did nothing; 3 falls recorded (8 blocks, damage 5), each noted "no better landing in reach" |
| Teleported 53 blocks mid-journey | Noticed once; journey ended; `replan` raised; did not walk back; `hold_ground` silent |
| Born knowing nothing loose: dig under sand twice | Learned "sand is loose" on the second dig; a third dig under sand at head height was then refused; saved in `surfaces.json` |
| Walk on ice, soul sand and honey | Nothing learned (see below) |

The slowest check in any scene took about 0.4 ms (limit 2).

**Found and fixed.**

- **The bot walked ledges upright.** Sneaking near a drop when careful already existed, but the
  walking rhythm lets go of every key whenever it plans again, and the controller only pressed
  sneak when its own wish changed. So after the first replan the bot crossed the bridge at 3.1
  blocks a second, standing. Sneak is now pressed again on every tick it is wanted
  (`locomotion/tick.ts`). This predates the posture work; the bridge scene caught it.
- **Steering for water landed on the rim.** The first `air_steer` pushed until it landed. The
  air keeps carrying a body after the keys are let go, so it overshot or straddled the edge of a
  one-block pool and took the full 5 damage every time. It now pushes only while the body would
  otherwise come down short.
- **A falling block has not landed when the dig is reported.** 300 ms after the dig the sand was
  still in the air, so "the block above now sits where the target was" never held and nothing was
  learned. The snapshot now notices the block above leaving its place, and the learner confirms
  700 ms later that it landed (so a cactus or plant that merely broke off teaches nothing).
- **"Slow" was nearly learned falsely.** A jog that keeps starting and stopping its sprint covers
  ground at about 0.85 of what `gait.ts` expects on plain stone, and 0.78 on ice (it gets going
  slowly there). With the threshold at 0.8, ice was learned as *slow* in one run. It is back at
  0.7, and the expected pace is weighed by how much of the stretch was sprinted.

**Seen, left as it is.**

- **Slippery and slow cannot be learned on this body.** Three things, each measured: a steady
  walk on ice is no faster than on stone (ice changes how fast the body gets going and stops, not
  its top pace); the pathfinder sets the bot's sideways speed to zero the moment it stops, so
  there is never a slide to measure; and soul sand and honey do not slow this client at all (30
  blocks took 5.3 s on each, the same as on stone). The learning is unit-tested but has shown
  nothing live. **Fix later:** measure how long the body takes to get up to speed, which ice
  does change; soul sand needs Mineflayer's physics fixed first.
- **Two regression failures that were not regressions.** One `skill-check` run lost its
  connection to the server half way ("client timed out after 30000 milliseconds") and every
  later scene failed as "cannot run"; the rerun passed all 20. `neuro-check lava` failed "Jev is
  never offered escape_hazard" because the planner had written the skill's name into a goal
  step, which Jev is shown; the check now looks only at the menu.
- **The water landing was steered 2 times of 3 in the last full run.** The third fall landed in
  the water unhurt too, but the reflex had not started in time: it was luck, not steering.
- **A solid pillar can be dug down.** The spec's "dig down on a pillar 6 high: refused" holds
  only when there is nothing under the block the bot stands on. On a solid pillar each dig drops
  the bot one block, which is safe, and is allowed. The live scene uses a single floating block.
- **The righting reflex needs a brain tick to start.** The fall is noticed on the next tick (up
  to half a second), which leaves about 0.7 s of an 8-block fall to steer in. From 4 or 5 blocks
  there is no time to do anything.

## Balance and posture: limits of this first version

- **An unsafe step or dig can now be chosen, and fails.** `canRun` used to hide them. With
  `--primitives`, Jev may pick one, fail, and pick it again; the scorebook is what should stop
  it, and the "refused three times in a minute" log shows when it does not.
- **Only primitives get stance.** It is held in the primitive wrapper, so a skill that calls a
  movement directly (`eat`, `attack`, the chest skills) is not steadied. `open`, `use_on` and
  `craft` never are: the game will not open a block for a sneaking player.
- **Planning a route, any block with something loose above it is refused**, wherever the bot
  will stand, because that is not known while planning. A route that would have to dig through
  sand or gravel is not found. (The pathfinder had the same rule with its own fixed list; this
  uses what the bot knows, so a bot that has not learned sand is loose will dig under it on a route.)
- **Loose blocks are learned only from `break_block`.** The pathfinder's own digging and
  `dig_out` are not watched. The block must land within 4 blocks below within 0.7 s. A column
  taller than 3 of the same block shows no change to the snapshot and is missed.
- **The loose-block rules look one column and 4 blocks.** A loose block that would slide in from
  a neighbouring column once something else falls is not foreseen. "What the block under me
  rests on" looks one block down only.
- **Climbing blocks are a short fixed list** (ladder, vines, scaffolding), and what a vine hangs
  from is a guess from its sides. No live scene ran on a ladder, in a boat or in flowing water;
  those kinds are unit-tested only.
- **`landing.hurts` knows only height, water, lava, the void and blocks known to hurt.** Slime,
  hay, beds, powder snow, boots and effects are not allowed for, so some harmless landings are
  called harmful (and steered away from).
- **A jump is checked only if the body is already moving.** A standing jump is always allowed,
  and where a moving one comes down is a straight-line guess from its speed.
- **Being moved 8 blocks or less is not noticed** (a short ender pearl throw), and a teleport
  into the same spot is not either. Anything over 8 blocks in one tick counts, including the test
  scenes' own teleports.
- **Unsteady makes the bot careful in more places than ledges.** Standing in water (0.6) or on a
  ladder (0.5) also lifts caution over the line, so no digging or placing on routes there. One
  cliff edge beside the bot does not.
- **The balance numbers are hand-set**, as are the edge factors. `headroom` is reported but
  nothing reads it yet.
- **The fall's "edge" is where the bot last stood.** For a bot knocked off a ledge that is right.
  For one that jumped a gap and fell short, the take-off spot is marked, not the gap.
- **The posture trace rides in the brainstem's.** With the brainstem lesioned (`--regions`) there
  is no `unsteady` signal and no posture trace, though the check, stance and learning still work.
- **`posture.check: 0` removes every protection the check gives**, including the ones that
  existed before it (lava, water, the drop underfoot). It is for experiments.

## Live testing, 2026-11-17: the medulla (body upkeep)

*Found by running the real bot on the test server with `pnpm medulla-check`. The two dive scenes
run the whole brain with Jev; the rest run without instinct, so only the reflexes and the medulla
decide.*

| Scene | Result |
|---|---|
| Dive, free | The urge to breathe rose from 0.30 (air 12) to 0.90 (air 7) and won only at air 7; see below |
| Dive, urge held back by the goal | Urge damped to 0.09 to 0.27; the bot stayed down; `drowning` took over at air 6; it lived |
| Hurt and hungry, safe food | Ate up to food 18 and stopped; health went from 10 to 19 |
| Starving | `eat_when_starving` fired and it ate |
| Bad food | Poisoned twice by spider eye, learned it, then ate only the bread |
| Poisoned, carrying milk | Drank it 1.8 s after the poison began |
| Hungry while asleep | Woke and ate, but late; see below |

**Found and fixed.**

- **The urges lost to instinct whenever the bot was calm.** They first used the brainstem's gain,
  which is 0.6 with no alarm, so a 0.5 urge fired at 0.3 and never won. Upkeep now takes only a
  goal's hold-back, not alarm or bravery.
- **A bad food was never learned.** A spider eye's poison arrives with the last mouthful, before
  the `eat` skill has noted that the meal ended, so the gut had nothing to blame. The meal is now
  noted as the bite begins as well.
- **Effects outlived the body.** Mineflayer keeps a dead bot's status effects, so a respawned bot
  still read as poisoned. They are cleared on death, as is the freezing meter.
- **The urge at its strongest still lost to habit.** At air 7 the urge (0.90) faced `idle` at
  0.78 plus learned value plus the stay bonus for the running skill (+0.13): about 0.96. It won
  in some runs and not others. The medulla now shares its strongest urge as an `urge` signal, and
  the arbiter shrinks the stay bonus by it (bonus × (1 − urge)). Three runs in a row then
  surfaced from the urge. This changes the arbiter slightly for every skill while an urge is
  firing, including the urge's own skill once it is running.
- **The body heals at food 18, not 17**, on 1.21.11. `eat_to_heal` eats to 18.
- **A chest that would not open froze the whole brain for 20 seconds.** In a `neuro-check`
  drowning run, Jev picked `take_items` just as the bot was moved into the water. The chest never
  opened, Mineflayer waits 20 seconds for it, and the brain waits for a stopped skill to finish
  before its next tick. No reflex could act: air went from 20 to 0 and the bot took damage before
  `drowning` got a turn. Opening a container can now be stopped at once
  (`packages/minecraft/src/primitives/open.ts`). This was not new with the medulla; the scene just
  happened to catch it. Other waits on the game inside a skill may hide the same thing (see the
  limits below).

**Seen, left as it is.**

- **The urge to breathe wins late.** It is 0.90 at air 7, and until then Jev's `idle` (about
  0.78 plus its learned value) outvotes it. So the bot starts up at air 7, needs a second or two
  to swim, and `drowning` still fires on the way. The spec's "well before 6" is not met: it
  surfaces from the soft urge, but one point before the limit. **Fix later:** start the urge
  higher or earlier (`NEED_AIR` in `medulla.ts`); the 0.3-to-0.9 curve was left as specified.
- **With a goal that tells Jev to stay still at the bottom, the urge may never win** (Jev's
  confidence in `idle` goes to 0.98 and stays there), and only `drowning` saves the bot. The
  free-dive scene uses a goal that does not say that.
- **A sleeping bot let itself starve until it hurt.** `eat_when_starving` fired at 0.54 (soft,
  gain 0.6 while calm) and lost to "stay asleep" (0.5 plus learned value plus the stay bonus). It
  woke only when starvation damage began, 4.5 s after food reached 6. `eat_when_starving` is a
  reflex, not a medulla urge, so the new `urge` signal does not help it. **Fix later:** give the
  starving reflex the medulla's gain, or move it into the medulla.
  **Closed 2026-11-18:** it is a medulla urge now, and an urge stronger than depth × 0.6 wakes
  a sleeper. Live: woken at food 5 to 6, it ate and lost no health.

## The medulla: limits of this first version

- **Nothing acts on `cold`, `tired`, `reserve` or `vitals`.** They are shared and logged for a
  later drives region. `cold` was checked by reading the freezing meter in powder snow, not by a scene.
  **Partly closed 2026-11-18:** `tired` now feeds the reticular formation's `sleepy`, which
  lowers arousal and sends the bot to bed. `cold`, `reserve` and `vitals` still have no reader.
- **`tired` counts time since the bot last woke from a bed**, by the world's age. A bot that has
  never slept counts from when it first joined. Phantoms, the game's own cost of not sleeping,
  are not modelled.
- **Blame for a bad meal is by timing alone.** Any harmful effect that starts within 5 seconds of
  a meal is blamed on the food, unless a hostile is within 8 blocks, in which case the food is
  never blamed (a witch could hide a truly bad food for a while). A splash potion thrown from
  further away, or a beacon-like source, would be blamed on lunch. Two occasions are needed, so
  one coincidence teaches nothing.
- **Foods whose harm is a chance are learned slowly or never.** Rotten flesh gives hunger 80% of
  the time, raw chicken 30%: a bot born without them needs two unlucky meals. Chorus fruit and
  suspicious stew harm in ways that are not status effects (a teleport) or vary by stew, and can
  only be known from the born-knowing list.
- **`hunger` (the effect) counts as sickness.** It is how rotten flesh is learned, but it also
  means a bot under a husk's hunger effect reads as sick, and drinks its milk for it.
- **One cure, hand-written.** Only `milk_bucket`, and it is drunk for the mildest effect it
  clears, which also strips any good effects. Honey for poison, and learning cures, are marked
  `HOOK(learn-cures)`.
- **`eat_to_heal` does not look for food.** With none in the inventory it stays silent; finding
  food is left to instinct and the planner. It also keeps quiet with a hostile in contact, so a
  bot in a long fight does not eat.
- **`eat` with a level stops at the first bite that reaches it**, so it can overshoot by one food's worth.
- **Holding back is all or nothing.** A goal that names `need_air` damps it to 0.3 for as long as
  the goal lasts; the planner cannot say "until air 8".
- **The pain signal is from health lost**, so absorption hearts hide pain, and a bot at half
  health reads the same pain from 2 points lost as a full one.
- **A skill that cannot be stopped stops every reflex.** The brain does not tick again until a
  stopped skill has ended. Opening a container is fixed; other waits on the game (crafting,
  moving items in a window, sleeping in a bed) were not audited. **Fix later:** have the loop give
  a stopped skill a short deadline, then carry on without it.
- **`neuro-check drowning` now accepts either the urge or the hard reflex** as what starts
  `surface`, since which one wins depends on what Jev proposes. In about one run in three Jev
  picks `return_to_base` and swims the bot up before breath is short; the scene then passes and
  says "NOT TESTED this run". `pnpm medulla-check dive` is the dependable test.
- **The live scenes other than the dives run without instinct**, so they show that the urge fires
  and its skill works, not that it wins against Jev. Only the dives test that, and the free dive
  passes only with a goal that does not tell Jev to stay put.

## Live testing, 2026-11-16: the withdrawal and stretch reflexes

*Found by running the real bot, with only its reflexes deciding, on the test server with
`pnpm reflex-check`. None of this showed up in the unit tests.*

**What the scenes showed** (a bot born knowing only that lava and fire hurt):

| Scene | Result | Hurt to withdrawal starting |
|---|---|---|
| Cactus | Pulled away twice, learned cactus, then walked past it unhurt | 18 ms, 50 ms |
| Magma floor | Pulled away twice, learned magma_block, then crossed a strip of it through the one gap | 19 ms, 68 ms |
| Berry bush | Pulled away twice, learned sweet_berry_bush, then passed a hedge through the gap | 60 ms, 134 ms |
| Buried in sand | Head inside a block; got out by moving to open space; full health | |
| Lava edge, one step at a time | Stopped at z=38 with lava from z=37; never in lava | |
| Shoved toward a drop | Held and stepped back all 3 times (urgency 0.77 to 0.95) | |
| Shoved, hold_ground held back | Gain fell to 0.30 to 0.42 (urgency 0.24 to 0.33); it still held, see below | |

Hurt to withdrawal starting: median 60 ms, slowest 134 ms, none over the 250 ms aim.

**Found and fixed.**

- **The bot could not be knocked back at all.** On 1.21.11 the server sends a knock in blocks per
  tick, but Mineflayer still divides it by 8000 (the old packet's scale), so a hit moved the bot
  nowhere. Every fight so far had been against a bot that could not be shoved. The real push is
  now applied (`packages/minecraft/src/body-events.ts`).
- **The new pathing rule crashed the bot on a long route.** Planning 500 blocks home, the
  pathfinder looked past the loaded world and handed the rule a block with no position; the rule
  asked the world about it and the whole process died. Only the `dark` scene walks that far, and
  only when Jev picks `return_to_base`, so it showed up on the third regression run. The rule now
  treats such a block as unknown. Nothing in the unit tests could have caught it: the rules are
  only ever run by the real pathfinder.
- **A typed-command input kept the bot's process alive after Ctrl+C** (`--manual`). It is closed
  on shutdown, and the scene runner kills a bot that does not stop.

**Seen, left as it is.**

- **A hit throws the bot about 6 blocks.** The server's knock for a standing punch is 1.2 blocks
  per tick sideways and 0.4 up, and the bot is in the air for most of it, where no reflex can act.
  `hold_ground` can only work on what is left after it lands. I could not compare this with a
  vanilla client; 1.2 looks large against the 0.4 the game's own code suggests. If you hit the
  bot in your own client and it flies further than a player would, the number is wrong.
- **Pistons do not move this client.** Nor do the server's slowness effect or a movement speed of
  0 (found earlier). Only knocks and explosions push it, so being pushed is rarer for this bot
  than for a real player.
- **Holding back `hold_ground` made no difference in the scene.** The goal damped it to a gain of
  0.30 to 0.42, but with Jev out of the scene nothing else proposed anything, so even at urgency
  0.24 it won and the bot stepped back. A hold-back only matters when something competes. Also,
  in neither run would the bot have gone over: each knock left it a block short of the edge.
- **On the lava edge both protections acted.** The `step` primitive refused the last step by
  itself once (it will not step where it cannot stand), and `about_to_touch` fired once.
- **Buried, it walked out rather than dug.** Sand fell on its head; open space was one block away.
  Digging out when boxed in is covered by unit tests only.
- **Hurt-to-start times are better than the loop's regular tick** (500 ms) because a hurt wakes
  the loop at once: it checks for a significant change every 100 ms. The worst case is about
  100 ms to notice, plus the tick itself.

**In the regressions afterwards.** The reflex check (7 scenes), the locomotion check (9) and the
primitives pass (20) all passed in one run each. In `pnpm neuro-check` 13 of 17 scenes passed
first time; the other four passed once understood:
- `hold`: the bot can now be knocked about, so it reached the scene's fixed 14 damage with only
  14 health and died. The scene now heals it first. Fights cost the bot more than they used to.
- `drowning`: Jev chose to walk home, and the swim pattern kept the bot's head above water, so
  it never ran short of air. Passed on re-run.
- `dark`: starting at night beside its bed, the bot went straight to sleep, and a bot woken by
  being moved starts from its lowest focus. The scene now moves it before night falls. It then
  exposed the crash above.
- `sleepgate`: two plans arrived while paused, both started before a pause began. The check now
  allows two.

**Status.** Fixed, except the items under "left as it is".

## Reflexes: limits of the withdrawal, stretch and learning

*Found 2026-11-16 while building `packages/minecraft/src/brain/protective-reflexes.ts` and `pain.ts`.*

- **The pathfinder did not avoid what the safety checks called dangerous.** By itself it keeps
  out of fire, lava and cobwebs only: it would cross a magma floor or brush a cactus. The pathing
  rules now refuse to step on or into a block known to hurt, and charge for brushing past one.
- **Blame is a guess.** If the game's damage kind does not name a block the body is touching,
  every block it is touching is blamed. Two incidents on plain stone next to an unnamed hazard
  would teach it that stone hurts, and it would then refuse to stand on stone. `hot_floor` is the
  one kind with a hand-written pointer (it blames what is under the feet).
- **Learning is all or nothing, and never forgotten.** Two incidents make a block type known to
  hurt for good. There is no unlearning, no "hurts a little", and no notion of a harmless state of
  the same block (a berry bush with no berries).
- **"Never learn the base's blocks" is a short list**: chests, beds and crafting tables.
- **`about_to_touch` reads the direction the body is moving**, taken over the last 150 ms. A bot
  standing still next to lava does not trigger it, and it looks at the whole block ahead, not the
  exact path.
- **It is skipped on any planned walk.** That trusts the pathing rules. A journey that steers by
  keys (`swim`, `dash`) is not skipped.
- **"Pushed" means half a block of movement, across the ground, in 300 ms, with no journey under
  way and no movement key held.** A slow push (flowing water) is under the threshold. For 300 ms
  after its own movement stops, sliding is not counted. Falling is not a push.
- **`steady` and `recoil` step back to a spot worked out from whole-block position**, so the spot
  can be up to half a block off; if it is not safe to stand on they only stop and sneak.
- **Soreness only changes two numbers** (the look-ahead and `hold_ground`'s base). Nothing else
  reads the `sore` signal yet.
- **The soft reflexes' strength settings scale their base urgency**; the hard ones are on or off.
- **`withdraw` can run two or three times for one hurt.** The reflex fires while the hurt is fresh
  (600 ms) and the bot is within 2 blocks of the place; each run after the first finds it is
  already clear and ends at once.
- **Falling has no reflex**, by design. `edge_guard` and `hold_ground` are the protection.
- **`--manual` is plumbing for live checks**: the bot takes "do <skill> [target]" lines on its
  standard input. It is off unless asked for.

**Status.** Open.

## The demo runner: what it can and cannot show

*Found 2026-11-16 while building `pnpm demo` (`apps/run-bot/scripts/demo.ts`), tested with a
stand-in viewer that recorded what reached its screen.*

**What we saw.** Ten demos, each tied to one finding. In my test runs:

| Demo | Result |
|---|---|
| `follow` | Asked to stay within 3 blocks; typical gap 6.3. |
| `door` | Door ahead: opened it. Door 4 blocks to the side: broke 6 blocks of glass to get past instead. |
| `pond` | Low walls: went along the wall top. High walls: swam. |
| `speeds` | Slow 7.7 s, resting 6.4 s, alarmed 6.1 s over 34 blocks. |
| `glance` | Head on target 83% of a flat walk, 80% over steps. |
| `stuck` | Tried a jump, then a sidestep, then ended as "no path found". |
| `lava` | Got out, then burned for 14 s with no water near; lived at 4/20 health. |
| `hold` | Lived at 6/20 health; `last_stand` pulled it out. |
| `far` | Once it fled and attacked (the gap was too shallow, since fixed); once it only looked. |
| `dawn` | Sleep started 45 times and refused 45 times. |

**Limits.**
- **Three demos do not show their limit every time.** `hold`, `far` and `dawn` run the whole brain
  with Jev, so they vary. `glance` is close: the head only flicks away for a moment on each jump.
  The runner says how many runs so far showed the limit.
- **The `stuck` demo's jump cannot be seen.** The test holds the body still by switching the bot's
  own movement off, so the jump and the sidestep happen only as key presses; chat names each one.
- **The door demo's bot breaks the glass side wall, not the plank wall.** It takes the cheapest
  way through, which is the point, but it is the glass you will see go.
- **Only visible limits have demos.** What dopamine learns, memory strength and planner timing
  stay in `pnpm brain-report`.
- **I could not see it as you will.** The stand-in confirmed the camera moves, titles, chat lines,
  the readout and the game-mode switch all arrive. Whether each camera spot gives a good view is
  untested; you can fly freely as a spectator.
- **One viewer.** It shows to the first player who is not a test bot (or `--viewer`).
- **The whole-brain demos need `TYPESAFE_API_KEY`** (Jev) in `.env`. They use a fixed plan, so no
  Claude calls are made.

**Status.** Open.

## Live testing, 2026-11-16: the locomotion controller

*Found by running the controller on the test server with `pnpm locomotion-check` (nine scenes).
None of this showed up in the unit tests.*

**What the scenes showed.**

| Scene | Result |
|---|---|
| Flat walk, 30 blocks | Arrived in 5.5 s; 27.5 blocks reported (it stops within range, a block short). |
| Same walk, three speeds | Slow 6.8 s (never sprints); resting 5.7 s (sprints from 0.85 s); alarmed 5.4 s (sprints from the first step). |
| Across a pond | Walk → swim → walk, arrived. |
| Boxed in a pit | Failed at once with "No path to the goal!", standing still. |
| Held fast on an open path | Tried a jump, then a sidestep, then ended cleanly with no keys held. |
| Through a closed door | Opened it, walked through, left the wall whole. |
| Follow a moving player, 30 s | Stayed within 8 blocks throughout, typically 6.2. |
| Stop mid-journey | No keys held at once; did not move afterwards. |
| Looking while walking | Head north, legs east, 0.1 blocks off its line, arrived. |

**Found and fixed.**

- **The pathfinder went round the pond along the top of the plaza's glass wall.** It prefers any
  dry route. The scene now walls the pond in. In play this means the swim pattern is used only
  when there is no dry way.
- **Following never closed the gap.** The pathfinder plans to where the target was, and at a jog
  the bot sprints only on stretches that have proved straight, which a route that keeps being
  re-planned never does. A following bot now sprints to catch up once it is 2 blocks beyond its range.
- **"Follow once" could never finish.** The pathfinder judges "within range" by whole blocks, so
  it could stop at 2.3 blocks when 2 was asked, and the exact check never passed. Its word is now
  taken as well.
- **Slow-planning logs were noise.** The pathfinder reports a running total for a route, so every
  report of a long search looked slow. Only a single slow round is logged now.

**Seen, left as it is.**

- **Alarm barely speeds up a long straight walk.** At the resting drive the bot is already
  sprinting 0.85 s in, so full alarm saved 0.3 s over 30 blocks. The difference is on winding
  routes, where a jog keeps dropping to a walk. A slow walk (speed under 0.3) is clearly slower.
- **A pit does not exercise the recoveries.** The pathfinder knows there is no way out and says
  so in 0.3 s, so the journey fails as "no path", not "stuck". That is clean, and better than
  jumping about. Recoveries are for when the plan looks fine and the legs still get nowhere.
- **The third recovery (plan again) and the final "stuck" failure were not seen live.** The
  server's ways of holding a player still (a slowness effect, a movement speed of 0) do not hold
  this client, so the scene switches the bot's own movement off, which also stops its route
  planner. After the jump and the sidestep the journey ended as "no path found within 10s". The
  full chain is covered by the unit tests.
- **Following trails by about twice the range.** Asked to keep within 3, it sat at about 6. The
  pathfinder plans to where the target was a moment ago.
- **Times are only good to a quarter of a second,** which is how often the controller looks.

**In the neuro-check regression afterwards.** 15 of 17 scenes passed in one run; `far` and `hold`
failed and passed when re-run.
- Both failed because the locomotion test world had left a stone floor under the plaza, so the
  `far` scene's gap was only two deep and the zombie walked across it. The test world now cleans
  up under the plaza, and the neuro-check plaza clears it too. `hold` passed on the first re-run.
- `far` then failed once more for a different reason: Jev chose `flee` from the zombie 9 blocks
  away (probability 0.59), though no reflex fired. It passed on the next run. This is the known
  limit: Jev is only asked to leave far threats alone.

**Status.** Fixed, except the items under "left as it is".

## Locomotion: limits of this first version

*Found 2026-11-16 while building `packages/minecraft/src/locomotion/`.*

- **Doors are found by a simple rule.** A door counts only if the bot and its goal are on
  opposite sides of it and the straight line between them passes within 1.2 blocks of it, within
  6 blocks of the bot. A door round a corner is not found; the pathfinder then digs through the
  wall (normal rules) or reports no path (careful rules). Fence gates and trapdoors are not handled.
- **Swimming steers straight at the goal.** It does not plan a route through water or look for a
  shore; a bank more than one block high can stop it. Then it plans again, up to three times.
- **The jog is judged by heading.** "A straight open stretch" means the heading has held within
  about 11 degrees for 0.8 s. It does not look at the route ahead.
- **Sneaking near a drop** looks at the eight blocks round the feet. It does not know whether the
  route goes that way.
- **"Careful near home" is a fixed 16 blocks** round the base chest, and means no digging at all
  there, even if digging is the only way.
- **Late is only estimated for `goTo`.** Following and retreating have no fixed end. The estimate
  uses the first route found, or the straight distance if that is longer.
- **Hunger slows the bot through any speed link.** The spec's formula has no strength for hunger;
  it is scaled by the larger of `speedFromAlarm` and `speedFromDopamine`, so with all strengths at
  0 the drive is fixed as asked.
- **The alarm override on caution follows `speedFromAlarm`.** With that at 0 a frightened bot
  still tiptoes.
- **`attack` chases through `follow`** and stops it to swing. Each chase is a separate journey,
  so one fight can log several short journeys.
- **A stuck spot is avoided by cost, not forbidden** (60 extra per step, where the pathfinder
  treats over 100 as impossible), and the marks are not saved between runs.
- **The pathfinder's thinking time is capped** at 3 s per route and 15 ms per game tick (it was
  5 s and 40 ms). Long routes take more ticks to plan but hold up the rest of the brain less.
- **The `stuck` signal has no reader yet.** The hook for the search dial is marked, not wired.
- **The head override still reads and rewrites keys around the pathfinder's tick**; it now lives
  in the controller (`tick.ts`), with `gaze.ts` only choosing the keys.

**Status.** Open.

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

**Status.** Partly closed 2026-11-18. What the bot is looking at is now in the workspace as `attended` (set by the colliculus), so the rest of the brain can read it. The look's own skill events are still not added: dopamine does not learn from a side movement and patience does not time it.

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

**Status.** Partly closed 2026-11-18. The reticular formation now proposes bed by itself when the bot is sleepy (live, three runs of three, with no Jev). It is a soft vote (0.2 to 0.6), so Jev can still outvote it. The dark half is untouched: a running `sleep` still counts as rest while the bot walks to a far bed (though with the bed more than 64 blocks away the skill now refuses to start).

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
  **Closed 2026-11-18:** after the game refuses, neither the reticular formation nor the sleep
  skill tries again for 30 seconds. Live: one start and one refusal at dawn, alone and in the
  full-night scene with Jev.

**Status.** Fixed, except the items above.

## Brainstem: "can it reach me" is a guess

*Found 2026-11-15 while building defence by distance (`packages/minecraft/src/encode/scan-mobs.ts`).*

**What we saw.** A hostile counts as reachable when it is within 3 blocks of the bot's height and
nothing solid is between its eyes and the bot's. A zombie across a pit at the same height counts
as reachable. One behind a fence or glass does not, though it may walk round.

**Why.** Real reachability needs a path search per mob per tick, which is too slow.

**What would fix it.** Run the pathfinder for the nearest one or two hostiles only, every second or
so, and cache the answer.

**Status.** Closed 2026-11-18. The defence circuit asks the pathfinder about the nearest two threats, at most once a second each, and keeps the answer. Live: a husk in a pit 5 blocks away counted as reachable by the old guess; the route check said no within half a second, and the bot took no defence. The guess is still used for every other threat, until the first answer arrives, and while the bot is travelling.

## Brainstem: a far threat gets no reflex, even one that shoots

*Found 2026-11-15 (`packages/minecraft/src/brain/reflexes.ts`).*

**What we saw.** Beyond 8 blocks no defence reflex fires. A skeleton shoots from 16. The bot only
looks at it until it is hit (which startles it) or the skeleton comes within 8.

**Why.** The zones are the same for every mob. Ranged mobs are only special in contact (always
flee, never attack).

**What would fix it.** Give ranged mobs a wider "approaching" zone, as far as they can shoot.

**Status.** Closed 2026-11-18, without a list of ranged mobs. Something coming at the bot fast (a projectile heading its way, or anything closing at 4 blocks a second or more) is "looming": it raises alarm and makes `threat_approaching` fire whatever the distance. Live: with a still skeleton 14 blocks off, the first arrow raised alarm from 0 to 1 and fired the reflex. A far mob that has not shot yet still gets only a look.

## Brainstem: an unreachable mob close by still keeps alarm up

*Found 2026-11-15 (`packages/minecraft/src/brain/alarm.ts`).*

**What we saw.** The reflexes treat a hostile that cannot reach the bot as far. Alarm does not: it
counts any hostile within 8 blocks as a threat, so alarm will not fade while a zombie stands
behind a wall. Reflex gains stay high and ticks stay fast.

**Why.** The spec said to keep alarm's existing rules. Alarm and the reflexes now disagree on what
a threat is.

**What would fix it.** Have `threatPresent` and `hostile_appeared` use the same zones.

**Status.** Closed 2026-11-18. Both now use the defence circuit's assessment: only a threat that can reach the bot (or shoots, with a clear line) and is coming or on it counts. Live, with the husk in the pit: alarm stayed at 0 for the whole scene.

## Brainstem: the first tick of a threat is damped

*Found 2026-11-15 (`apps/run-bot/src/brainstem-behaviour.test.ts`).*

**What we saw.** When a hostile appears, the reflex fires with last tick's alarm (0), so its gain
is 0.6: fleeing is proposed at 0.42, which Jev can outvote. One tick later (150 to 500 ms) alarm
has risen and the gain is above 1.

**Why.** The reflex region is listed before noradrenaline, so it reads alarm one tick late. The
spec allowed this. A hostile first seen within 3 blocks is covered by the startle (urgency 1).

**What would fix it.** List noradrenaline before reflex, or compute this tick's alarm bump inside
the gain.

**Status.** Closed 2026-11-18. The gain uses this tick's `threat` (0.8 for a threat that is coming) when it is above last tick's alarm. Live: the first tick of a flight had gain 1.24 and urgency 0.87. Reordering the regions was not the cleaner fix: noradrenaline needs dopamine's surprise and the brainstem's startle, which come after the reflexes.

## Brainstem: a close ambush now takes the planner offline every time

*Found 2026-11-15 (`packages/minecraft/src/brain/alarm.ts`).*

**What we saw.** A hostile appearing within 3 blocks raises alarm by 0.6 (hostile appeared) plus
0.3 (startle), to 0.9. Above 0.8 the planner goes offline until alarm is back under 0.5.

**Why.** Triggers add up. Before the startle existed the same ambush reached 0.6 unless the bot
was also hit.

**What would fix it.** Take the larger of the two instead of the sum, or lower the startle's share.

**Status.** Closed 2026-11-18. A startle now adds 0.4 × its size, and alarm takes the larger of the startle and the trigger for the same cause. Live, with the whole brain: the tick a zombie appeared 2 blocks away gave alarm 0.60 (it was 0.9), and the planner stayed online on arrival. Once the zombie lands a hit, the damage adds on top and alarm still passes 0.8: in that run the planner was offline for 50 of the fight's 55 ticks. So an ambush that is only seen no longer takes the planner offline; one that hurts still does.

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

**Status.** Partly closed 2026-11-18. A goal can now hold back one defence (`defence_freeze`, `defence_flee` or `defence_fight`) and leave the other two at full strength. Naming the skill (`flee`) still damps every reflex that proposes it, and held back, the flee is still not replaced by anything: only one defence is chosen each tick.

## Brainstem: most strengths are on or off

*Found 2026-11-15 (`packages/region-brainstem/src/settings.ts`).*

**What we saw.** `gains` and `holdBack` scale smoothly from 0 to 1. `startle`, `orienting`,
`loadedResponses`, `arousalGate` and `bodySignals` are on above 0 and off at 0.

**Why.** There is no natural "half a startle". The noradrenaline and focus effects work the same way.

**What would fix it.** Give each a meaning for in-between values (e.g. startle strength scales the
alarm it adds).

**Status.** Closed for startle 2026-11-18: `brainstem.startle` now multiplies the size of every startle (0 to 1.5), and `potentiation`, `warning` and `habituation` scale smoothly too. `orienting` is gone (the colliculus has its own strengths). `loadedResponses`, `arousalGate`, `bodySignals`, `selfCaused` and `startReact` are still on or off.

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

**Status.** Closed 2026-11-18. The colliculus closed the hearing and looking parts. Damage with no attacker now startles too, by how much it cost, with no special case for hunger or fire: a small hurt that repeats startles the first time at most and is then habituated (live: 8 starvation hurts in a minute, one flinch).

## Brainstem: a cue can wake a sleeping bot

*Found 2026-11-15 (`packages/region-brainstem/src/brainstem-region.ts`).*

**What we saw.** While asleep and undisturbed, Jev is paused, so the brainstem proposes staying
with `sleep` at urgency 0.5. Dopamine's cues (at most 0.3) lose to that. A focus cue pulse (0.6)
would win and get the bot out of bed. Not seen live.

**Why.** Something has to speak for staying asleep once Jev is silent, and 0.5 is a guess.

**What would fix it.** Skip cue pulses while `upper_paused` is up.

**Status.** Closed 2026-11-18. Asleep, focus's cue pulse and dopamine's cues propose nothing. Unit-tested; not seen live before or after.

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

**Status.** Partly closed 2026-11-19. Wasted effort is a reward signal, so an empty trip that
cost 0.1 or more (about 40 blocks of walking) now opens a window and is learned in full. A cheaper
one still is not. Turn the window off with `learningWindow: 0`.

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

**Status.** Closed 2026-11-18, in part. The state has said whether the bot is in bed since the medulla work, and a minute of drowsy, safe stillness (`quiet`) now counts as rest too. Live: a bot that never slept consolidated after 66 s idle by day. It has to be tired enough to be drowsy; a fresh bot idling does not qualify.

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

**Status.** Closed 2026-11-19. A trip that was expected to pay and did not is now charged the
effort it took, so the expectation crosses zero and the cue stops: after 29 empty trips to a chest
6 blocks away, 12 to one 48 blocks away (behaviour test; see "Dopamine: wasted effort"). With
`personality.wastedEffort: 0` the old behaviour is kept.
