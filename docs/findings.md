# Findings to revisit

Things we noticed while building that work but may need attention later. Each entry says what we
saw, why it happens, and what would fix it. Newest first.

## Problems with the current design

*First written 2026-11-19 by reading every entry below; brought up to date 2026-11-22 after the
dopamine, defence, serotonin, noradrenaline and acetylcholine work. Each item is a problem that
shows up in several findings and comes from how the brain is built, not from one bug. The
entries named in brackets hold the evidence.*

1. **One urgency number decides everything, and the rules for who wins are spread about.** Every
   proposal competes on the same 0 to 1 scale. What bends that scale now lives in several
   places: looks at full urgency when idle, the body's urge shrinking the stay bonus, a pressing
   need loosening Jev's options while something is wanted, patience restraining what has cost
   the bot, and the cornered fight as a hard reflex. Habit no longer wins by default (the stay
   bonus goes within 10 s without progress), but a soft reflex can still lose to Jev by a
   hundredth. *(Reticular: "Jev outvotes bedtime"; medulla: "the urge at its strongest still
   lost to habit"; colliculus: "the spec's look urgency never wins"; cornered: "freeze (0.78)
   still loses to Jev's flee (0.79)".)*
   **Would fix:** rank by layer before urgency (a body need outranks a habit), or score the
   layers on separate scales that the arbiter combines by one stated rule.

2. **The planner can only talk to Jev.** A goal reaches behaviour as text in Jev's prompt. The
   arbiter never sees it, nothing carries out a step, and a finished step is noticed up to 15
   seconds late. So "leave far threats alone" is persuasion, a goal that says "stay still" can
   drown the bot, and the forced retreat goal can be overwritten. Its controls over the lower
   layers are coarse too: a hold-back is all or nothing and lasts as long as the goal. And a
   want for an item exists only while a goal asks for it. *("Planner steps"; "The forced
   retreat goal can be overwritten"; medulla: "holding back is all or nothing"; dopamine: "a
   bot with no goal asking for food does not want a chest of it".)*
   **Would fix:** let the planner (or a region acting for it) make proposals the arbiter can
   weigh, with a "done when" condition per step that code checks every tick.

3. **What the bot does depends on what Jev picks, and the live checks are not steady.** With Jev
   in, the same scene passes one run and fails the next. So the dependable checks run on
   reflexes alone, which shows that a reflex fires and its skill works, not that it wins in the
   real brain. The whole-brain results are mostly one to four runs each. Several reflex-only
   scenes are flaky too (`defence-check` around and shooter, `arousal-check` depth and hungry),
   and a failure has to be run against the last commit before it can be blamed on a change.
   *("The night and dark scenes depend on what Jev picks"; medulla: "the live scenes other than
   the dives run without instinct"; demo runner: "three demos do not show their limit every
   time"; "Jev sometimes times out"; serotonin and noradrenaline: "flaky".)*
   **Would fix:** a recorded or seeded Jev for scenes, repeat counts for every live scene, and
   scenes that wait for a state, not for a number of seconds.

4. **The brain assumes one skill at a time, and waits for it.** The loop does not tick again
   until a stopped skill has ended, so a skill that cannot be stopped stops every reflex (the
   chest that froze the brain for 20 seconds). A movement run alongside is invisible to dopamine
   and patience. Only one defence is chosen each tick, so a held-back flee is replaced by
   nothing. *(Medulla: "a skill that cannot be stopped stops every reflex"; "A look that runs
   alongside is invisible"; "Holding back flee leaves an unarmed bot with nothing".)*
   **Would fix:** a deadline on stopping a skill, and episodes that know about side movements.

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

6. **One state serves both Jev and the brain's own bookkeeping.** The field of view changes
   what Jev picks by leaving things out of what it is told, and there is no single budget to
   spend: Jev is sent the whole state, which keeps growing. (Alarm no longer hides things from
   the state.) *("The attention budget is a count, not a size limit"; colliculus limits: "the
   field of view filters only..." and "the state is bigger".)*
   **Would fix:** keep the full state for the brain and build a separate, budgeted view for Jev
   and the planner.

7. **Learning blames by timing and nearness, and some of it cannot be unlearned.** A bad meal, a
   kill, a hurtful block, a self-caused bang and a dangerous player are all decided by "it
   happened within a few seconds, close by". Two coincidences teach a wrong fact, and several
   kinds of fact are then kept for good (a block that hurts, a player who is a threat). The
   scorebook has the same weakness in a milder form: a mob appearing during a trip is learned
   as that chest making danger worse. *(Reflex limits: "blame is a guess" and "learning is all
   or nothing"; medulla limits: "blame for a bad meal is by timing alone"; defence: "kills are
   credited by timing", "fleeing a player by reflex may not be wanted"; dopamine: "a trip cut
   off by a mob appearing".)*
   **Would fix:** graded confidence that fades without fresh evidence.

8. **The protections live in different places, and a journey slips past most of them.** Stance
   and self-caused are known only through the primitive wrapper, so skills that move the body
   directly are not covered. While the bot travels, the route checks, `about_to_touch`, `pushed`
   and the posture check are skipped on trust in the pathing rules, which is how a fleeing bot
   was knocked off the sky plaza. Nothing keeps a fight or a flight away from an edge. The
   pathfinder's own digging teaches nothing. *(Posture limits: "only primitives get stance",
   "loose blocks are learned only from `break_block`"; defence: "while the bot is travelling
   the checks are skipped", "a flight hides a shove"; cornered: "fighting with a drop behind
   it".)*
   **Would fix:** route every body movement through the one doorway, and run the cheap checks
   during a journey as well.

9. **Most thresholds are hand-set, and several strengths are on or off.** Zone distances (8, 16,
   48, 64 blocks), sound weights, balance numbers, time windows, the waits before a retry and
   the 0.5 that speaks for staying asleep were chosen by hand, each tuned in its own scene.
   Nothing checks them against each other, and a change to one moves which proposal wins
   elsewhere (problem 1). *(Startle limits: "those weights are hand-set"; posture limits: "the
   balance numbers are hand-set"; "Most strengths are on or off"; locomotion limits.)*
   **Partly closed by the hypothalamus (2026-11-23):** the need weights (2, 1, 0.25) are now the
   setting `drives.weights`, a need can carry its own, and every part of the drives has a
   strength from 0 to 1. Its other numbers sit in six named tables (`AHEAD`, `CLOCK`, `STRESS`,
   `COMPETE`, `LEARNING`, and `COMING` and `ADJUST` on the Minecraft side). They are still
   hand-set, and still not checked against the numbers of other regions.
   **Would fix:** one table of the numbers with what each was tuned against; a whole-brain
   regression that reports wins and losses when one changes.

10. **Signals are built before anything reads them.** `stuck`, `headroom` and mood are worked
    out and logged with no reader; `sore` changes two numbers. *(Locomotion limits: "the `stuck`
    signal has no reader"; "Mood can't be shared between brain parts yet".)*
    **Partly closed by the hypothalamus (2026-11-23):** `cold`, `tired`, `sick`, `reserve` and
    `vitals` are read now (as the needs warmth, rest and illness, as hunger's look-ahead, and as
    a source of stress). What does not fit in 0 to 1 is shared as data in `ws.needs` beside the
    signals, which is how mood could be shared too.
    **Would fix:** give `stuck` and `headroom` a reader or drop them.

11. **There is too little to do for the upper layers to show anything.** There are only a few
    skills and none gathers, builds or explores, so a safe bot idles at base. The planner's
    steps, the cue pulse, search with Jev running and the planning horizon have little to act
    on and are untested live. A bot that flees far does not come home by reflex. *("The bot
    mostly idles at base"; "Live testing, 2026-11-14": "not yet exercised live"; "A bot that
    flees far does not come home".)*
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

13. **The needs are the one opinion of how things stand, and they only know about mobs.**
    Dopamine, patience, alarm and search all read the same needs now. But danger means a mob
    that could harm the bot: lava, fire, drowning and a long fall are not needs, so nothing is
    silenced, restrained or alarmed by them beyond the hurt they do. And what the bot remembers
    (places, what can reach it) has no age, so it is always believed. *(Dopamine: "only a
    hostile mob counts as danger"; noradrenaline: "danger means a mob"; acetylcholine: "the
    trust check is still for chest contents only".)*
    **Would fix:** add the other dangers as vital needs, and put a time on every memory.

**Status.** Open. A summary: when an entry below closes one of these, update it here too.

## The colliculus: a map with up and down, wants, a brake, sky and ground

*Built and run live 2026-11-23 and 24.*

**The problem.** The colliculus scored things by six physical features on a flat map. It knew
left, right, ahead and behind, never up or down. Only a goal's `watchFor` could bias it, so a
hungry bot's eye was drawn no more to food than a fed one's. Nothing held its gaze on what it
was working on. Something diving from above and something small on the ground were treated
alike. `orienting` was 1 or 0 and had no reader. And a look was only "worth it" if the bot was
hurt or rewarded.

**The rule now** (each part one small file in `region-brainstem/src`, each with a strength in
`colliculus` in `bots.json`; all at 0 is the map as it was).

1. **Up and down** (`elevation`): every thing has an elevation and a field (upper, lower,
   level); glances go to the sky, ceiling and floor too; the state carries `elevation`,
   `height`, `light` and the head's `pitch` (schema 19).
2. **Sight in the dark** (`darkness`): a still thing loses most, a looming one least.
3. **Priority from wants** (`wants`): a kind dopamine wants right now gets the boost a watched
   kind gets.
4. **The brake** (`fixation`): while a skill is aimed at a thing, others need 0.3 more to win.
5. **Sky and ground** (`fields`): a lean of avoid, freeze or approach from physical facts, which
   the defence circuit and Jev take as advice (`defence.lean`).
6. **A graded `orienting`** (`event`), read by dopamine, acetylcholine and the reticular region.
7. **A fairer "did anything follow?"** (`followUp`).

**Seen live** (`pnpm colliculus-check --runs 3`; each new scene three times, all 21 runs pass).

| Scene | Field | Lean | What won and why | What the defence circuit did |
|---|---|---|---|---|
| `overhead`: a phantom dives from 17 blocks up and out | upper | avoid | The phantom (looming, 0.74 to 1.08); head up 44 degrees | Fled to the roof 7 blocks off and ended under it (3 of 3). With `defence.lean` 0: fled in the open (3 of 3) |
| `circling`: a bat on an arc 10 blocks out, 14 up | upper | freeze | The bat (it started moving, 0.59 to 0.68); head up 53 degrees | Held still and watched (3 of 3), its own choice staying "none". With the lean ignored: nothing |
| `ground`: a chicken walking a block a second, 4 blocks off | level | approach (a cow: none) | The chicken (0.71); held 2.5 to 3.5 s, the cow 1.5 to 2 s; Jev was told | Nothing |
| `hungry_eye`: a learned chest, a bell and a cow, no goal watching | level | none | Out of bread, the first look went to the chest 0.5 s later, "drawn by a wanted kind" (0.51). Stocked: no look, no boost | Nothing |
| `on_task`: walking to a far spot, a pig appears to the side, then a hit | level | none | The pig (0.67) was stopped by the brake (needed 0.75); the hit turned the head (3.25). Brake off: the pig drew a look | Nothing |
| `dark`: a still cow 4 blocks off | level | none | Its nearness counts 0.19 by day (light 1.0) and 0.08 at night (light 0.27) | Wary at night |
| `learning`: a pig moves just before a trip to the chest ends | level | none | The trip, 0.09 off what was expected, was learned from at 0.70 to 0.76 of the step; with `focus.eventLearning` 0 at 0.44 | Nothing |
| The eight existing colliculus scenes | | | Pass | |
| `startle-check` (9 scenes) | | | Pass | |
| `defence-check` (11 scenes) | | | 10 pass; `around` fails, and fails the same on the two commits before this work (below) | |

The slowest map tick in the batch was 1.64 ms; one earlier single run showed 2.11 ms.

**What only showed up live.**
- **The lean reached the defence a tick late.** The reflexes run before the colliculus, and a
  flee for a dive is proposed for one tick: by the time `attended.lean` said "avoid", the bot
  was already running in the open. The flee rule now also asks the same table about its own
  threat from the state (`leanFromState`). The lean is still worked out in two places on that
  first tick (problem 5).
- **A thing's own noise took the look from it.** A chicken's clucking arrives as a sound at its
  place, a different thing on the map, which won after a second and ended the longer hold. The
  scene's animals are silent; in play, a noisy small animal is held for less than 3 seconds.
- **The bot's own chest lid sent `orienting`.** Opening a chest is a sound at the chest, and the
  startle's "self-caused" covers digging, placing and striking, not opening. For the signal
  only, anything at the target of the running or just-ended skill now counts as its own doing.
  The startle's rule is unchanged.
- **A still chest got the lean "approach"** (small, close, not coming at the bot). The row now
  asks for some movement.
- **A new thing is seen up to 2.5 s after the server makes it**, but one that starts moving is
  seen within a tick or two. Scenes that need a timed event move a thing; they do not summon it.
- **While a skill is aimed at a thing, a thing that appears rarely sends `orienting`**: the
  brake stops it winning (0.67 against 0.75). So the learning effect is mostly for events before
  a short skill, or strong ones.
- **Short of bread the bot fetches it by itself at once**, so a typed `do take_items` in a scene
  arrives second and fails with "cannot run". The scenes let it make its own trip.

**Limits.**
- **Dopamine has no learning window to open.** It was removed with the acetylcholine redesign.
  The equivalent was built: a run that ends within 2 s of an `orienting` is learned from at no
  less than that strength of the usual step. A big surprise is already learned in full, so the
  event only matters for runs that went about as expected.
- **A friend sprinting at the bot at eye level is as looming as before.** The lean tells a dive
  from above from a charge on the ground, and a small slow thing from the rest. It says nothing
  about a fast thing at eye level, so that limit stands.
- **"Freeze" is for anything crossing the sky, harmless or not.** A bat makes the bot hold
  still for about 2.5 s. Habituation is what stops it: the thing counts 0.8 as much each time.
- **"Avoid" only changes how the bot flees.** If the defence circuit does not choose to flee
  (the diving thing is not a threat by its own sizing up), nothing is done but the look.
- **Cover is the nearest standable spot with a solid block within 4 above, within 10 blocks.**
  It is found by plain block checks, not by whether the diving thing can get in. With none
  close, the bot flees as before.
- **The bot still sees what is overhead without looking up.** `seen` goes by the sideways angle
  only; elevation changes the field and the lean, not what is in view.
- **A thing on flat ground close by is in the lower field** (the eyes are 1.6 blocks up): a pig 2
  blocks off sits at about −30 degrees.
- **The lean is worked out when a thing wins and while it is held.** A thing that never wins a
  look (below the threshold, or used to) gives no lean.
- **A want draws the eye only to kinds dopamine has a cue for**: things in view it has learned
  to aim a skill at. In the scene the pull itself was switched off (`personality.wanting` 0);
  with it on, the trip starts the same tick and the chest becomes the fixated thing, so the
  look is not made.
- **A need that moves for its own reasons makes a look "worth it".** Hunger ticking down 0.1
  while a cow is attended counts. The 0.1 is `NEED_MOVED`.
- **`TAKE_OVER_URGENCY` is as needed as before.** The brake acts while a skill with a target
  runs; the take-over is for when nothing runs.
- **`followUp` is a seventh strength**, not in the six asked for, so that Part 6 can be turned
  off too. `defence.lean`, `arousal.orienting`, `focus.orienting` and `focus.eventLearning` are
  the readers' own.
- **The state is bigger again**: three more numbers on each nearby thing.
- **The `colliculus-check` scenes now run with the hypothalamus**; the bot does not glance
  around in the map's scenes (`scanning` 0), so that what is in view is known.

**Found on the way, not from this change: `defence-check around` fails.** A journey past a husk
that has not noticed it is interrupted beside the husk and the bot freezes; it never arrives
(8 of 8 runs: with this change, with every new strength at 0, on the commit before it and on
the one before that). What interrupts the journey was not found. Open.

**Status.** Built. Open: the limits above, and `around`.

## Hypothalamus: one owner for the needs, and what it adds

*Built and run live 2026-11-22 and 23.*

**The problem.** The needs were worked out inside dopamine's reward rules, and noradrenaline,
serotonin and the arbiter each read them from there. A need was "how far from a fixed target,
right now": nothing looked ahead, nothing changed with the time of day, a bad stretch left no
trace once the danger was gone, and the body's own readings (`cold`, `tired`, `sick`,
`reserve`, `vitals`) had no reader.

**The rule now.** The hypothalamus (`packages/region-hypothalamus`) reads every need once a tick
and shares the reading in `ws.needs`. Each part has a strength in `drives` in `bots.json`; with
all at 0 the bot does what it did before.

1. **Body readings are needs**: warmth, rest and illness, from the medulla's signals.
2. **Targets move**: more food is enough when hurt and as night comes, more torches toward dusk
   and underground; running out while the need it serves presses raises the target by a
   quarter (up to three times), and it drifts back.
3. **Looking ahead**: a need presses at the larger of its level and 0.7 of where it will be in a
   minute, and a third less while a skill that relieves it is under way. Rewards stay on the
   real level.
4. **A body clock**: rest presses more by night, curiosity and stocking by day; the dark starts
   to count over the last three minutes of the day.
5. **Stress**: builds in about a minute under threat, pain or a poor body, fades in about five.
6. **Competition**: one top drive, held with some stickiness; `desperate`; `unmet`.

**Seen live** (`pnpm drives-check --runs 3`, new; each scene three times).

| Scene | With the part on | With it at 0 |
|---|---|---|
| `dusk`: a lit spot it was taught, night coming | The dark pressed 155 s before night; it set off 121 s before nightfall (2 of 3 runs) | Pressed and set off as night fell (2 of 3) |
| `hungry_soon`: reserve gone, bar still 15 to 18 | Hunger 0.10 to 0.25 pressed at 0.35 to 0.40; went for bread at once | Went too: empty pockets press by themselves |
| `hurt`: nine bread, then health 7 | Enough went 8 → 12; healthy it stayed put, hurt it fetched 16 more (3 of 3, after the scene was fixed) | (not run) |
| `learned_target`: runs out twice while hungry | Enough went 8 → 10 → 12.5, saved as × 1.56 (3 of 3) | (not run) |
| `bad_night`: three attacks, then quiet | Stress peaked at 0.45 to 0.47; alarm was 0 a minute on with stress still 0.36; patience 0.54 → 0.70 → 0.81 → 0.83 and curiosity 0.79 → 0.89 of its level over five minutes as stress fell to 0.21 (3 of 3, after the scene was fixed) | (not run) |
| `cold`: standing in powder snow | Warmth 1.0 and on top within 1 s; out in 9 to 10 s (3 of 3) | (not run) |
| `desperate`: starving, bread past a husk | Flight distance 8 → 6 to 6.5; got the 16 bread (3 of 3) | Turned back at 8.5 blocks, no bread (3 of 3) |
| `unmet`: starving, nothing known that helps | Search above 0.6 after 22 to 23 s | After 27 to 44 s |
| Existing serotonin, noradrenaline and dopamine checks, all drives 0, three times | Serotonin and noradrenaline pass 3 of 3. Dopamine: 13 of 16 scenes pass in all three; see the first limit | |
| The same with the hypothalamus left out (`LESION=hypothalamus`) | Pass (serotonin and noradrenaline three times, dopamine once) | |
| The same with the drives on, once | Pass after one check was corrected (below) | |

**Limits.**
- **Two dopamine scenes failed with the drives at 0 and not on the code as it was before.**
  `threat_with_jev_live` failed 2 of 3 ("set off for the chest with a threat beside it") and
  `two_chests` 1 of 3 ("went back to a chest it had found empty"); on the old code both passed
  3 of 3, with the hypothalamus left out once, and with the drives on once. In both threat
  failures it was one tick: a trip dopamine had started with the husk past 16 blocks went on
  for a tick (by Jev's pick) as the husk crossed to 15, and danger took over on the next. With
  the drives at 0 the fast tests show the same decisions as with the region left out, so this
  looks like timing at the 16-block line, but three runs against three do not prove it.
- **The dusk scene did nothing in one run of three, in both arms.** The bot's own later trips to
  the lit spot paid nothing (it was day), so what the two taught trips had shown wore off and
  there was no want left to bring forward. Looking ahead moves a want earlier; it does not
  make one.
- **`hungry_soon` does not show looking ahead by itself.** Hunger did press early, but a bot with
  no bread goes for bread anyway. A scene where only the food bar could send it is not built.
- **In the cold it was the pain reflex that got it out** (`withdraw`), not the warmth need:
  nothing has learned what relieves cold, and there is no skill for "get warm". The need was on
  top the whole time and changed nothing by itself.
- **A want is weaker while the trip that answers it is under way.** The want goes by the square
  of how hard the need presses, so easing by a third takes the pull from 0.89 to 0.42. The bot
  still finished every trip, but something else could more easily cut in. The dopamine check's
  `no_path` scene read this as unlearning and was corrected to leave those ticks out.
- **`desperate` shortens the flight distance; it does not lift danger's silencing of wants.**
  Inside the shorter distance the bot still flees and wants nothing. Provisions never make it
  desperate (the level is counted by weight, at most 1).
- **`unmet` is also on at a fresh start**: with nothing learned, nothing is known to relieve the
  top need, so search rises from the first minute.
- **Stress is counted in part.** In the outlook only what is above the danger of the moment
  counts, and toward staying awake only what is above tiredness, so that alarm and tiredness
  are not counted twice. A change of top drive does not ask for a new plan while danger
  presses. These depart from the spec as written.
- **Stress does not fade while the body is still poor.** In the first bad-night runs the bot
  had no food: hungry or hurt, stress stayed at 0.47 five minutes on (it fell to 0.21 once the
  scene fed it). Dusk arriving in the same minutes also lowered patience and curiosity, so the
  scene now runs fed and by day.
- **The hurt scene only shows the raised target while the bot stays hurt.** In one early run it
  ate, healed past 10 in three seconds, and enough fell back to 8 before it had set off.
- **Sleep now pays by how tired the bot was** (about 0.11 for an ordinary night) where it paid 1
  for any night slept through, when rest is a need.
- **The dark now costs gradually over dusk** where it arrived at once at nightfall, and a spot
  lit by a lamp is known from the block light, which is new in the state (schema change).
- **`take_items` takes what the goal asks for, not what is now enough.** A raised target makes
  the bot go again; it does not make one trip bigger.
- **The `hunger` effect used in scenes also makes the bot ill** (illness 0.5), which moves the
  outlook and alarm in every starving scene.
- **Needs that move in steps give jumpy projections**: the food bar falls a point at a time, so
  the rate over a minute is 0 and then large.
- **A signal's freshness goes by the wall clock**, so in a fast test two ticks can share one
  moment and a one-tick bump is lost. Not changed.
- **The other live checks run without the hypothalamus** (arousal, defence, medulla, posture,
  colliculus, startle, acetylcholine keep their own region lists), so they show nothing about it.
- **Speed.** Over 19,881 live ticks, 35 (0.18%) took more than 2 ms and the worst took 39 ms;
  none was a tick that saved a learned target. Alone in a benchmark the median is 0.017 ms and
  the 99th percentile 0.085 ms. The slow ticks are most likely pauses of the whole process
  (the game server and client run on the same machine), which was not proven.
- **The numbers are still hand-set**, in settings and six named tables (problem 9).

**Status.** Built. Open: the limits above.

## Acetylcholine: focus follows how well predictions hold, and learning goes by the surprise

*Built and run live 2026-11-22.*

**The problem.** Focus ("trust your senses and learn this now", against "assume what you
know") went by labels. Over 17,600 live ticks half of its awake readings sat between 0.43 and
0.51; its largest input was whether the bot was idle (mean −0.76); darkness and night were
counted again though they are already needs; and a chest trip that fell 0.75 short of what was
expected did not move it at all. Learning was gated by a label too: skill values learned at one
fifth speed unless a "notable event" had just happened, and 52% of all learning fell outside
that window.

**The rule now.** Acetylcholine says how far to trust what the bot already knows against what
it senses now, and reads that from how well its own predictions have been holding.

1. **Focus follows the evidence** (`predictionsFailing` in `acetylcholine/focus-region.ts`).
   Each run that ends says how far the outcome was from what was expected. Focus goes up while
   runs keep missing (by half a reward or more counts as a miss outright), down while they
   hold, and with no run lately there is no evidence either way; a miss counts for half as
   much after two minutes. The other input kept is how little the bot has recorded about the
   place it is in. Darkness, night or enclosed, "noisy" and the task label are gone.
2. **Learning goes by the surprise itself** (`attentionTo` in `dopamine-region.ts`). A run that
   went as expected moves the scorebook a fifth of the usual step, rising to the whole step
   for a surprise of 0.3 or more. The learning window, its "notable event" and the setting
   `learningWindow` are gone (the setting is now `surpriseLearning`).

**Seen live** (`pnpm acetylcholine-check`, new, three scenes).

| Scene | Before | After |
|---|---|---|
| `let_down`: a learned chest emptied behind its back | A miss of −0.75; focus 0.48 → 0.41 (no input noticed) | Focus 0.82 → 0.90 (`predictions_failing` 0.82) |
| `quiet_learning`: six trips cut short, nothing notable | All six learned at 0.20 of the step; expected 0.71 → 0.59 | Learned at 0.21, 0.50, 0.74, 0.89, 0.95, 0.92 as the surprise grew; expected 0.72 → 0.38 |
| `day_or_night`: idle by day, then in the dark | (darkness and night each pushed focus up) | Focus 0.69 → 0.76, still settling; night changed no input |
| `neuro-check` calm, ambush, remembered, hunger, night; six dopamine scenes | Pass | Pass |

**Limits.**
- **Learning a good thing raises focus as much as losing one.** The surprise is taken by size,
  so the first trips to a new chest (+1.0, +0.66) put focus at 0.82 before anything went wrong.
  That fits "learn this now", but focus was already high when the chest was then emptied.
- **Focus now sits high in the test plaza** (0.65 to 0.90), because the bot has few memories of
  it. What reads focus shifts with it: fewer remembered items are passed on, new memories start
  stronger, and a remembered chest is trusted for a shorter time.
- **The trust check is still for chest contents only**, with a fixed half-life. The memory of
  places and of what can reach the bot have no age, so they are always believed. Not changed.
- **The attention budget is still a count, and the cue pulse is still its own mechanism**
  beside dopamine's wants (it proposes at a fixed 0.6 for whatever the goal watches for).
- **"Day or night" has no before-run**: the scene did not exist. The old inputs' sizes are in
  the code that was removed (darkness up to +1, night +0.5).
- **A surprise under 0.3 is learned from more slowly than before inside a window, and faster
  than before outside one.** Small steady drifts take longer to show.
- **Senses that really are worse in the dark are not modelled**: the bot sees the same by night.

**Status.** Built. Open: the limits above.

## Noradrenaline: alarm follows the danger, search follows getting nowhere

*Built and run live 2026-11-22.*

**The problem.** Alarm kept its own books on danger: five hand-set triggers raised it and only
a clock lowered it. Over 120 live logs it was above 0.6 on 4,801 ticks, 73% of them with no
threat present, and while it was high the bot ticked faster, stopped being told of chests, and
had its planner taken out of charge. A fright cleared the goal (53 times), which left the bot
wanting nothing for 10 to 20 s. A disappointing chest trip raised alarm as a zombie would.
Search, the other dial, stayed between 0.17 and 0.47 for 16,000 ticks, below every level at
which it does anything.

**The rule now.** Noradrenaline says how much this moment calls for a change of course, read
from evidence the brain already has. Alarm is "change now" and follows the danger itself.
Search is "change soon" and follows whether the bot is getting anywhere.

1. **Alarm follows the vital needs, up and down** (`noradrenaline-region.ts`, `alarm.ts`). It
   is never below what a vital need (rank above 0: danger) presses at, and what is left once
   the cause has gone fades with a 5 s constant (was 30). A new vital need raises alarm with no
   further code.
2. **One kind of jump: a need suddenly worse.** The jump is the sum over all needs of weight ×
   how much worse the need got this tick (capped at 1), or 0.4 × the body's startle if that is
   larger. A mob appearing, a blow, a fall are all this. Jumps do not pile up: a need a little
   worse every tick is not alarm. The triggers `hostile_appeared`, `damage`, `looming` and
   `big_surprise` are gone, with the all-clear added two days ago (it is now automatic).
3. **A failed skill is search's business.** Nothing about a skill's outcome raises alarm.
4. **A fright stops the running skill and keeps the goal.** The planner is asked again only
   when it is told the goal is not paying off, or the bot was moved.
5. **Search follows getting nowhere** (`gettingNowhere` in `search.ts`). Up by how hard the
   worst unanswered ordinary need presses, while the running skill makes no progress (the
   measure built for serotonin); down while it is getting somewhere, or while nothing presses.
   The dial now runs from rest to the top, so its effects are within reach.
6. **Alarm no longer hides things.** The state used to drop friendly mobs and useful blocks
   above alarm 0.6. Need priority already silences lesser wants while danger presses, so this
   only made things vanish and then look new.

Also gone: the goal-hopping guard (the wait before retrying does that job), and the settings
`acetylcholine.noisyOrChanged` and its surprise threshold (they only fed the old trigger).

**Seen live** (`pnpm noradrenaline-check`, new, four scenes).

| Scene | Before | After |
|---|---|---|
| `after_threat`: a husk attacks for 6 s and is removed | Alarm 0.99 when it went; still above 0.3 after 25 s; above 0.6 on 70 of 98 ticks; planner offline on 88 | 0.55 when it went; under 0.3 after 4.5 s; above 0.6 on 0 of 54; planner offline on 2 |
| `goal_kept`: a fright with a goal set | No goal for 10 s | Goal there on every tick |
| `let_down`: a trip to a chest emptied behind its back | Alarm raised to 0.37 | Alarm raised by nothing |
| `stuck`: starving, nothing to eat, 84 s | Search 0.32 → 0.20 | Search 0.36 → 0.84 |
| `neuro-check` calm, ambush, remembered, hunger, night | Pass | Pass |
| `defence-check` (11 scenes), `startle-check` (9), `serotonin-check` (4), three dopamine scenes | | Pass, all of them |
| `arousal-check`, ten scenes | | Eight pass; `depth` and `hungry` failed (flaky, see limits) |

**Limits.**
- **Danger means a mob that could harm the bot.** Lava, fire, drowning and a long fall are not
  vital needs yet, so alarm knows of them only through the hurt they do (a need suddenly worse)
  and the startle. The plan was to add them; not done.
- **A threat right on the bot takes the planner offline while it is there.** A zombie 2 blocks
  off presses at about 0.9, above the 0.8 that does it. An earlier finding had tuned an ambush
  to stay under that; with alarm following danger it does not, but the planner is back within
  seconds of the threat going and the goal is kept.
- **A blow no longer adds to alarm that danger already holds up.** Hit while a mob presses at
  0.5, alarm stays 0.5 unless the hit is worth more.
- **Losing things suddenly is a small alarm.** The scene's own `clear` raised it to 0.25.
- **Search's effects still switch on at fixed levels** (wider options at 0.6, a rethink after
  30 s above 0.7). The plan said graded; only switching is.
- **Search rises for an idle bot that lacks provisions**: no tools or torches press at 0.25,
  which heads search for about 0.48. That makes it a little readier to switch; not seen to
  cause hopping, and not run for long.
- **Search does not read failed or cut-short runs directly**, only the lack of progress.
- **Not seen live:** the rethink, wider options, the panic lock, and search with Jev running.
- **"An untried chest is never tried" is not solved by this**, though the design note said
  search might.
- **`arousal-check hungry` fails about one run in two, with these changes and without** (two
  runs each way, the second against the last commit). In the failed runs the bot is out of bed
  a fraction of a second after lying down, as the scene's own commands land. `depth` failed
  once the same way and passed on the rerun. Not fixed.
- **Two checks were changed to the new rule**: `startle-check`'s whole-brain ambush asked for
  alarm of 0.8 or less on arrival and now asks that the startle adds nothing to the danger's
  own jump; `neuro-check hold` no longer looks for the note that a goal was kept.
- **Other regions read alarm** (reflex gains, startle, waking, tick rate). They now see an
  alarm that falls in seconds; their checks were rerun (table above), not retuned.

**Status.** Built. Open: the limits above.

## Serotonin: patience from the needs, protection for what is working, restraint by what was learned

*Built and run live 2026-11-22.*

**The problem.** Patience acted on labels, not evidence. It protected whatever was running (a
`flee` going nowhere kept its stay bonus and outvoted the cornered fight), it held back any
skill marked risky whoever proposed it (the defence circuit's own fight, on all 31 ticks of a
live fight), and it followed an average of five readings that was a second, cruder opinion of
how things stood (starving with no food, the outlook still read 0.58, and after a calm spell
patience was at its highest just as a threat appeared).

**The rule now.** How long the bot stays with something depends on what it expects to gain,
whether it is getting anywhere, and how long it can afford to wait. Serotonin supplies only the
last.

1. **One opinion of how things stand** (`outlookFrom` in `serotonin/patience.ts`). The outlook
   is worked out from the same needs dopamine is paid for: 1 / (1 + the sum of each need's
   weighted level squared). One need at its worst gives 0.5, each further trouble lowers it,
   and none is watered down by the ones that are fine. Each need has a `weight`: a threat to
   life 2, the body's own needs 1, provisions (tools, a stock of food, torches) 0.25. The five
   outlook readings and the "input stuck at 0" warning are gone. A new need is followed with
   no further code.
2. **Patience falls fast and rises slowly.** It reaches a worse outlook in about 3 s and climbs
   back over the bot's time constant (a minute). The fixed shock cut and the alarm link
   (`patienceLink`) are gone.
3. **Protection goes to what is working** (`persistence.ts`, `brain/progress.ts`). The stay
   bonus is full when the running skill has just got somewhere and fades to nothing over 10 s
   without (5 to 15 s by patience). Getting somewhere is a reward, a need easing or ground
   covered. The give-up time is as before.
4. **Restraint by learned cost, for the deciding layers only** (`createArbiter`). Patience
   holds back an option by how costly it has been learned to be here, aimed at this (the
   scorebook's cost). A skill marked risky starts as costly, any other as harmless, and what
   happens then moves both. A reflex is never touched.
5. **A skill given up on waits before a deciding layer may start it again**: 8 s, then 16, 32,
   up to a minute (the same `retryAfter` as a thwarted want). A run that finishes ends it.
6. **The running skill is always in the vote.** While the layer that chose it says nothing
   (it is not asked every tick), its choice stands as made. Once it speaks again, its word
   counts.

**Seen live** (`pnpm serotonin-check`, new, five scenes).

| Scene | Before | After |
|---|---|---|
| `armed`: sword in hand, a husk on the bot | The fight reflex was scaled down on 31 of 31 ticks (to ×0.95) | On 0 of 34 ticks |
| `starving`: food bar empty, no food, nothing else wrong | Outlook 0.58 (four good readings and one bad) | Outlook 0.45; patience 0.35 |
| `threat`: 45 s of calm, then a husk | Patience 0.59 a second after, 0.37 by the end | 0.52 a second after, 0.21 by the end |
| `nowhere`: idling | Stay bonus faded over two minutes | 0.120 at 2 s, 0.007 at 10 s, 0 at 18 s |
| `nowhere`: an 18-block walk | | Stay bonus never below 0.140 |
| `give_up`: idling with nothing to show | Never seen live | Given up on after 144 s (patience 0.70) |
| `neuro-check` calm, ambush, remembered, hunger, night; three dopamine scenes; `medulla-check` (7 scenes) | Pass | Pass (the ambush check now asks for a fall of 0.2 within 3 s, not in one tick) |
| `defence-check`, eleven scenes | Ten pass | Nine pass; `shooter` and `around` failed (both flaky, see limits) |
| `arousal-check`, ten scenes | | Seven passed the first time; the three that failed passed on a rerun, with and without these changes |

**Limits.**
- **Each need now carries a third number** (`weight`, beside `rank`). Rank is strict priority
  for action; weight is how much the need darkens the outlook. With one number for both, a
  bot with no torches would have had a bad outlook for ever.
- **"About three seconds", not "that tick".** The design said patience would drop the tick a
  vital need presses. It falls a third of the way each second instead, so one bad reading does
  not throw it.
- **Progress is only what can be seen.** A skill that works without covering ground, easing a
  need or earning a reward (digging, waiting on purpose) loses its protection after 10 s. A
  skill cannot yet report its own progress.
- **Pacing counts as getting somewhere.** Ground covered is any ground, not ground toward the
  goal.
- **The body's urge still shrinks the stay bonus**, as before. The plan was to drop that patch;
  it stays until `medulla-check` is rerun without it.
- **Restraint needs experience.** A skill not marked risky is not held back until it has cost
  the bot something.
- **The wait after giving up is by skill, not by target**: giving up on one journey holds back
  every `go_to` for 8 s.
- **The standing choice only shows when a deciding layer is silent for a tick.** With Jev asked
  every tick it changes nothing; not seen live.
- **Curiosity is not among the needs the outlook reads** (it reads the body's and the stock's).
- **Three checks turned out to be flaky, none from this change** (each was run with these
  changes and without them, on the commit before):
  - `defence-check around` fails about one run in two either way: it depends on whether the
    husk is seen before the route is planned.
  - `arousal-check` bedtime, depth and hungry failed once (the bed could not be reached for a
    moment, and sleep was not tried again) and passed on the rerun either way.
  - A summoned husk or zombie is a baby one time in twenty. A baby moves at 6 blocks a second,
    which counts as looming from 15 blocks off, and failed `open` and `dangerous` once. Every
    scene now summons an adult (`IsBaby:0b`).
- **Giving up on idling takes 144 s** at patience 0.70. Nothing here shortened it.
- **The behaviour tests for the planning horizon were not touched**, and the horizon was not
  run live.

**Status.** Built. Open: the limits above.

## Dopamine: a want that cannot be carried out is neither hammered at nor unlearned

*Built and run live 2026-11-21.*

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

*Built and run live 2026-11-21.*

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
- **In `defence-check blank` the new rule fired once**: after fleeing 9 ticks the bot held and
  fought for 2. The scene still passed; whether it was truly out of room there was not checked.
- **Each flee still stops at about 11 blocks and Jev idles until the threat is back at 8.**
  Left as it was.

**Status.** Built. Open: the limits above.

## The whole brain, starving, with a threat that can reach it

*Run live 2026-11-21, with one fix that came out of it.*

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
- **The danger reward is now paid over 16 blocks for a threat that has noticed**, so fleeing is
  paid for further and a chasing mob costs more as it comes. Total for coming and going is
  still nothing, by the unit test.
- **Noticing lapses a few seconds after a mob stops coming**, and with it the wider range.
- **A bare state with no word on a mob's movement counts it as having noticed** (the cheap
  rules' default), so there the range is 16.

**Status.** Run; the turning back is fixed. Open: the limits above.

## Defence: watch first, and remember the place

*Built and run live 2026-11-21.*

**The problem.** Working out whether a mob can get to the bot takes a real route check, about
one to two seconds. Until it answers, the bot uses a cheap guess (in sight and at about its
height). For a husk in a pit the guess is wrong. In two runs of three the bot acted on it: it
fled for a tick and alarm rose to 0.6; when the answer came the bot stopped, but alarm only
faded by itself and was still 0.4 at the end. It was a race between the answer and the reaction.

A real brain has the same two routes, a fast rough one and a slow careful one, and reacts to
the rough one on purpose. But its first reaction is small (freeze and look), the careful route
can cancel the alarm, and it stops reacting to what proved harmless. The bot does the first and
the last here; cancelling the alarm needs no rule of its own now that alarm follows the danger
(see the noradrenaline entry).

**The change.**
- **Watch first** (`settling` in `defence/routes.ts`, `size-up.ts`; the chooser in
  `region-brainstem/defence.ts`). While the first route answer for a mob is being worked out,
  a mob that counts as coming only on the guess is frozen for, not fled from. This holds only
  while it is beyond half its flight distance, for at most 2.5 s, and never for a mob that is
  looming, has hurt the bot in the last 10 s, or whose check was given up as unsure.
- **Remember the place** (`defence/reach-memory.ts`). Every route answer is kept by where the
  mob and the bot each stood (within 2 blocks, 64 places). The next mob in that spot, or the
  same one later, is known at first sight, with no guess and no wait.

**Seen live** (`pnpm defence-check`).

| Scene | Before | After |
|---|---|---|
| `pit`, when the answer is slow (1.75 s) | Fled for a tick; alarm 0.6, still 0.4 at the end; failed | Froze for a tick; passed |
| `pit`, four runs | 1 of 3 passed | 4 of 4 passed |
| `pit_again` (new): a second husk in the same pit | | Known unable to reach on all 17 ticks, though the guess said it could; no defence; alarm 0 |
| All ten earlier scenes | 8 passed | 10 passed (`shooter` too, once) |
| Five dopamine scenes (`threat_first`, `with_jev` among them); `neuro-check` calm, ambush, remembered | No problem; pass | No problem; pass |

**Limits.**
- **A mob that really can reach the bot is now fled from up to a second or two later**, if it
  is first seen beyond half its flight distance and the route check has not answered. In `open`
  the husk was still fled from at 8 blocks, but a fast mob first seen at 5 could gain ground.
  Not measured.
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

*Built and run live 2026-11-21.*

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
| `defence-check`, ten scenes | | Eight pass; `pit` and `shooter` failed (`pit` was fixed by the entry above; `shooter` is flaky) |

**Limits.**
- **Until the route check answers, reach is a guess** (line of sight and similar height). A mob
  round a corner with no line of sight counts as unable to reach for that moment, so the bot
  does not freeze or steer round it until the answer comes. Only the two nearest threats get a
  route check.
- **A cage that opens is noticed only when the route is checked again.**
- **Only creepers are counted as hurting through a wall.** The list is one line to extend.
- **`defence-check shooter` failed 5 of 5 runs with this change and 1 of 3 without it.** I could
  not find a cause in the change. The scene needs two arrows to hit within 25 s; in a failing
  and a passing run the bot did the same things tick for tick until the arrows flew, and the
  difference was whether its flinch at the first volley made that arrow miss. So the scene
  looks flaky, but eight runs do not rule out that the change makes a miss more likely.
- **The scene's plaza is 9 blocks wide**, so a route round a threat that could harm is still
  impossible there; the free-husk half only shows the fleeing and the silence.
- **The "threatened" label now differs for a caged mob**, so what was learned under it before
  (in a saved scorebook) is filed under a label the bot no longer gets in that case.

**Status.** Built. Open: the limits above.

## Dopamine: staying alive comes before any other need

*Built and run live 2026-11-21.*

**The problem.** Every need counted alike. Out of food with a hostile mob close, the want for a
known chest stayed at full strength (up to 0.9), and Jev's pick to defend itself was loosened
like any other option, so the bot could set off for the chest past the threat. Food is there
to mend health; it is never worth more than not being killed.

**The change: needs have a rank** (`rank` on a reward rule; `pressingNow` in
`dopamine/rewards.ts`).
- A need with a higher rank silences every lower one while it presses at all. With a threat in
  range, nothing lesser is worth setting off for, however far inside the range it is.
- `danger` has rank 1; every other need has rank 0. A new vital need takes one number.
- Both places that act on needs read those levels: what the bot wants (the cues) and
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
| Husk gone | Went for the chest and got its bread (23 s later then, because a fright still cleared the goal; it no longer does) |
| Six other dopamine scenes (`with_jev` among them); `neuro-check` calm, ambush, remembered, hunger | No problem; all pass |

**Limits.**
- **Only a hostile mob within 8 blocks counts as danger.** Lava, a fall, fire, drowning and low
  health do not quieten other needs (the hard reflexes cover the first four). Low health is
  rank 0: it is not a threat by itself, and food is what mends it.
- **Seen in the first run of the scene:** a trip cut off by a husk appearing was learned as
  "going to this chest makes danger worse". One such run lowers the want a little; several
  would put the bot off a good chest because of where a mob happened to be.

**Status.** Built. Open: the limits above.

## Dopamine: a pressing need loosens the hold of a skill that does not serve it

*Built and run live 2026-11-21.*

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

*Built and run live 2026-11-21.*

**The problem, as first written, was half wrong.** I had said a chest the bot "is not looking
at" pulls nothing. Checked against the code: dopamine reads the full state, where a chest is
listed whenever it is within 16 blocks, whichever way the bot faces. What is true is that a
want fired only for a thing listed in the state at that moment. A chest leaves the state when
the bot is more than 16 blocks off, or when more than 10 nearer useful blocks crowd it out.
(At the time alarm above 0.6 also dropped it; that narrowing has since been removed.)

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
| Whole brain with Jev, out of bread, chest known | Cues won 0 ticks of 97,487 | The pull won at 0.64 against Jev's `idle` at 0.54 and started the trip (one usable run of four; later entries have more) |

Ten reflex-only scenes, none showing a problem. Whole-brain regression (`neuro-check` calm,
ambush, remembered, hunger): all pass.

**Limits.**

- **The pull starts the trip; Jev then carries it.** Once the skill is running Jev proposes it
  itself at 0.8 with the stay bonus, so the tick log credits the pull with one tick per trip.
  The scene counts the ticks on which the bot did what was wanted, whoever proposed it.
- **Relief is whatever happened to the need during the run**, whoever caused it. A husk walking
  up while the bot heads to a chest is learned as "this chest raises danger". The credit shift
  of step 2 (the worth of the situation) is not applied to reliefs.
- **Nothing is learned about a thing while the need is met.** A bot that is never short of food
  never learns which chest holds it.
- **Only a skill that finishes the job learns a relief.** `take_items` at a chest relieves the
  food stock; `go_to` the same chest relieves nothing, so walking up to things is wanted only
  where arriving itself helps (light at night).
- **The usual work is kept per thing, not per distance.** It is an average over wherever the
  trips started.
- **An untried chest was not tested.** Boredom is a need with a level now, but noticing a thing
  relieves it on sight, not on arrival, so nothing yet pulls the bot to look inside.
- **The scorebook grows faster**: one more set of adjustments per skill for each need it has
  changed, and one for its work.
- **New settings:** `personality.wanting` (1; 0 learns but never pulls). The half-life of trust
  (4 cut-offs) and the cap (0.9) are hand-set.
- **The live scenes ran once or twice each**; `with_jev` four times, with one usable run.

**Status.** Built. Open: the limits above.

## Dopamine: learning by adjustments, and credit for the difference made

*Built and run live 2026-11-20, in two steps. Together with the signed needs (next entry) these
are the two causes behind the problems found on 2026-11-19. The third step (wanting as need
times expectation, so that a cue can win in the whole brain) is the entry above.*

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
  takes its own step. `personality.learningRate` is now the step per level. (How much of that
  step a run gets now also goes by the size of its surprise: see the acetylcholine entry.)
- **One label on its own learns slowly.** The labels of a situation share one step between
  them, so what a single label changes is learned at a sixth of the pace. Live, after ten falls
  costing 0.25 each, falling was worth only -0.02 and moved credit by 0.03 to 0.04. The direction
  is right; the size is small.
- **Situation worth only moves credit where the situation changes.** A skill that runs from
  before the trouble to after it still takes all of it.
- **An untried chest is never tried while a known one is in view.** The near chest was wanted a
  little (on what chests are worth), the far one more (it had paid), so the bot never opened the
  near one. That was the right answer here, but nothing makes it look in a new chest.
- **The scorebook grows with every block ever aimed at** (each chest, crop and hazard position
  has its own adjustment) and nothing is pruned.
- **Only two rewards name their skill** (`skill_failed`, `slept_through_night`). Every other
  reward in a tick goes whole to the skill that ran longest; it is not split.
- **The two half-lives are hand-set**: what follows a situation counts for half after 10
  seconds; a surprise reaches back to earlier situations for half after 1 second.
- **A skill cut short by a protective reflex is failed on purpose** (-0.1 and a failure on its
  record), so the scorebook learns the skill cost something there. `idle` is failed this way
  by `surface` in every dive.
- **Saved scorebooks in the old format are ignored on load.**
- **New settings:** `personality.situationWorth` (1; 0 turns the credit shift off).
- **The live scenes ran once or twice each**, with no Jev.

**Status.** Built. Open: the limits above.

## Dopamine: rewards are now the signed change in a need

*Built and run live 2026-11-20. This is the one change behind most of the problems found in
live testing on 2026-11-19, not a fix for each.*

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

**Live** (`pnpm dopamine-check`, one run):

| Scene | Before | After |
|---|---|---|
| Death, hungry and hurt, a husk beside it | Net +0.46; DA 0.57 → 0.62 | Net -1.01; DA 0.44 → 0.33 |
| Idle while six animals appear and a wound mends | `idle` paid +2.60; +0.10 in the arbiter | `idle` paid -0.03; 0.00 in the arbiter; DA peaked at 0.53 (was 0.84) |
| A caged husk appears and is removed | +0.39 | -0.39 on appearing, +0.39 on going: 0.00 |
| A creeper appears and goes off | +0.33 | 0.00 |
| Drop a sword and pick it up, four times | +0.98 | -0.44 and +0.44 each round: 0.00; DA ended at 0.58 (was 0.82) |
| In and out of a lit corner at night, four round trips | +0.85 | 0.00; walking into the dark is now learned as a loss (-0.46 to -0.60 a trip) |

Whole-brain regression (`neuro-check` calm, ambush, remembered, hunger): all pass. Eating paid
0.44, 0.31, 0.19, 0.06 over four meals.

**Limits and consequences.**

- **A hit at full health barely registers** (20 → 17 costs 0.02) and the same hit when weak
  costs a lot (6 → 3 costs 0.23). Before, every hit cost the same. Pain and the startle do not
  use this number, so the reflexes are unchanged.
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

**Status.** Built. Open: the limits above.

## Dopamine: wasted effort, and its limits

*Built 2026-11-19 (`packages/neuromodulators/src/dopamine/wasted.ts`,
`packages/minecraft/src/brain/effort-spent.ts`).*

**What it does.** While a skill runs, the work the body does is added up: blocks travelled, seconds
spent busy, and food energy burned. When the skill ends as done or failed, having earned less than
that work was worth, the difference is charged as a negative reward (`wasted_effort` in the tick's
rewards). It is only charged where the bot expected a payoff, so a far chest that has stopped
paying is given up on sooner than a near one.

**Limits.**

- **Only a run that expected a payoff is charged.** A first fruitless walk somewhere new costs
  nothing, and neither does going home or storing items, which no reward rule pays for. Without
  this, every unrewarded skill would slowly lose to `idle`. The price: the bot learns "this was a
  waste" only about things that once paid.
- **The charge stops when the expectation crosses zero**, so the expectation settles just below
  zero (by about a tenth of one trip's effort), not at the true cost of the trip. It then drifts
  back up toward zero on later empty trips, without crossing.
- **An interrupted run is never charged**, however far the bot had walked. Nor is one that ended
  in death (the death penalty covers it).
- **A skill that mostly waits** (a slow chest, a long dig) **is charged for the wait.**
- **A run that starts and ends between two ticks is not charged**: no effort is counted for it.
- **Effort is three hand-set weights**: a block 1/400, a busy second 1/400, a food point 1/40,
  capped at 0.5 a run. Digging, fighting and climbing count only through time and food. Damage
  taken is not effort (it is already a negative reward).
- **Distance is from whole-block positions**, so a tick's movement is rough. A jump of more than
  8 blocks, a respawn, or a gap of more than 2 seconds between ticks counts as no work.
- **Mending hides effort.** While health is coming back, food burned is not counted, even if the
  bot is also sprinting.
- **A big reward on the tick a skill ends hides the waste from DA.** The charge is added to the
  tick's total, so an unrelated gain that tick can cancel it there. The scorebook is still charged.
- **Old logs and saved scorebooks are unaffected**; the trace has one new reward name and the
  episode a new `wasted`, `gained` and `effort`.

**Status.** Open. Seen live 2026-11-19 (`pnpm dopamine-check two_chests`): charged -0.024 and -0.027 for a 14-block trip to an emptied chest.

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
refused once at dawn.

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
  A long safe idle at base does not count; only a drowsy one does.
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
  defence circuit reads looming from the state. It still switches off the `looming` signal.
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

**Seen, left as it is.**

- **The five bangs are not evenly smaller.** The third fell to 0.06 because the bot was still
  looking toward the last one, which counts as having seen it coming. The fourth, with its head
  elsewhere, was 0.22.
- **A threat right on the bot takes the planner offline while it is there**: alarm follows the
  danger now (see the noradrenaline entry).
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
  named in "Brainstem: most strengths are on or off".

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

**Seen, left as it is.**

- **Sound names cannot be trusted on this version.** A probe
  showed a cow's hurt arriving as "coral_block.step" and an arrow landing as
  "armor_stand.place". What is reliable is where a sound came from, its category and its volume,
  and five events with no sound name at all (explosion, lightning bolt, something hurt, a door
  changing, a projectile appearing). Hearing uses only those.
- **Beside real work a look competes at 0.35 to 0.7 and usually loses**, unless `--same-time`
  lets it run alongside.
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
  things are; a soft reflex and habituation are what temper it. *Not narrowed by the lean
  (2026-11-24): the lean tells a dive from above from a charge at eye level, and a small slow
  thing on the ground from the rest, but a friend sprinting at the bot at eye level is as
  looming as before. See "The colliculus: a map with up and down".*
- **The stand-in for footsteps knows what is hostile.** It is the one identity leak, kept in one
  function. A silent, unseen friendly mob is not heard; a hostile behind a wall within 8 blocks is.
- **"Seen" is a ray to the middle of the thing.** A mob whose feet show under a ledge is unseen;
  one whose middle is visible through a one-block gap is seen. Leaves and other see-through
  blocks do not block sight at all. Darkness does not reduce it (since 2026-11-24 it lowers how
  much a seen thing stands out, not whether it is seen).
- **`changed` covers blocks placed or broken and doors within 8 blocks**, including the bot's
  own digging and placing, which then draw its own eye for a moment (it is usually looking there
  already; since 2026-11-24 such a look sends no `orienting` signal). Crops growing, levers and redstone are not changes.
- **Habituation's "nothing followed" is only damage or a reward** while the thing was attended.
  A thing that led to something useful in a way dopamine did not reward is got used to all the
  same. *Closed 2026-11-24 (`colliculus.followUp`): a skill started on the thing, a need that
  moved, or a change of defence because of it also count, up to 2 seconds after the look.*
  Kind-at-place still uses 8-block squares worked out from bearing and distance, so it is rough.
- **Glances are to eight fixed compass directions at eye level.** The bot never looks up or
  down on its own, and does not glance while travelling. *Partly closed 2026-11-24
  (`colliculus.elevation`): every fourth glance goes to the sky, or under a roof to the ceiling
  or the floor ahead, and a look at a thing overhead turns the head up. It still does not glance
  while travelling.*
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

**Seen, left as it is.**

- **Slippery and slow cannot be learned on this body.** Three things, each measured: a steady
  walk on ice is no faster than on stone (ice changes how fast the body gets going and stops, not
  its top pace); the pathfinder sets the bot's sideways speed to zero the moment it stops, so
  there is never a slide to measure; and soul sand and honey do not slow this client at all (30
  blocks took 5.3 s on each, the same as on stone). The learning is unit-tested but has shown
  nothing live. **Fix later:** measure how long the body takes to get up to speed, which ice
  does change; soul sand needs Mineflayer's physics fixed first.
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
| Hungry while asleep | Woke and ate |

**Seen, left as it is.**

- **An urge shrinks the stay bonus.** The medulla shares its strongest urge as an `urge` signal,
  and the arbiter shrinks the stay bonus by it (bonus × (1 − urge)). This changes the arbiter
  slightly for every skill while an urge is firing, including the urge's own skill once it is
  running.
- **The urge to breathe wins late.** It is 0.90 at air 7, and until then Jev's `idle` (about
  0.78 plus its learned value) outvotes it. So the bot starts up at air 7, needs a second or two
  to swim, and `drowning` still fires on the way. The spec's "well before 6" is not met: it
  surfaces from the soft urge, but one point before the limit. **Fix later:** start the urge
  higher or earlier (`NEED_AIR` in `medulla.ts`); the 0.3-to-0.9 curve was left as specified.
- **With a goal that tells Jev to stay still at the bottom, the urge may never win** (Jev's
  confidence in `idle` goes to 0.98 and stays there), and only `drowning` saves the bot. The
  free-dive scene uses a goal that does not say that.

## The medulla: limits of this first version

- **Nothing acts on `cold`, `reserve` or `vitals`.** They are shared and logged for a
  later drives region. `cold` was checked by reading the freezing meter in powder snow, not by a scene.
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

**Status.** Open: the items under "left as it is".

## Reflexes: limits of the withdrawal, stretch and learning

*Found 2026-11-16 while building `packages/minecraft/src/brain/protective-reflexes.ts` and `pain.ts`.*

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
| `far` | It only looked. |

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

**Seen, left as it is.**

- **The pathfinder prefers any dry route.** In play this means the swim pattern is used only
  when there is no dry way.
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

**Status.** Open: the items under "left as it is".

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

## Live testing: a bot that flees far does not come home

*Found 2026-11-16 re-running `pnpm neuro-check` after the primitives work.*

**What we saw.** After the ambush scene the bot had fled 73 blocks from base.

**Why.** Before the brainstem layer the bot fought or fled a short way; with defence by distance
it keeps retreating while the zombie follows.

**Status.** Open: the bot flees a long way from a single zombie and does not come
back by reflex; getting home is left to Jev and the planner.

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

**Seen, left as it is.**

- **Lava is only survivable with health and water to spare.** Lava does 4 damage every half
  second, and the bot keeps burning afterwards. From full health with water 3 blocks away the bot
  got out in 0.6 s and lived (lowest health 13).
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

**Status.** Open: the items above.

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

**What we saw.** `gains` and `holdBack` scale smoothly from 0 to 1, and so do `startle`,
`potentiation`, `warning` and `habituation`. `loadedResponses`, `bodySignals`, `selfCaused` and
`startReact` are on above 0 and off at 0.

**Why.** There is no natural "half" of these. The noradrenaline and focus effects work the same way.

**What would fix it.** Give each a meaning for in-between values.

**Status.** Open.

## Live testing, 2026-11-14: what was found and fixed

*Found by running the real bot (Jev + Claude) on the test server with `pnpm neuro-check`, and
reading each run with `pnpm brain-report`.*

Seven scenes now pass: calm, ambush, remembered (restart), hunger, night (sleep), dark, and a
five-minute mixed soak.

**Not yet exercised live** (covered by automated tests only): the cue pulse, search telling the
planner that a goal is not paying off, the panic lock, a remembered chest being rejected at
high focus, and general facts from three matching memories.

**Status.** Open: run those scenes next.

## Live testing: the bot mostly idles at base

*Found 2026-11-14 in the five-minute soak.*

**What we saw.** With nothing threatening it, the bot spends most of its time on `idle` at base.
The planner sets goals like "explore to find oak trees", but nothing carries them out.

**Why.** No skill gathers, builds or explores. This is not a
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

## Focus: only chest contents are checked for trust

*Found 2026-11-14 while building focus (`packages/minecraft/src/chest-memory.ts`).*

**What we saw.** "Use a remembered value only if trust is above focus" applies to chest contents
alone. The bot now acts on two more remembered things, and neither is trust-checked: where a
thing it learned about stands (the memory of places, which makes it want a chest it cannot
sense), and whether a mob in a given spot can get to it. Neither carries a time, so both are
believed for ever. Where another player was last seen is not remembered at all, and event
memories given to the planner are not trust-checked (they fade by strength instead).

**What would fix it.** Put a time on every remembered thing and route it through the same trust
check.

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

## Alarm: some triggers can't be sensed yet

*Found 2026-11-14 while building alarm (`packages/minecraft/src/brain/alarm.ts`).*

**What we saw.** Two
triggers from the design are missing: a hostile targeting the bot, and another player being
attacked.

**Why.** The state doesn't say who a mob is after, and other players' fights aren't
sensed. There are TODO comments for both in `alarm.ts`.

**What would fix it.** Add those senses to the state.

**Status.** Open. Explosions are sensed and reach alarm through the startle.

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

**Why.** "Same steps" is checked by comparing the text.

**What would fix it.** Tell the planner to repeat unchanged steps word for word, or give steps
stable ids so a reworded step keeps its place.

**Status.** Open. Matters once something reads the count itself (e.g. showing Jev the next step).

## Planner steps: the echo planner never marks a step done

*Found 2026-11-14 while adding `stepsDone` to goals.*

**What we saw.** With the free `echo` planner no step is ever marked done.

**Why.** Judging steps needs a real planner; echo returns a fixed plan.

**What would fix it.** Nothing needed for real runs (`--planner claude`). For offline runs, the
"done when" conditions above would work without an LLM.

**Status.** Open, low priority.

