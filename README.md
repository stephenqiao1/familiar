# Familiar

Familiar is a set of AI players for Minecraft, each with a role (the first is the Miner). Each bot has a brain built from separate parts (regions): **reflex** (plain rules), **instinct** (the fast decision model Jev) and **neocortex** (an LLM that sets goals). The parts share one workspace and an arbiter picks what to do. See [docs/brain.md](docs/brain.md).

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
pnpm start -- --host localhost --port 25565 --name Miner
```

Add `--engine jev` to use Jev for instinct, `--planner claude` to use Claude for the neocortex (needs `ANTHROPIC_API_KEY` in `.env`), and `--regions reflex,instinct` to run with only some regions.

The bot joins as `Miner` and prints one line per tick (tick, action, which region won and why, time to decide). Every tick is also appended to `logs/miner-<timestamp>.jsonl`. Press Ctrl+C to stop; the bot logs out cleanly.
