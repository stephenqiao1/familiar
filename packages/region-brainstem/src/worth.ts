import type { Workspace } from "@familiar/contracts";

// "Did anything follow?": whether a thing was worth the look. A thing that was is not got used
// to. The reasons: the body was hurt or rewarded, a skill was started that targets the thing, a
// need moved by a noticeable amount, or the defence circuit changed mode because of it.

/** A need whose level moved at least this far counts as having moved. */
export const NEED_MOVED = 0.1;
/** What follows up to this long after the look ended still counts. */
export const FOLLOWS_WITHIN_MS = 2000;

/** How things stood when the look began. */
export interface Before {
  needs: Record<string, number>;
  mode: string | null;
  skill: { name: string; startedAt: number } | null;
}

export interface DefenceNow {
  mode: string;
  /** The thing the mode is about, or null. */
  target: string | null;
}

export function standing(ws: Workspace, defence: DefenceNow | null): Before {
  return {
    needs: Object.fromEntries((ws.needs?.readings ?? []).map((r) => [r.name, r.level])),
    mode: defence?.mode ?? null,
    skill: ws.current ? { name: ws.current.skill, startedAt: ws.current.startedAt } : null,
  };
}

/** Why the thing `id` was worth the look, given how things stood when the look began, or null. `lookSkill` is the look itself, which does not count. */
export function whyWorth(before: Before, ws: Workspace, defence: DefenceNow | null, id: string, lookSkill: string): string | null {
  const running = ws.current;
  if (running && running.skill !== lookSkill && running.target === id && (before.skill?.name !== running.skill || before.skill.startedAt !== running.startedAt)) return `${running.skill} was started on it`;
  if (defence && defence.target === id && defence.mode !== before.mode) return `the defence went to ${defence.mode} because of it`;
  for (const r of ws.needs?.readings ?? []) {
    const was = before.needs[r.name];
    if (was !== undefined && Math.abs(r.level - was) >= NEED_MOVED) return `the need ${r.name} moved (${was.toFixed(2)} → ${r.level.toFixed(2)})`;
  }
  return null;
}
