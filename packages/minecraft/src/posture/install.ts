import type { Bot } from "mineflayer";
import type { PostureSettings } from "../brain/posture.js";
import type { Locomotion } from "../locomotion/index.js";
import { trackDisplaced } from "./displaced.js";
import { trackFalls } from "./falls.js";
import { feelSurfaces, setSurfaceLearner } from "./learn.js";
import { installPosture, type PostureNotes } from "./runtime.js";
import { createSurfaces, setKnownSurfaces, type SurfaceCounts, type Surfaces } from "./surfaces.js";

/** An explosion this recent may be what brought a block down. */
const BANG_MS = 3000;

export interface PostureParts {
  settings: PostureSettings;
  /** What the bot has learned about surfaces so far. */
  learned?: Partial<SurfaceCounts>;
  locomotion: Locomotion;
  /** When the bot last heard an explosion, in ms (or never). */
  lastBang?(): number | null;
  log(msg: string): void;
}

/** One bot's posture, set up: what the state encoder and the brain ask of it each tick. */
export interface Posture {
  surfaces: Surfaces;
  /** How far the bot has come down in the fall under way. */
  fallen(): number;
  /** True once after the bot was moved somewhere else. */
  displaced(): boolean;
  /** What the posture system did since last asked, for the tick's trace. */
  notes(): PostureNotes;
}

/**
 * Sets up a bot's posture: what it knows about surfaces, the check and stance switches, and the
 * senses that watch it fall, be moved somewhere else, and feel the ground it walks on.
 */
export function setUpPosture(bot: Bot, parts: PostureParts): Posture {
  const { settings, locomotion, log } = parts;
  const surfaces = createSurfaces({ innateLoose: settings.innateLoose, ...(parts.learned ? { learned: parts.learned } : {}), learn: settings.learnSurfaces });
  setKnownSurfaces(bot, surfaces.kindOf);
  const runtime = installPosture(bot, { check: settings.check, stance: settings.stance }, log);
  if (settings.learnSurfaces > 0) {
    setSurfaceLearner(bot, surfaces, () => Date.now() - (parts.lastBang?.() ?? -Infinity) > BANG_MS);
    feelSurfaces(bot, () => locomotion.status().pattern === "walk");
  }
  const falls = trackFalls(bot, (fall, edge) => {
    log(`posture: fell ${fall.blocks} blocks onto ${fall.onto}, damage ${fall.damage}${fall.steered ? ", steering for a better landing" : ""}${fall.note ? ` (${fall.note})` : ""}`);
    // An edge that hurt to go over is kept away from for a while, like a spot that hurt to touch.
    if (fall.damage > 0 && edge) {
      locomotion.avoid(edge);
      log(`posture: avoiding the edge at ${Math.floor(edge.x)},${Math.floor(edge.y)},${Math.floor(edge.z)} for 5 minutes`);
    }
  });
  const displaced = trackDisplaced(bot, (from, to) => {
    if (settings.displaced <= 0) return;
    // The journey, and every stuck and avoid mark, were for the old place.
    locomotion.stop();
    locomotion.forget();
    const text = `moved ${Math.round(from.distanceTo(to))} blocks at once, to ${Math.floor(to.x)},${Math.floor(to.y)},${Math.floor(to.z)}`;
    runtime.note("displaced", text);
    log(`posture: ${text}: journey stopped, old marks forgotten`);
  });
  return { surfaces, fallen: falls.fallen, displaced: () => displaced.take() && settings.displaced > 0, notes: () => runtime.take() };
}
