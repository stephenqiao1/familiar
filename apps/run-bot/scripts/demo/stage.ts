// The stage for a live demo: finds the person watching, moves their camera, puts words on their
// screen, keeps a live readout above their hotbar, and marks things in the world.
import { execFile } from "node:child_process";
import { rcon, sleep } from "../primitive-check/world.ts";

const CONTAINER = process.env.MC_CONTAINER ?? "familiar-m6";
/** Players that are part of the tests, never the person watching. */
const CAST = new Set(["Tester", "Observer", "Leader", "Player", "Brave", "Timid", "Slow", "Resting", "Alarmed"]);
const GAME_MODES = ["survival", "creative", "adventure", "spectator"];

/** A server command that does not hold up this process (the bots here keep moving while it runs). */
export function send(command: string): void {
  execFile("docker", ["exec", CONTAINER, "rcon-cli", "--", command], () => {});
}

const json = (text: string, color = "white", bold = false) => JSON.stringify({ text, color, bold });

/** The players online who are not part of the tests. */
function watching(): string[] {
  const names = rcon("list").split(":")[1] ?? "";
  return names.split(",").map((n) => n.trim()).filter((n) => n && !CAST.has(n));
}

/** Waits for someone to watch: the named viewer, or whoever joins who is not a test bot. */
export async function findViewer(named?: string): Promise<string> {
  let told = false;
  while (true) {
    const here = named ? (rcon("list").includes(named) ? [named] : []) : watching();
    if (here[0]) return here[0];
    if (!told) console.log(`Waiting for ${named ?? "you"} to join: open Minecraft 1.21.11, Multiplayer, Direct Connection, localhost:25565`);
    told = true;
    await sleep(2000);
  }
}

export interface Stage {
  viewer: string;
  /** Moves the viewer's camera: "x y z yaw pitch". */
  camera(at: string): void;
  /** Big words in the middle of the screen, with a smaller line under them. */
  title(text: string, under?: string, color?: string): void;
  /** A line in the viewer's chat. */
  say(text: string, color?: string): void;
  /** Keeps the bar above the hotbar showing `text()`, twice a second, until the returned function is called. */
  readout(text: () => string): () => void;
  /** Makes players or mobs glow, so they can be seen through walls: a selector or a name. */
  glow(who: string): void;
  /** Puts the viewer back as they were. */
  leave(): void;
}

/** Sets the stage for one viewer: remembers their game mode, then makes them a spectator. */
export function createStage(viewer: string): Stage {
  const was = GAME_MODES[Number(/(\d)$/.exec(rcon(`data get entity ${viewer} playerGameType`))?.[1] ?? 0)] ?? "survival";
  const home = /\[(-?[\d.]+)d, (-?[\d.]+)d, (-?[\d.]+)d\]/.exec(rcon(`data get entity ${viewer} Pos`));
  rcon(`gamemode spectator ${viewer}`);
  rcon(`title ${viewer} times 5 70 15`);
  return {
    viewer,
    camera: (at) => void rcon(`tp ${viewer} ${at}`),
    title(text, under = "", color = "gold") {
      send(`title ${viewer} subtitle ${json(under, "white")}`);
      send(`title ${viewer} title ${json(text, color, true)}`);
    },
    say: (text, color = "yellow") => send(`tellraw ${viewer} ${json(text, color)}`),
    readout(text) {
      const show = () => send(`title ${viewer} actionbar ${json(text(), "aqua")}`);
      show();
      const timer = setInterval(show, 500);
      return () => clearInterval(timer);
    },
    glow: (who) => send(`effect give ${who} glowing 600 0 true`),
    leave() {
      rcon(`title ${viewer} clear`);
      if (home) rcon(`tp ${viewer} ${home[1]} ${home[2]} ${home[3]}`);
      rcon(`gamemode ${was} ${viewer}`);
    },
  };
}
