import type { State, Workspace } from "@familiar/contracts";
import type { BrainstemMoment, StartleDetector, StartleHit } from "@familiar/region-brainstem";
import type { MinecraftStateData, Nearby, Sighted } from "../encode/state-data.js";
import { minecraftDataOf, sightedOf } from "./read-state.js";
import { CONTACT_DISTANCE, FAR_DISTANCE } from "./reflexes.js";

// What startles the player, and how strongly. Each detector reports a sudden event with an
// intensity from 0 to 1; the brainstem region sizes the startle from that and from the state the
// body is in. Add something that startles: write a detector here and add it to createPlayerStartles.
// Every number is a first guess to tune in play.

type Point = { x: number; y: number; z: number };
const MAX_HEALTH = 20;
/** How sudden each kind of sound is at its start: a bang is all at once, an ordinary sound is not. */
const ONSET: Record<string, number> = { explosion: 1, thunder: 1, shot: 0.8, door: 0.7, hurt: 0.6, sound: 0.5 };
/** Places are told apart this coarsely when getting used to a kind of event somewhere. */
const PLACE_BLOCKS = 8;
/** Seen coming: the source was attended, or in view and approaching, within this long; a place counts if it was this close. */
const FORESEEN = { ms: 2000, blocks: 3, approaching: 0.5 };
/**
 * Self-caused: within this long and this far of the bot's own action. (The spec says about 3
 * seconds; an explosive the bot lights goes off after 4, so the window is a little longer.)
 */
const OWN_ACTION = { ms: 4500, blocks: 8 };
/** Skills that act on a creature: the noise it makes then is the bot's own doing. */
const STRIKES = new Set(["attack", "hit"]);
const clamp = (n: number) => Math.min(1, Math.max(0, n));
const near = (a: Point, b: Point, blocks: number) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) <= blocks;
const cell = (p: Point) => `${Math.round(p.x / PLACE_BLOCKS)},${Math.round(p.z / PLACE_BLOCKS)}`;
const posId = (p: Point) => `pos:${p.x},${p.y},${p.z}`;

/** Roughly where a nearby thing is, from the bot's place, its heading and the thing's bearing and distance. */
export function roughPositionOf(data: MinecraftStateData, thing: Nearby & Partial<Sighted>): Point {
  const heading = ((data.self.gaze.yaw + sightedOf(thing).bearing.angle) * Math.PI) / 180;
  const { x, y, z } = data.self.position;
  return { x: Math.round(x - Math.sin(heading) * thing.dist), y, z: Math.round(z - Math.cos(heading) * thing.dist) };
}

/** Where the thing an id names is, as far as the state says. */
function whereIs(data: MinecraftStateData, id: string | undefined | null): Point | null {
  if (!id) return null;
  const at = /^pos:(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)$/.exec(id);
  if (at) return { x: Number(at[1]), y: Number(at[2]), z: Number(at[3]) };
  const thing = [...data.nearby.mobs, ...data.nearby.players, ...data.nearby.blocks].find((t) => t.id === id);
  if (thing) return roughPositionOf(data, thing);
  const sudden = data.nearby.sudden.find((s) => s.id === id);
  return sudden ? roughPositionOf(data, { id, type: "", dist: sudden.dist, bearing: sudden.bearing }) : null;
}

/**
 * Whether an event at `at` (or from the thing `source`) follows from something the bot just did:
 * it broke, placed, lit or opened something there, or it struck the thing that then made the
 * noise. Read from the skill events' `changes` and the running skill. Unsure counts as no.
 */
export function selfCaused(data: MinecraftStateData, ws: Workspace, at: Point | null, source: string | null = null): boolean {
  const now = ws.state.timestamp;
  const acted: (Point | null)[] = [];
  const targets: (string | undefined)[] = [];
  const strike = (skill: string, target: string | undefined) => {
    if (!STRIKES.has(skill)) return;
    targets.push(target);
    // With no target named, a strike goes for the nearest creature.
    const struck = target ?? [...data.nearby.mobs].sort((a, b) => a.dist - b.dist)[0]?.id;
    acted.push(whereIs(data, struck));
  };
  for (const event of ws.recentEvents) {
    if (now - event.timestamp > OWN_ACTION.ms) continue;
    const where = event.changes?.targetAt;
    if (typeof where === "string") acted.push(whereIs(data, `pos:${where}`));
    strike(event.skill, event.target);
  }
  if (ws.current) strike(ws.current.skill, ws.current.target);
  if (source !== null && targets.includes(source)) return true;
  return at !== null && acted.some((spot) => spot !== null && near(spot, at, OWN_ACTION.blocks));
}

/** Remembers, for 2 seconds, what the bot was attending to and what it saw coming. One per bot. */
function createForesight() {
  let seen: { id: string; at: Point | null; when: number }[] = [];
  return {
    note(data: MinecraftStateData, ws: Workspace): void {
      const when = ws.state.timestamp;
      seen = seen.filter((s) => when - s.when <= FORESEEN.ms);
      if (ws.attended) seen.push({ id: ws.attended.id, at: whereIs(data, ws.attended.id), when });
      for (const thing of [...data.nearby.mobs, ...data.nearby.players]) {
        const sight = sightedOf(thing);
        if (sight.seen && sight.closing >= FORESEEN.approaching) seen.push({ id: thing.id, at: roughPositionOf(data, thing), when });
      }
    },
    /** 1 if the thing, or something where the event happened, was attended or seen approaching lately; else 0. */
    of(id: string | null, at: Point | null, now: number): number {
      return seen.some((s) => now - s.when <= FORESEEN.ms && ((id !== null && s.id === id) || (at !== null && s.at !== null && near(s.at, at, FORESEEN.blocks)))) ? 1 : 0;
    },
  };
}

const hostilesInView = (d: MinecraftStateData) => d.nearby.mobs.filter((m) => m.hostile && m.dist <= FAR_DISTANCE);
/** The hurt that happened since `before`, with how much health it cost (at least 1), or null. */
function freshHurt(a: MinecraftStateData, b: MinecraftStateData) {
  const hurt = b.self.lastHurt;
  const fresh = hurt !== null && (a.self.lastHurt === null || hurt.msAgo < a.self.lastHurt.msAgo);
  return fresh ? { ...hurt, lost: Math.max(1, a.self.health - b.self.health) } : null;
}
/** How strong a hurt is, from the share of health it cost: a third of full health at once is as strong as it gets. */
const hurtIntensity = (lost: number, least: number) => least + (1 - least) * clamp(lost / (MAX_HEALTH / 3));

/**
 * Everything that startles the player. The detectors share a short memory of what the bot saw
 * coming, so make one set per bot.
 */
export function createPlayerStartles(): StartleDetector[] {
  const foresight = createForesight();
  let noted: State | null = null;
  const detector = (name: string, check: (a: MinecraftStateData, b: MinecraftStateData, ws: Workspace, now: number) => StartleHit | null): StartleDetector => ({
    name,
    check({ before, after, ws }: BrainstemMoment) {
      const [a, b] = [minecraftDataOf(before), minecraftDataOf(after)];
      if (!a || !b) return null;
      const hit = check(a, b, ws, after.timestamp);
      // What was attended and seen approaching up to the last tick is what counts as "saw it coming".
      if (noted !== after && name === LAST) {
        noted = after;
        foresight.note(b, ws);
      }
      return hit;
    },
  });

  /** Something loud close by. The source is where the sound came from, so the bot faces it. */
  const loud = detector("loud_nearby", (a, b, ws, now) => {
    const key = (h: MinecraftStateData["nearby"]["heard"][number]) => `${h.type} ${posId(h.position)}`;
    const old = new Set(a.nearby.heard.map(key));
    const fresh = b.nearby.heard.filter((h) => h.type !== "presence" && !old.has(key(h))).sort((x, y) => y.loudness * (ONSET[y.type] ?? 0.5) - x.loudness * (ONSET[x.type] ?? 0.5))[0];
    if (!fresh) return null;
    const id = posId(fresh.position);
    return { source: { id, kind: fresh.type }, intensity: clamp(fresh.loudness * (ONSET[fresh.type] ?? 0.5)), kind: fresh.type, place: cell(fresh.position), foreseen: foresight.of(null, fresh.position, now), selfCaused: selfCaused(b, ws, fresh.position), msAgo: fresh.msAgo ?? 0 };
  });

  /** A hostile first seen already on top of the bot: stronger the nearer it is and the faster it came. */
  const upClose = detector("hostile_up_close", (a, b, _ws, now) => {
    const known = new Set(a.nearby.mobs.map((m) => m.id));
    const mob = hostilesInView(b).find((m) => m.dist <= CONTACT_DISTANCE && !known.has(m.id));
    if (!mob) return null;
    const sudden = b.nearby.sudden.some((s) => s.id === mob.id) || sightedOf(mob).closing >= 2;
    const at = roughPositionOf(b, mob);
    return { source: { id: mob.id, kind: mob.type }, intensity: (0.6 + 0.4 * (1 - mob.dist / CONTACT_DISTANCE)) * (sudden ? 1 : 0.85), kind: mob.type, place: cell(at), foreseen: foresight.of(mob.id, at, now), cause: "hostile_appeared" };
  });

  /** Hit by something while no threat was in view: stronger the more health it cost. */
  const hurtUnseen = detector("hurt_unseen", (a, b, _ws, now) => {
    const hurt = freshHurt(a, b);
    if (!hurt || hurt.by === null || hostilesInView(a).length > 0) return null;
    const by = [...b.nearby.mobs, ...b.nearby.players].find((t) => t.id === hurt.by);
    return { source: by ? { id: by.id, kind: by.type } : null, intensity: hurtIntensity(hurt.lost, 0.4), kind: `hit by ${by?.type ?? "something"}`, foreseen: foresight.of(hurt.by, null, now), cause: "damage", msAgo: hurt.msAgo };
  });

  /**
   * Damage with no attacker (a fall landing, first contact with something that hurts, a hunger
   * or fire tick). Nothing is special-cased: a small hurt that keeps repeating startles the first
   * time at most, and after that the body is used to it.
   */
  const unexpectedDamage = detector("unexpected_damage", (a, b) => {
    const hurt = freshHurt(a, b);
    if (!hurt || hurt.by !== null) return null;
    return { source: null, intensity: hurtIntensity(hurt.lost, 0.15), kind: `hurt:${hurt.kind ?? "unknown"}`, cause: "damage", msAgo: hurt.msAgo };
  });

  /** Something has just started coming at the bot fast: a projectile heading its way, or a thing closing at speed. */
  const looming = detector(LAST, (a, b, _ws, now) => {
    const was = new Set(a.nearby.sudden.filter((s) => s.what === "looming").map((s) => s.id));
    const coming = b.nearby.sudden.find((s) => s.what === "looming" && !was.has(s.id));
    if (!coming) return null;
    const thing = [...b.nearby.mobs, ...b.nearby.players].find((t) => t.id === coming.id);
    const at = whereIs(b, coming.id);
    // A projectile is at full speed from the start; a creature counts by how fast it is closing (4 blocks a second: 0.5; 8: 1).
    const intensity = thing ? clamp(0.5 + (0.5 * (sightedOf(thing).closing - 4)) / 4) : 0.8;
    return { source: { id: coming.id, kind: thing?.type ?? "unknown" }, intensity, kind: "looming", ...(at ? { place: cell(at) } : {}), foreseen: foresight.of(coming.id, null, now), cause: "looming" };
  });

  return [upClose, hurtUnseen, unexpectedDamage, loud, looming];
}
/** The detector listed last: the tick's memory is updated after it has run. */
const LAST = "looming";

/** How dark it is here and whether this place is remembered as bad, each 0 to 1: both make a startle bigger. */
export function startleSurroundings(state: State): { dark: number; badPlace: number } {
  const data = minecraftDataOf(state);
  if (!data) return { dark: 0, badPlace: 0 };
  return { dark: clamp(1 - data.time.lightLevel / 15), badPlace: data.memory?.nearby === "bad" ? 1 : 0 };
}
