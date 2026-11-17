# Familiar

Familiar is a generic AI player for Minecraft. Each bot has a brain built from separate parts (regions): **reflex**, **medulla** and **brainstem** (wired-in reactions, body upkeep, and the layer that tunes them), **instinct** (the fast decision model Jev) and **prefrontal cortex** (an LLM that sets goals). The parts share one workspace and an arbiter picks what to do. See [docs/brain.md](docs/brain.md).

It is a pnpm monorepo of small packages that talk only through shared types in `@familiar/contracts`. Only `@familiar/minecraft` touches Minecraft or Mineflayer; the core, the brain regions and every decision engine stay game-agnostic so they can be reused in other projects.

## Requirements

Node 22+ and pnpm. Run `pnpm install` once.

## Start a local server

The bot joins without a Microsoft account, so the server must run with `online-mode=false`. Use a Minecraft version that Mineflayer supports (1.21.11 is a safe choice).

**With Docker** (accepts the [Minecraft EULA](https://aka.ms/MinecraftEULA) for you):

```sh
docker run -d --name familiar-mc -p 25565:25565 \
  -e EULA=TRUE -e ONLINE_MODE=false -e VERSION=1.21.11 \
  itzg/minecraft-server
```

**Without Docker** (needs Java 21+): download `server.jar` from <https://www.minecraft.net/download/server>, then:

```sh
java -jar server.jar nogui   # first run creates eula.txt and server.properties, then exits
# set eula=true in eula.txt, and online-mode=false in server.properties
java -Xmx2G -jar server.jar nogui
```

## Run the bot

```sh
pnpm start -- --host localhost --port 25565 --name Player
```

Add `--engine jev` to use Jev for instinct, `--planner claude` to use Claude for the prefrontal cortex (needs `ANTHROPIC_API_KEY` in `.env`), `--regions reflex,instinct` to run with only some regions, and `--primitives` to let Jev choose the body's built-in actions (`look_at`, `step_toward`, ...) as well as skills. `--same-time` lets a look run alongside a skill that leaves the head free. A bot's learned skills (chains of primitives, as data) are read from `data/<name>/learned-skills.json`.

Each bot's settings live in `bots.json`, keyed by its `--name`. For now that's its dopamine personality: `restingDA` (higher is eager, lower is cautious), `learningRate` (quick to change its mind or stubborn) and `noveltyBonus` (explorer or creature of habit). A bot not listed gets the defaults (0.5, 0.1, 0.5). `patience` holds its serotonin settings: `resting` level, `timeConstantSeconds`, and the strength of each effect (`persistence`, `horizon`, `brake`; 0 turns one off, 1 is full). `noradrenaline` holds its alarm and search settings: `alarmGain` (jumpy or steady), `alarmDecaySeconds` (shakes it off or stays rattled), `searchResting` (restless or settled), and an on/off value (0 or 1) for each effect. `focus` holds its focus settings: `resting` (watchful or easy-going), `trustHalfLifeMinutes` (double-checker or assumer), `factSupport` (quick to generalise or cautious), and an on/off value for each effect. `brainstem` holds `bravery` (0 timid, 1 brave) and a 0-to-1 strength for each part that tunes the reflexes (`gains`, `startle`, `orienting`, `loadedResponses`, `holdBack`, `arousalGate`, `bodySignals`). `reflexes` holds what the bot is born knowing hurts (`innateHurts`) and a switch for each protective reflex (`painWithdrawal`, `buried`, `aboutToTouch`: 0 or 1; `holdGround`, `edgeGuard`, `learnHurts`, `sensitise`: 0 to 1). `medulla` holds what the bot is born knowing is bad to eat (`innateBadFoods`) and a 0-to-1 strength for each part of its body upkeep (`needAir`, `eatToHeal`, `cure`, `learnBadFoods`, `vitals`). `locomotion` holds how strongly the brain's dials set how the bot travels (`speedFromAlarm`, `speedFromDopamine`, `cautionFromFocus`, each 0 to 1). `memory.halfLifeDays` sets how fast weak memories fade. What each bot learns and remembers (its scorebook, what it has met, what was in each chest it opened, which blocks it has learned hurt, which foods it has learned are bad, when it last slept, and its memories of events and places) is kept in `data/<name>/`.

The bot joins as `Player` and prints one line per tick (tick, action, which region won and why, time to decide). Every tick is also appended to `logs/player-<timestamp>.jsonl`. Press Ctrl+C to stop; the bot logs out cleanly.

## Checking the brain

```sh
pnpm test            # every automated test, including whole-brain behaviour tests (no server needed)
pnpm neuro-check     # live scenes on the test server with Jev + Claude: calm, ambush, hunger, night, lava, drowning, ...
pnpm neuro-check ambush soak   # only some scenes
pnpm reflex-check    # live pass for the withdrawal and stretch reflexes: cactus, magma, berry bush, buried, lava edge, shoved
pnpm medulla-check   # live pass for body upkeep: a dive, a held breath, eating to heal, starving, a bad food, a cure, hungry while asleep
pnpm locomotion-check # live pass for travel: walks at three speeds, a pond, a pit, a door, following, stopping, looking while walking
pnpm skill-check     # live pass for the primitives: each one run to completion and interrupted, checked against an observer
pnpm brain-report    # summarise the newest run's log: each dial, rewards, reflexes and brainstem, the medulla, memories, warnings, errors
```

## Watching the limits live

`pnpm demo` shows the limits listed in [docs/findings.md](docs/findings.md) in the real game, in
your own Minecraft client:

1. Open Minecraft Java Edition 1.21.11 and join `localhost:25565` (Multiplayer, Direct Connection).
2. Run `pnpm demo` to list the demos, `pnpm demo follow door` to run some, or `pnpm demo all`.

Each demo makes you a spectator at a good camera spot, says on screen what to watch for, keeps a
live readout above your hotbar (gap, gait, health, what the bot is doing), and ends with the
measured result. You are put back as you were afterwards. Demos marked "uses Jev" run the whole
brain and vary from run to run; the runner keeps count of how often each has shown its limit
(`data/demo-tally.json`). `--viewer <name>` picks who to show it to; `--no-pause` skips the wait
between demos.

`neuro-check` uses a bot named `Tester` (its learning is kept apart in `data/Tester/`; the `brave`
and `timid` scenes use bots of those names) and the server container named in `MC_CONTAINER`
(default `familiar-m6`). Scenes that need lava, water or room to run build a walled stone plaza in
the sky (x 40 to 80, z 36 to 44, y 150) and clear it afterwards. Things noticed along the way are
in [docs/findings.md](docs/findings.md).

