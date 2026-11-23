import type { Bot } from "mineflayer";
import type { Vec3 } from "vec3";
import type { Defence, MinecraftStateData } from "../encode/state-data.js";
import { hasLineOfSight } from "../line-of-sight.js";
import type { Locomotion } from "../locomotion/index.js";
import type { Entity } from "../mc-types.js";
import { flightDistance } from "@familiar/region-brainstem";
import { assessDefence, withLooming } from "./assess.js";
import { createReachMemory } from "./reach-memory.js";
import { MAX_THREATS, type RouteChecks } from "./routes.js";
import type { DefenceSettings } from "./settings.js";
import { couldHarm, FAR_DISTANCE, type ThreatFacts } from "./size-up.js";
import type { ThreatRecord } from "./threat-record.js";

// The threat sense: each tick it sizes up everything near that might be a threat, using what
// the bot has learned about each kind and (for the nearest two) real route checks, and it feeds
// the record with what happens: who hurt the bot, what it killed, what it died to.

/** A creature is facing the bot when the bot is within this of straight ahead of it (cos 35°), for at least this long. */
const FACING = { cos: 0.82, heldMs: 1000 };
/** A creature not seen for this long has parted: the encounter is over. */
const PARTED_MS = 5000;
/** A kill is the bot's if it struck the creature this recently; a death is blamed on whoever hurt it this recently. */
const CREDIT_MS = 5000;
/** A creature the bot struck this recently is one it is fighting; one that noticed the bot this recently still has. */
const ENGAGED_MS = 5000;
const NOTICED_FOR_MS = 5000;
/** A flight is over at this many flight distances. */
const SAFE_FLIGHTS = 2;
/** A threat that has not noticed is routed round for this long after it was last seen there. */
const AVOID_MS = 3000;

export interface ThreatSenseOptions {
  settings: DefenceSettings;
  /** The bot's bravery, 0 to 1. */
  bravery: number;
  /** How far a desperate need shortens the flight distance right now (1: not at all). The hard reflexes do not use the flight distance. Default: never. */
  flightScale?(): number;
  record: ThreatRecord;
  /** The route checks. Default: none (the cheap guess at reach, and never cornered). */
  routes?: RouteChecks;
  /** For routing round a threat that has not noticed, and for knowing a journey is being planned. Default: neither. */
  locomotion?: Pick<Locomotion, "avoidArea" | "status">;
  log?: (msg: string) => void;
}

export interface ThreatSense {
  /** Sizes up this moment (called once per state). */
  assess(data: MinecraftStateData, now: number): Defence;
  /** The last assessment, or null before the first. */
  latest(): Defence | null;
  /** How far to get from this creature before it is safe: twice its flight distance. */
  safeDistance(entity: Entity): number;
  /** The worst tick so far, in ms. */
  worstMs(): number;
}

interface Met {
  kind: string;
  at: Vec3;
  when: number;
  approach: number;
  facingSince: number | null;
  lastSeen: number;
  damage: number;
  hurtAt: number | null;
  noticedAt: number | null;
  /** Fleeing from it was chosen without a break since this time, when it was this far off. */
  fleeing?: { since: number; from: number };
  /** Fleeing was not getting the bot away: it was this far off when that was found. Stands until the bot has made ground. */
  noWayOutAt?: number;
}

/** Fleeing that has left the threat nearer than when it began, after this long, is not working. */
const FLIGHT_FAILING = { afterMs: 1500, nearerBy: 0.5 };
/** Once fleeing is found not to work, there is no way out until the threat is this much further off. */
const GROUND_MADE = 2;

const idOf = (id: string) => Number(id.replace("entity:", ""));
const kindOf = (e: Entity) => (e.type === "player" ? `player:${e.username ?? "unknown"}` : (e.name ?? "unknown"));

export function createThreatSense(bot: Bot, options: ThreatSenseOptions): ThreatSense {
  const { settings, bravery, record, routes, locomotion } = options;
  const places = createReachMemory();
  const log = options.log ?? (() => {});
  const met = new Map<number, Met>();
  const struck = new Map<number, number>();
  const killed = new Set<number>();
  let latest: Defence | null = null;
  let worst = 0;
  let handledHurt = -Infinity;
  let health: number | null = null;
  let deaths: number | null = null;

  // Kills: a creature that dies just after the bot struck it. (Mineflayer has no event for the bot's own blows.)
  const attack = bot.attack.bind(bot);
  bot.attack = (entity, ...rest) => {
    struck.set(entity.id, Date.now());
    return attack(entity, ...rest);
  };
  bot.on("entityDead", (entity) => {
    if (Date.now() - (struck.get(entity.id) ?? -Infinity) > CREDIT_MS) return;
    killed.add(entity.id);
    record.killed(kindOf(entity));
  });

  const flightScale = () => Math.min(1, Math.max(0, options.flightScale?.() ?? 1));
  const flight = (kind: string) => flightScale() * flightDistance(record.danger(kind), bravery, settings.flightDistance);

  /** Whether the creature is turned toward the bot. */
  function facing(e: Entity): boolean {
    const yaw = (e as { headYaw?: number }).headYaw ?? e.yaw;
    const to = bot.entity.position.minus(e.position);
    const far = Math.hypot(to.x, to.z);
    if (!Number.isFinite(yaw) || far === 0) return false;
    return (-Math.sin(yaw) * to.x - Math.cos(yaw) * to.z) / far >= FACING.cos;
  }

  /** Feeds the record with who hurt the bot and what it died to since the last state. */
  function learnFromHarm(data: MinecraftStateData, now: number): void {
    const { self } = data;
    const had = health;
    const lost = had === null ? 0 : Math.max(0, had - self.health);
    const died = deaths !== null && self.deaths > deaths;
    health = self.health;
    deaths = self.deaths;
    const hurt = self.lastHurt;
    const hurtAt = hurt ? now - hurt.msAgo : null;
    // Only damage the game itself ties to a creature counts: a fall during a chase names no one.
    const by = hurt?.by ? bot.entities[idOf(hurt.by)] : undefined;
    if (hurt && hurtAt !== null && Math.abs(hurtAt - handledHurt) > 50 && by) {
      handledHurt = hurtAt;
      const kind = kindOf(by);
      // A blow that killed took whatever health was left.
      const amount = died ? (had ?? 1) : lost || 1;
      record.hurtBy(kind, amount, by.position.distanceTo(bot.entity.position), by.type !== "player" && isThreatening(by), now);
      const m = met.get(by.id);
      if (m) {
        m.damage += amount;
        m.hurtAt = hurtAt;
      } else met.set(by.id, { kind, at: by.position.clone(), when: now, approach: 0, facingSince: null, lastSeen: now, damage: amount, hurtAt, noticedAt: hurtAt });
    }
    if (died && hurt?.by && hurt.msAgo <= CREDIT_MS) record.diedTo(by ? kindOf(by) : (met.get(idOf(hurt.by))?.kind ?? "unknown"));
  }

  /** The game's own word on whether a creature is hostile (as the state's mobs carry it). */
  const hostileFlags = new Map<number, boolean>();
  const isThreatening = (e: Entity) => hostileFlags.get(e.id) ?? false;

  function assess(data: MinecraftStateData, now: number): Defence {
    const started = performance.now();
    for (const m of data.nearby.mobs) hostileFlags.set(idOf(m.id), m.hostile);
    learnFromHarm(data, now);
    const me = bot.entity.position;
    const looming = new Set(data.nearby.sudden.filter((s) => s.what === "looming").map((s) => s.id));
    const near = [...data.nearby.mobs.map((m) => ({ ...m, hostile: m.hostile })), ...data.nearby.players.map((p) => ({ ...p, hostile: false, reachable: true }))]
      .map((thing) => ({ thing, entity: bot.entities[idOf(thing.id)] }))
      .filter((n): n is { thing: (typeof n)["thing"]; entity: Entity } => n.entity !== undefined && record.isThreat(kindOf(n.entity), n.thing.hostile))
      .sort((a, b) => a.thing.dist - b.thing.dist);

    // The route checks, for the nearest two only, unless a journey is being planned right now.
    // Only threats near enough to matter are asked about.
    const nearest = near.filter((n) => n.thing.dist <= FAR_DISTANCE).slice(0, MAX_THREATS).map((n) => n.entity.id);
    const checking = routes !== undefined && settings.reachCheck > 0;
    if (checking) routes.work(nearest, now, locomotion?.status().moving ?? false);

    const remembered = new Map<string, Met>();
    const facts = near.map(({ thing, entity }): ThreatFacts => {
      const kind = kindOf(entity);
      const was = met.get(entity.id);
      if (!was) record.met(kind);
      const seconds = was ? (now - was.when) / 1000 : 0;
      // How fast it is itself coming at where the bot now stands (the bot's own steps do not count).
      const approach = was && seconds >= 0.1 ? (was.approach + (was.at.distanceTo(me) - entity.position.distanceTo(me)) / seconds) / 2 : (was?.approach ?? 0);
      const turned = facing(entity);
      const facingSince = turned ? (was?.facingSince ?? now) : null;
      // Is fleeing getting the bot away? Chosen without a break for a while and the threat is nearer
      // than when it began: no. That counts as no way out (whatever the route check says), so the
      // chooser stops fleeing and holds or fights, until the bot has made ground on it.
      const far = entity.position.distanceTo(me);
      const fled = latest?.choice.mode === "flee" && latest.choice.target === thing.id;
      const fleeing = fled ? (was?.fleeing ?? { since: now, from: far }) : undefined;
      const failing = fleeing !== undefined && now - fleeing.since >= FLIGHT_FAILING.afterMs && far <= fleeing.from - FLIGHT_FAILING.nearerBy;
      const noWayOutAt = was?.noWayOutAt !== undefined ? (far >= was.noWayOutAt + GROUND_MADE ? undefined : was.noWayOutAt) : failing ? far : undefined;
      const memory: Met = { kind, at: seconds >= 0.1 || !was ? entity.position.clone() : was.at, when: seconds >= 0.1 || !was ? now : was.when, approach, facingSince, lastSeen: now, damage: was?.damage ?? 0, hurtAt: was?.hurtAt ?? null, noticedAt: was?.noticedAt ?? null, ...(fleeing ? { fleeing } : {}), ...(noWayOutAt === undefined ? {} : { noWayOutAt }) };
      met.set(entity.id, memory);
      remembered.set(thing.id, memory);
      const shoots = record.shoots(kind);
      const asked = checking && nearest.includes(entity.id);
      // Whether it can walk here: the route check's answer (kept by place for the next time), else
      // what was found for these two places before, else the cheap guess while the check is working.
      const answer = asked ? routes.canReach(entity.id) : null;
      if (answer !== null) places.note(entity.position, me, answer);
      const walk = answer ?? places.recall(entity.position, me);
      return {
        id: thing.id,
        kind,
        dist: thing.dist,
        seen: thing.seen ?? true,
        approach,
        looming: false,
        facing: facingSince !== null && now - facingSince >= FACING.heldMs,
        hurtMsAgo: was?.hurtAt != null ? now - was.hurtAt : null,
        engaged: now - (struck.get(entity.id) ?? -Infinity) <= ENGAGED_MS,
        noticedLately: was?.noticedAt != null && now - was.noticedAt <= NOTICED_FOR_MS,
        canWalkTo: walk ?? thing.reachable,
        settling: walk === null && asked && routes.settling(entity.id, now),
        clearLine: shoots ? hasLineOfSight(bot, entity) : thing.reachable,
        shoots,
        escapable: settings.cornered <= 0 || (noWayOutAt === undefined && ((asked ? routes.escapable(entity.id) : null) ?? true)),
        danger: record.danger(kind),
        beatable: record.beatable(kind),
      };
    });

    // Encounters that are over: the creature is gone, or has not been near for a while.
    for (const [id, m] of met) {
      if (now - m.lastSeen <= PARTED_MS && bot.entities[id]) continue;
      record.parted(m.kind, m.damage, killed.has(id));
      met.delete(id);
      killed.delete(id);
      struck.delete(id);
      hostileFlags.delete(id);
    }

    const view = assessDefence(data, withLooming(facts, looming), { bravery, strengths: settings, flightScale: flightScale() });
    // Having noticed the bot is remembered for a few seconds: it does not lapse the moment the creature pauses.
    // One that was on the bot or coming at it counts the same: having just got clear of it, the bot
    // does not take it for unaware (and turn back past it) the moment it is out of arm's reach.
    for (const t of view.threats) if ((t.noticed && t.noticedBy !== "lately") || t.stage === "on_it" || t.stage === "coming") remembered.get(t.id)!.noticedAt = now;
    // A threat that has not noticed, and could harm the bot: journeys are routed round a circle of its flight distance.
    if (settings.avoid > 0 && locomotion) {
      for (const t of view.threats) {
        const at = bot.entities[idOf(t.id)]?.position;
        if (at && t.stage === "seen" && !t.noticed && couldHarm(t)) locomotion.avoidArea(t.id, at, t.flightDistance, AVOID_MS);
      }
    }
    const learned = record.justLearned();
    for (const note of learned) log(`defence: ${note}`);
    const costMs = Math.round((performance.now() - started) * 100) / 100;
    if (costMs > worst) worst = costMs;
    latest = { ...view, costMs, worstMs: worst, ...(learned.length ? { learned } : {}) };
    return latest;
  }

  return {
    assess,
    latest: () => latest,
    safeDistance: (entity) => SAFE_FLIGHTS * flight(kindOf(entity)),
    worstMs: () => worst,
  };
}
