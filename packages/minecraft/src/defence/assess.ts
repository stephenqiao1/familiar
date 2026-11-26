import { chooseDefence, type DefenceStrengths } from "@familiar/region-brainstem";
import type { Defence, MinecraftStateData } from "../encode/state-data.js";
import { USUAL_NEVER_FIGHT } from "./settings.js";
import { FAR_DISTANCE, sizeUp, type ThreatFacts } from "./size-up.js";
import { MIDDLING } from "./threat-record.js";

// From the facts about each possible threat to the state's `defence`: every threat sized up,
// whether danger is possible with nothing seen, and the defence chosen. The threat sense feeds
// this the full facts; `cheapDefence` feeds it what a bare state can say.

const MAX_HEALTH = 20;
/** Light at or below this is dark enough for danger to be possible. */
const DARK = 7;
/** Sounds that make danger possible. */
const WORRYING = new Set(["presence", "hurt", "explosion", "shot"]);
/** While one of these runs, the legs are the defence's own: a journey under way is not one to route round a threat. */
const DEFENCE_SKILLS = new Set(["flee", "attack", "freeze", "recuperate"]);

export interface AssessOptions {
  bravery: number;
  /** freeze, cornered: see the chooser. flightDistance: how far danger and bravery move it. */
  strengths: DefenceStrengths & { flightDistance: number };
  /** The flight distance is this share of the usual right now (a desperate need lets a threat closer). Default: 1. */
  flightScale?: number;
  /** What the amygdala fears with nothing in view (a place, a sign), in words, or null for nothing. Left out: the bad memory near is used instead. */
  dread?: string | null;
}

export const USUAL: AssessOptions = { bravery: 0.5, strengths: { freeze: 1, cornered: 1, flightDistance: 1 } };

/** Why danger is possible although nothing threatening is in view, or null. */
export function possibleDanger(data: MinecraftStateData, unseen: boolean, dread?: string | null): string | null {
  if (unseen) return "something unseen is close";
  if (data.nearby.heard.some((h) => WORRYING.has(h.type))) return "something was heard";
  if (dread !== undefined ? dread !== null : data.memory?.nearby === "bad") return dread ?? `a bad memory here (${data.memory?.kind})`;
  return data.time.lightLevel <= DARK ? "it is dark" : null;
}

/**
 * Marks what is looming: a threat that is itself closing fast, and, for anything else coming
 * fast (a projectile), the nearest threat in view (most likely what sent it).
 */
export function withLooming(facts: ThreatFacts[], looming: ReadonlySet<string>): ThreatFacts[] {
  if (looming.size === 0) return facts;
  const own = new Set(facts.map((f) => f.id));
  const sender = [...looming].some((id) => !own.has(id)) ? facts.filter((f) => f.seen && f.dist <= FAR_DISTANCE).sort((a, b) => a.dist - b.dist)[0] : undefined;
  return facts.map((f) => (looming.has(f.id) || f === sender ? { ...f, looming: true } : f));
}

/** Sizes up every threat and chooses the defence. */
export function assessDefence(data: MinecraftStateData, facts: readonly ThreatFacts[], { bravery, strengths, flightScale = 1, dread }: AssessOptions = USUAL): Defence {
  const threats = facts.map((f) => sizeUp(f, bravery, strengths.flightDistance, flightScale)).sort((a, b) => a.dist - b.dist);
  const inSight = threats.filter((t) => t.stage !== "possible");
  const possible = inSight.length ? null : possibleDanger(data, threats.length > 0, dread);
  const { self, current } = data;
  const travelling = self.locomotion.moving && !DEFENCE_SKILLS.has(current?.skill ?? "");
  const choice = chooseDefence({ threats, possible, health: self.health / MAX_HEALTH, armed: self.bestWeapon !== null, travelling }, strengths);
  return { threats, possible, choice };
}

/**
 * The defence a bare state gives (one made without the threat sense): the game's hostile mobs
 * within 16 blocks, each of middling danger, with the cheap guess at reach, always a way out,
 * and the usual kinds not to fight. A mob the state says nothing about the movement of counts as
 * having noticed the bot.
 */
export function cheapDefence(data: MinecraftStateData, options: AssessOptions = USUAL): Defence {
  const hurt = data.self.lastHurt;
  const looming = new Set(data.nearby.sudden.filter((s) => s.what === "looming").map((s) => s.id));
  const facts = data.nearby.mobs
    .filter((m) => m.hostile && (m.dist <= FAR_DISTANCE || looming.has(m.id)))
    .map((m): ThreatFacts => ({
      id: m.id,
      kind: m.type,
      dist: m.dist,
      seen: m.seen ?? true,
      approach: m.closing === undefined ? 1 : m.closing,
      looming: false,
      facing: false,
      hurtMsAgo: hurt?.by === m.id ? hurt.msAgo : null,
      engaged: data.current?.skill === "attack" && data.current.target === m.id,
      canWalkTo: m.reachable,
      clearLine: m.reachable,
      shoots: false,
      escapable: true,
      danger: MIDDLING,
      beatable: !USUAL_NEVER_FIGHT.includes(m.type),
    }));
  return assessDefence(data, withLooming(facts, looming), options);
}
