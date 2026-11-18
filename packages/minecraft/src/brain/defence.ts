import type { State, Workspace } from "@familiar/contracts";
import { DEFENCE_RULES, RECOVERING_SIGNAL, THREAT_LEVEL, type BrainstemOptions, type Choice, type Mode } from "@familiar/region-brainstem";
import type { ReflexRule } from "@familiar/region-reflex";
import { cheapDefence } from "../defence/assess.js";
import type { ThreatView } from "../defence/size-up.js";
import type { Defence, MinecraftStateData } from "../encode/state-data.js";
import { minecraftDataOf } from "./read-state.js";

// The defence circuit, read from the state: the three defence reflexes (one fires, whichever
// the chosen mode calls for), resting to recover afterwards, and what alarm and the brainstem
// need to know about the threat. The choosing itself is in region-brainstem's defence.ts; the
// sizing up of each threat in ../defence.
// Add a defence: give the chooser a new mode, then a rule here and a skill for it.

/** The soft reflexes that defend the bot (a death while one was overruled is logged). */
export const DEFENCE_REFLEXES: string[] = Object.values(DEFENCE_RULES);
/** The skill each defence runs. */
export const DEFENCE_SKILL = { freeze: "freeze", flee: "flee", fight: "attack" } as const;
/** Resting to recover starts from this urgency, and stops once health is back to this. */
export const RECUPERATE = { name: "recuperate", base: 0.4, untilHealth: 15 };

const worked = new WeakMap<MinecraftStateData, Defence>();

/** The state's defence reading: the threat sense's if it made one, else the cheap rules' (worked out once per state). */
export function defenceOf(data: MinecraftStateData): Defence {
  if (data.defence) return data.defence;
  if (!worked.has(data)) worked.set(data, cheapDefence(data));
  return worked.get(data)!;
}

/** How pressing the danger is this very tick: 0 none, 0.3 possible, 0.5 seen, 0.8 coming, 1 on it. */
export function threatLevel(state: State): number {
  const data = minecraftDataOf(state);
  return data ? defenceOf(data).choice.threat : 0;
}

/** A threat on the bot right now (within reach of it, or having just hurt it), or null. */
export function onIt(data: MinecraftStateData): ThreatView | null {
  return defenceOf(data).threats.find((t) => t.stage === "on_it") ?? null;
}

/**
 * The nearest threat that raises and holds alarm: one that can get to the bot (or hit it from
 * where it is) and is coming or on it. One that cannot reach the bot does not count, however
 * near; nor does one that has not noticed the bot (that is what freezing and routing round are
 * for, and they are done calmly).
 */
export function pressingThreat(data: MinecraftStateData): ThreatView | null {
  return defenceOf(data).threats.find((t) => t.canReach && THREAT_LEVEL[t.stage] >= THREAT_LEVEL.coming) ?? null;
}

/** The reflex for one mode: fires when the defence chosen for this state is that mode. */
function defenceRule(mode: keyof typeof DEFENCE_RULES): ReflexRule {
  return {
    name: DEFENCE_RULES[mode],
    kind: "soft",
    check(ws) {
      const data = minecraftDataOf(ws.state);
      const choice = data && defenceOf(data).choice;
      if (!choice || choice.mode !== mode || choice.target === null) return null;
      return { action: { skill: DEFENCE_SKILL[mode], target: choice.target }, urgency: choice.base, reason: choice.why };
    },
  };
}

/**
 * Resting after a fight or flight: the brainstem shares `recovering` while the body is badly
 * hurt and nothing is coming; this goes somewhere safer and stays still until it has mended.
 */
function recuperateRule(strength: number): ReflexRule {
  return {
    name: RECUPERATE.name,
    kind: "soft",
    check(ws) {
      const data = minecraftDataOf(ws.state);
      if (!data || (ws.signals[RECOVERING_SIGNAL]?.value ?? 0) <= 0) return null;
      const { choice } = defenceOf(data);
      if (choice.threat >= THREAT_LEVEL.coming || data.self.health >= RECUPERATE.untilHealth) return null;
      return { action: { skill: RECUPERATE.name }, urgency: RECUPERATE.base * strength, reason: `health ${data.self.health}/20 after defending, nothing coming: resting` };
    },
  };
}

/** The defence reflexes for a bot: freeze, flee, fight, and (with `recuperate` above 0) resting to recover. */
export function defenceReflexes(strengths: { recuperate: number } = { recuperate: 1 }): ReflexRule[] {
  return [defenceRule("fight"), defenceRule("flee"), defenceRule("freeze"), ...(strengths.recuperate > 0 ? [recuperateRule(strengths.recuperate)] : [])];
}

/** What the brainstem region needs to share the defence signals and log the defence. */
export const playerDefence: NonNullable<BrainstemOptions["defence"]> = (state) => {
  const data = minecraftDataOf(state);
  if (!data) return null;
  const { choice, threats, possible, costMs, worstMs, learned } = defenceOf(data);
  const notes = { ...(possible ? { possible } : {}), ...(costMs === undefined ? {} : { costMs, worstMs }), ...(learned?.length ? { learned } : {}) };
  return { choice, threats, ...(Object.keys(notes).length ? { notes } : {}) };
};

/** The mode chosen for a state (for the defence watch). */
export function defenceMoment(state: State): { mode: Mode; why: string; threat: ThreatView | null; choice: Choice } | null {
  const data = minecraftDataOf(state);
  if (!data) return null;
  const { choice, threats } = defenceOf(data);
  return { mode: choice.mode, why: choice.why, threat: threats.find((t) => t.id === choice.target) ?? null, choice };
}

/** Whether the state's most pressing threat leaves the bot no way out. */
export function corneredIn(ws: Workspace): boolean {
  const data = minecraftDataOf(ws.state);
  return data !== null && defenceOf(data).choice.cornered;
}
