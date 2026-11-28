import type { Region, Workspace } from "@familiar/contracts";
import { comfortOf, createFelt, type Reading } from "./felt.js";
import { feelingLine } from "./line.js";
import { createMood } from "./mood.js";
import type { InsulaSettings } from "./settings.js";
import { createUnease } from "./unease.js";

export interface InsulaOptions {
  settings: InsulaSettings;
  /** The body's readings as feelings: for each, its word, how strong it is now (0 to 1) and where it comes from. The game's side supplies the table. */
  readings(ws: Workspace): Reading[];
  /** The raw readings watched for a change nothing explains, each 0 to 1 (health, food, breath). Default: none. */
  body?(ws: Workspace): Record<string, number>;
  /** The known cause of a raw reading changing right now (a hit, a meal, a fall), or null. Default: nothing is explained. */
  explains?(reading: string, change: number, ws: Workspace): string | null;
  /** A surprise just felt, -1 (much worse than expected) to 1, or null with none this tick. Default: none. */
  surpriseOf?(ws: Workspace): number | null;
  /** Default: "insula". */
  name?: string;
  /** Default: 0 (runs inside every tick). */
  layer?: number;
}

/**
 * The insula: turns the body's readings into one statement of how the bot feels, and writes it
 * to the workspace (`ws.feeling`). It only restates readings the body already has:
 *   - a short list of named feelings, strongest first (felt.ts);
 *   - `comfort`, how good the body's state is overall;
 *   - `mood`, comfort and recent surprises averaged over minutes (mood.ts);
 *   - `uneasy`, when the body changes in a way nothing explains (unease.ts);
 *   - the feeling as a line of words for the deciding layers (line.ts).
 * It proposes nothing and makes no model call.
 */
export function createInsulaRegion(options: InsulaOptions): Region {
  const { settings, name = "insula", layer = 0 } = options;
  const felt = createFelt();
  const mood = createMood();
  const unease = createUnease();
  return {
    name,
    layer,
    everyMs: 0,
    run(ws) {
      if (!(settings.feeling > 0)) {
        ws.setFeeling(null);
        return { proposals: [] };
      }
      const now = ws.state.timestamp;
      const feelings = felt(options.readings(ws));
      const comfort = comfortOf(feelings);
      const odd = settings.uneasy > 0 && options.body ? unease.tick(options.body(ws), (reading, change) => options.explains?.(reading, change, ws) ?? null, now) : { level: 0, about: [] };
      const uneasy = { level: settings.uneasy * odd.level, about: odd.about };
      const level = settings.mood > 0 ? mood.feel(comfort, options.surpriseOf?.(ws) ?? null, now) : 0;
      const feeling = { feelings, comfort, mood: level, uneasy };
      const line = feelingLine(feeling);
      ws.setFeeling({ ...feeling, line });
      return { proposals: [], trace: { feelings, comfort: round(comfort), mood: round(level), ...(uneasy.level > 0 ? { uneasy: { level: round(uneasy.level), about: uneasy.about } } : {}), line } };
    },
  };
}

const round = (n: number) => Math.round(n * 1000) / 1000;
