import type { Skill, Workspace } from "@familiar/contracts";
import { REWARD_SIGNAL } from "@familiar/neuromodulators";
import type { ColliculusOptions, Features, Percept } from "@familiar/region-brainstem";
import type { MinecraftStateData } from "../encode/state-data.js";
import { asleep } from "./focus.js";
import { REFLEX_SKILLS } from "./protective-reflexes.js";
import { minecraftDataOf, sightedOf } from "./read-state.js";

// The player's colliculus settings: how what it sees, hears and feels becomes the physical
// features the map scores. Every number is a first guess to tune in play.

/** What the map is told about one thing. Physical facts only: nothing here says what the thing is. */
export interface Physical {
  /** Blocks away. */
  dist: number;
  /** Degrees from straight ahead. */
  angle: number;
  /** How fast it is coming nearer, in blocks per second. */
  closing: number;
  /** How fast it is moving at all, in blocks per second. */
  speed: number;
  /** It just appeared, started moving or changed. */
  sudden: boolean;
  /** A projectile heading this way. */
  incoming: boolean;
  /** How loud it is here, 0 to 1 (0 for something only seen). */
  loudness: number;
  /** It just hurt or pushed the bot. */
  touch: boolean;
}

const IDLE = "idle";
/** Nearness fades to nothing at this distance. */
const NEAR_WITHIN = 16;
/** Closing this fast (blocks per second) is full looming; under `from` it is none. */
const LOOMING = { from: 4, full: 8 };
/** Moving this fast across the view is full motion; in the sharp middle of the view it counts for less. */
const MOTION = { from: 0.5, full: 4, central: 0.6, centralWithin: 30 };
/** A hurt this fresh is touch. */
const TOUCH_MS = 700;
/** Places are told apart this coarsely when getting used to a kind of thing somewhere. */
const PLACE_BLOCKS = 8;
/** Glances go this far out, to one of this many compass directions. */
const SCAN = { blocks: 8, sectors: 8 };
/**
 * A look that takes over from idling is proposed at full urgency: a graded one (0.35 to 0.7)
 * never wins in play, since idling scores about 0.9 with its learned value and stay bonus. This
 * is safe because it only happens with nothing running (idling itself leaves the head free, so
 * a look runs beside it), when no reflex, startle or loaded response spoke, and a look is over
 * in a moment.
 */
const TAKE_OVER_URGENCY = 1;
const clamp = (n: number) => Math.min(1, Math.max(0, n));

/** The features of one thing, from physical facts alone. */
export function featuresOf(p: Physical): Features {
  const motion = p.speed >= MOTION.from ? clamp(p.speed / MOTION.full) * (Math.abs(p.angle) <= MOTION.centralWithin ? MOTION.central : 1) : 0;
  return {
    suddenness: p.sudden ? 1 : 0,
    motion,
    looming: p.incoming ? 1 : p.closing >= LOOMING.from ? clamp(0.5 + (0.5 * (p.closing - LOOMING.from)) / (LOOMING.full - LOOMING.from)) : 0,
    nearness: clamp(1 - p.dist / NEAR_WITHIN),
    loudness: clamp(p.loudness),
    touch: p.touch ? 1 : 0,
  };
}

/** Roughly where something lies, from the bot's place, its heading and the thing's bearing. */
function placeOfThing(data: MinecraftStateData, angle: number, dist: number): string {
  const heading = ((data.self.gaze.yaw + angle) * Math.PI) / 180;
  const { x, z } = data.self.position;
  return `${Math.round((x - Math.sin(heading) * dist) / PLACE_BLOCKS)},${Math.round((z - Math.cos(heading) * dist) / PLACE_BLOCKS)}`;
}

/** Everything seen, heard and felt, as the map takes it. `newSounds` says which sounds were not there last tick. */
export function perceptsOf(data: MinecraftStateData, isNewSound: (key: string) => boolean = () => true): Percept[] {
  const { nearby, self } = data;
  const sudden = new Map(nearby.sudden.map((s) => [s.id, s]));
  const percepts: Percept[] = [];
  const still: Physical = { dist: 0, angle: 0, closing: 0, speed: 0, sudden: false, incoming: false, loudness: 0, touch: false };

  // Sight: only what the eyes can see.
  const listed = new Set<string>();
  for (const thing of [...nearby.mobs, ...nearby.players, ...nearby.blocks]) {
    const sight = sightedOf(thing);
    if (!sight.seen) continue;
    listed.add(thing.id);
    const event = sudden.get(thing.id);
    const features = featuresOf({ ...still, dist: thing.dist, angle: sight.bearing.angle, closing: sight.closing, speed: sight.speed ?? Math.abs(sight.closing), sudden: event !== undefined && event.what !== "looming" });
    percepts.push({ id: thing.id, kind: thing.type, place: placeOfThing(data, sight.bearing.angle, thing.dist), bearing: sight.bearing.side, via: "sight", features, fresh: event !== undefined && event.what !== "appeared" });
  }
  // Sudden things that are not on those lists: a projectile, a block that changed.
  for (const event of nearby.sudden) {
    if (listed.has(event.id)) continue;
    const features = featuresOf({ ...still, dist: event.dist, angle: event.bearing.angle, sudden: event.what !== "looming", incoming: event.what === "looming" });
    percepts.push({ id: event.id, kind: event.what === "changed" ? "block" : "unknown", bearing: event.bearing.side, via: "sight", features, fresh: true });
  }
  // Sound: where it came from.
  for (const sound of nearby.heard) {
    const id = `pos:${sound.position.x},${sound.position.y},${sound.position.z}`;
    const fresh = isNewSound(`${sound.type} ${id}`);
    const features = featuresOf({ ...still, dist: sound.dist, angle: sound.bearing.angle, sudden: fresh, loudness: sound.loudness });
    percepts.push({ id, kind: sound.type, place: placeOfThing(data, sound.bearing.angle, sound.dist), bearing: sound.bearing.side, via: "sound", features, fresh: fresh && sound.type !== "presence" });
  }
  // Touch: whatever just hurt the bot, or the way a push came from.
  const hurt = self.lastHurt;
  if (hurt && hurt.msAgo <= TOUCH_MS) {
    const by = hurt.by === null ? null : [...nearby.mobs, ...nearby.players].find((t) => t.id === hurt.by);
    percepts.push({ id: hurt.by ?? `pos:${hurt.at.x},${hurt.at.y},${hurt.at.z}`, kind: by?.type ?? "unknown", bearing: by ? sightedOf(by).bearing.side : "ahead", via: "touch", features: featuresOf({ ...still, touch: true }), fresh: true });
  } else if (self.pushed) {
    const { x, y, z } = self.position;
    const from = `pos:${Math.round(x - self.pushed.toward.x * 2)},${y + 1},${Math.round(z - self.pushed.toward.z * 2)}`;
    percepts.push({ id: from, kind: "unknown", bearing: "behind", via: "touch", features: featuresOf({ ...still, touch: true }), fresh: true });
  }
  return percepts;
}

/** Picks where to glance: the compass direction looked toward longest ago. One per bot. */
export function createScan(): (data: MinecraftStateData, now: number) => string {
  const looked = new Array<number>(SCAN.sectors).fill(0);
  const width = 360 / SCAN.sectors;
  return (data, now) => {
    looked[Math.round(data.self.gaze.yaw / width) % SCAN.sectors] = now;
    const sector = looked.indexOf(Math.min(...looked));
    looked[sector] = now;
    const heading = (sector * width * Math.PI) / 180;
    const { x, y, z } = data.self.position;
    return `pos:${Math.round(x - Math.sin(heading) * SCAN.blocks)},${y + 1},${Math.round(z - Math.cos(heading) * SCAN.blocks)}`;
  };
}

/** Whether a skill leaves the head free (a skill that declares no parts uses the whole body). */
export function headFree(skill: { parts?: string[] } | undefined): boolean {
  return skill?.parts !== undefined && !skill.parts.includes("head");
}

/** Whether a skill uses no part of the body at all (idling): anything may run beside it. */
export function usesNothing(skill: { parts?: string[] } | undefined): boolean {
  return skill?.parts !== undefined && skill.parts.length === 0;
}

/** What the colliculus region needs from the player (everything but the bot's own settings and the brain's dials). */
export function playerColliculus<Ctx>(
  skills: Skill<Ctx>[],
  sameTime = false,
): Pick<ColliculusOptions, "percepts" | "asleep" | "busy" | "eventful" | "idle" | "looksAlongside" | "scan" | "lookSkill" | "idleLookUrgency"> {
  const find = (name: string | undefined) => skills.find((s) => s.name === name);
  const scan = createScan();
  let sounds = new Set<string>();
  let before: { health: number; rewardAt: number } | null = null;
  return {
    percepts(ws) {
      const data = minecraftDataOf(ws.state);
      if (!data) return [];
      const heard = new Set<string>();
      const percepts = perceptsOf(data, (key) => (heard.add(key), !sounds.has(key)));
      sounds = heard;
      return percepts;
    },
    asleep,
    busy(ws) {
      const running = ws.current?.skill;
      if (running === undefined) return null;
      if (REFLEX_SKILLS.includes(running) || running === "steady") return "reflex";
      return find(running)?.demanding ? "demanding" : null;
    },
    // Hurt, or rewarded, since the last tick: whatever is attended was worth the look.
    eventful(ws) {
      const data = minecraftDataOf(ws.state);
      if (!data) return false;
      const reward = ws.signals[REWARD_SIGNAL];
      const now = { health: data.self.health, rewardAt: reward && reward.value > 0 ? reward.at : (before?.rewardAt ?? 0) };
      const followed = before !== null && (now.health < before.health || now.rewardAt !== before.rewardAt);
      before = now;
      return followed;
    },
    idle: (ws: Workspace) => ws.current === null || ws.current.skill === IDLE,
    // Beside a skill that uses no part of the body (idling) always; beside one that leaves the head free with `sameTime`.
    looksAlongside: (ws) => ws.current !== null && (usesNothing(find(ws.current.skill)) || (sameTime && headFree(find(ws.current.skill)))),
    scan(ws) {
      const data = minecraftDataOf(ws.state);
      // Travelling, the head looks where the body is going.
      return data && !data.self.locomotion.moving ? scan(data, ws.state.timestamp) : null;
    },
    lookSkill: "look_at",
    idleLookUrgency: TAKE_OVER_URGENCY,
  };
}
