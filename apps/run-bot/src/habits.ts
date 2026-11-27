import type { Skill, Workspace } from "@familiar/contracts";
import { createStriatum, type Habits, type SelectionSettings, type Striatum } from "@familiar/basal-ganglia";
import { situationOf, surprised, thingsInView } from "@familiar/minecraft";
import { aimAt, BAD_SURPRISE_SIGNAL } from "@familiar/neuromodulators";
import { ORIENTING_SIGNAL, THREAT_SIGNAL } from "@familiar/region-brainstem";
import { LARGE_MISMATCH, MISMATCH_SIGNAL } from "@familiar/region-cerebellum";

/** A threat this pressing ("seen") or worse is no moment for a habit. */
const THREAT_SEEN = 0.5;
/** Something that stood out this strongly is no moment for a habit. */
const STRIKING = 0.5;
/** A run that paid this much less than expected is a bad surprise. */
const BAD_SURPRISE = 0.2;

/**
 * The player's striatum: habits by the scorebook's situation, aimed the way the scorebook files
 * things (this chest, or any cow), and never used while something notable is going on.
 */
export function createPlayerStriatum<Ctx>(parts: { habits: Habits; selection: SelectionSettings; skills: readonly Skill<Ctx>[]; log?: (line: string) => void; /** How far a movement that went wrong counts as notable (the cerebellum's `mismatch` strength). Default: 0. */ mismatch?: number }): Striatum {
  const level = (ws: Workspace, signal: string, otherwise = 0) => ws.signals[signal]?.value ?? otherwise;
  const risky = new Set(parts.skills.filter((s) => s.risky).map((s) => s.name));
  // Whether the bot's predictions hold, read the way focus reads it (the focus level itself is also up in an unfamiliar place, which is no reason to drop a habit).
  const failing = surprised();
  return createStriatum({
    habits: parts.habits,
    strength: parts.selection.habits,
    blind: parts.selection.habit.blind,
    situationOf: (ws) => situationOf(ws.state),
    // A thing that stays put is remembered as itself; one that moves, as its kind; anything else as the target it is.
    aimOf(target, ws) {
      const seen = thingsInView(ws.state).find((t) => t.id === target);
      const aim = seen && aimAt(seen);
      return aim ? (aim.id ? `id:${aim.id}` : `kind:${aim.kind}`) : `=${target}`;
    },
    targetFor(aim, ws) {
      if (!aim.startsWith("kind:")) return aim.startsWith("id:") ? aim.slice(3) : aim.slice(1);
      return thingsInView(ws.state).find((t) => t.kind === aim.slice(5))?.id ?? null;
    },
    risky: (skill) => risky.has(skill),
    notable(ws) {
      const notHolding = failing.read(ws, ws.state.timestamp) > 0;
      if (ws.needs?.readings.some((r) => r.kind === "safety" && r.pressing > 0)) return "a safety need presses";
      if (level(ws, THREAT_SIGNAL) >= THREAT_SEEN) return "a threat is in view";
      if (level(ws, ORIENTING_SIGNAL) >= STRIKING) return "something striking just happened";
      // A movement just came out far from what the cerebellum predicted: the habit gives way to a fresh look.
      if ((parts.mismatch ?? 0) * level(ws, MISMATCH_SIGNAL) >= LARGE_MISMATCH) return "a movement went wrong";
      if (notHolding) return "predictions are not holding";
      return null;
    },
    topDrive: (ws) => ws.needs?.top?.name ?? null,
    badSurprise: (ws) => level(ws, BAD_SURPRISE_SIGNAL) > BAD_SURPRISE,
    ...(parts.log ? { onNote: parts.log } : {}),
  });
}
