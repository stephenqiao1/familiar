# Familiar

Familiar is a generic AI player for Minecraft. Each bot has a brain built from separate parts (regions): **reflex** (plain rules), **instinct** (the fast decision model Jev) and **prefrontal cortex** (an LLM that sets goals). The parts share one workspace and an arbiter picks what to do. See [docs/brain.md](docs/brain.md).

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

Add `--engine jev` to use Jev for instinct, `--planner claude` to use Claude for the prefrontal cortex (needs `ANTHROPIC_API_KEY` in `.env`), and `--regions reflex,instinct` to run with only some regions.

Each bot's settings live in `bots.json`, keyed by its `--name`. For now that's its dopamine personality: `restingDA` (higher is eager, lower is cautious), `learningRate` (quick to change its mind or stubborn) and `noveltyBonus` (explorer or creature of habit). A bot not listed gets the defaults (0.5, 0.1, 0.5). `patience` holds its serotonin settings: `resting` level, `timeConstantSeconds`, and the strength of each effect (`persistence`, `horizon`, `brake`; 0 turns one off, 1 is full). `noradrenaline` holds its alarm and search settings: `alarmGain` (jumpy or steady), `alarmDecaySeconds` (shakes it off or stays rattled), `searchResting` (restless or settled), and an on/off value (0 or 1) for each effect. `focus` holds its focus settings: `resting` (watchful or easy-going), `trustHalfLifeMinutes` (double-checker or assumer), `factSupport` (quick to generalise or cautious), and an on/off value for each effect. `memory.halfLifeDays` sets how fast weak memories fade. What each bot learns and remembers (its scorebook, what it has met, what was in each chest it opened, and its memories of events and places) is kept in `data/<name>/`.

The bot joins as `Player` and prints one line per tick (tick, action, which region won and why, time to decide). Every tick is also appended to `logs/player-<timestamp>.jsonl`. Press Ctrl+C to stop; the bot logs out cleanly.

## Checking the brain

```sh
pnpm test            # every automated test, including whole-brain behaviour tests (no server needed)
pnpm neuro-check     # live scenes on the test server with Jev + Claude: calm, ambush, hunger, night, ...
pnpm neuro-check ambush soak   # only some scenes
pnpm brain-report    # summarise the newest run's log: each dial, rewards, memories, warnings, errors
```

`neuro-check` uses a bot named `Tester` (its learning is kept apart in `data/Tester/`) and the
server container named in `MC_CONTAINER` (default `familiar-m6`). Things noticed along the way are
in [docs/findings.md](docs/findings.md).

