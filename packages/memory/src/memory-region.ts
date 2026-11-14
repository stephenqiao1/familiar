import type { Region, SkillEvent, State, Workspace } from "@familiar/contracts";
import { STARTING_STRENGTH, type ConsolidationPhase, type MemoryEvent, type MemoryStore, type Place } from "./memory.js";

/** What a memory trigger looks at: the last tick's state, this tick's, the skill events in between, and the workspace. */
export interface MemoryMoment {
  before: State;
  after: State;
  events: readonly SkillEvent[];
  ws: Workspace;
}

/**
 * One kind of moment worth remembering. The region fills in the place: where the bot is now, or
 * where it was a tick ago for an event that moved it (`atPlaceBefore`, e.g. a death and respawn).
 */
export interface MemoryTrigger {
  name: string;
  check(moment: MemoryMoment): (Omit<MemoryEvent, "place"> & { atPlaceBefore?: boolean }) | null;
}

export interface MemoryRegionOptions {
  memory: MemoryStore;
  /** When to record. Add or remove one to change what the bot remembers. */
  triggers: MemoryTrigger[];
  /** Where the bot is, or null if unknown. */
  placeOf(state: State): Place | null;
  /** The alarm level right now (0 to 1). Default: always calm, so memories keep their starting strength. */
  alarmOf?(ws: Workspace): number;
  /**
   * Focus right now (0 to 1): how open the bot is to taking in something new. New memories start at
   * 0.15 + 0.3 × focus, and under 0.2 only important events are recorded. Default: always 0.5.
   */
  focusOf?(ws: Workspace): number;
  /** True while the bot is resting safely: memories are consolidated only then. Default: never. */
  resting?(ws: Workspace): boolean;
  /** How many agreeing memories a general fact needs. Default: 3. */
  factSupport?: number;
  /** Default: "hippocampus". */
  name?: string;
  /** Default: 0 (runs inside every tick). */
  layer?: number;
}

/** After recording, alarm is watched this long; its peak becomes the memory's strength. */
const TAG_WINDOW_MS = 60_000;
/** The strongest an alarm can stamp a memory. */
const MAX_TAGGED_STRENGTH = 0.8;
/** At very low focus only events at least this good or bad are recorded. */
const LOW_FOCUS = 0.2;
const IMPORTANT = 0.5;
/** Consolidation runs one phase per tick (a millisecond or so each), then waits this long before the next round. */
const PHASES: ConsolidationPhase[] = ["prune", "merge", "generalise"];
const ROUND_GAP_MS = 60_000;
/** Guardrail: warn when more than this share of known places carry a strong danger memory. */
const FEARFUL_SHARE = 1 / 3;

/**
 * The hippocampus: each tick it runs every memory trigger on what just happened and records what
 * fires. For a minute after, it watches the alarm: the memory's strength becomes the peak alarm in
 * that window (at most 0.8), so frightening moments are remembered longest and recalled first.
 * Focus sets how strongly new memories start. While the bot rests, and only then, it consolidates:
 * one phase per tick (prune, merge, generalise into facts), stopping the moment rest ends.
 * It never proposes an action. A trigger that throws is skipped and named in the trace.
 */
export function createMemoryRegion(options: MemoryRegionOptions): Region {
  const { memory, triggers, placeOf, alarmOf = () => 0, focusOf = () => 0.5, resting = () => false, factSupport, name = "hippocampus", layer = 0 } = options;
  let before: State | null = null;
  const seen = new WeakSet<SkillEvent>();
  let tagging: { id: string; start: number; until: number; peak: number }[] = [];
  let phase = 0;
  let nextRoundAt = -Infinity;

  return {
    name,
    layer,
    everyMs: 0,
    run(ws) {
      const after = ws.state;
      const now = after.timestamp;
      const events = ws.recentEvents.filter((e) => !seen.has(e));
      for (const e of events) seen.add(e);
      const moment = before && { before, after, events, ws };
      before = after;

      const alarm = alarmOf(ws);
      tagging = tagging.filter((t) => now <= t.until);
      for (const t of tagging) {
        t.peak = Math.max(t.peak, alarm);
        memory.tag(t.id, Math.min(MAX_TAGGED_STRENGTH, Math.max(t.start, t.peak)), now);
      }

      const recorded: { trigger: string; summary: string; strength: number; merged: boolean }[] = [];
      const errors: Record<string, string> = {};
      const place = placeOf(after);
      const focus = focusOf(ws);
      const start = STARTING_STRENGTH - 0.15 + 0.3 * focus;
      if (moment && place) {
        for (const trigger of triggers) {
          try {
            const fired = trigger.check(moment);
            if (!fired) continue;
            const { atPlaceBefore, ...event } = fired;
            // Barely taking anything in: only what really matters gets written.
            if (focus < LOW_FOCUS && Math.abs(event.outcome.value) < IMPORTANT) continue;
            const result = memory.record({ ...event, place: (atPlaceBefore ? placeOf(moment.before) : null) ?? place }, now, start);
            if (!result) continue;
            const strength = Math.min(MAX_TAGGED_STRENGTH, Math.max(result.memory.strength, alarm));
            memory.tag(result.memory.id, strength, now);
            if (!tagging.some((t) => t.id === result.memory.id)) tagging.push({ id: result.memory.id, start: result.memory.strength, until: now + TAG_WINDOW_MS, peak: alarm });
            recorded.push({ trigger: trigger.name, summary: result.memory.summary, strength, merged: result.merged });
          } catch (error) {
            errors[trigger.name] = error instanceof Error ? error.message : String(error);
          }
        }
      }

      // Consolidation: only at rest, one phase per tick, and never mid-round once rest ends.
      let consolidated: Record<string, unknown> | null = null;
      if (!resting(ws)) phase = 0;
      else if (now >= nextRoundAt) {
        const name = PHASES[phase]!;
        consolidated = { phase: name, changed: memory.consolidate(name, now, factSupport) };
        phase = (phase + 1) % PHASES.length;
        if (phase === 0) nextRoundAt = now + ROUND_GAP_MS;
      }

      const places = memory.knownPlaces(now).filter((p) => p.kind !== undefined);
      const fearful = places.filter((p) => p.kind === "danger" || p.kind === "death").length;
      const overRemembering = places.length >= 3 && fearful / places.length > FEARFUL_SHARE;
      return {
        proposals: [],
        trace: {
          ...(recorded.length ? { recorded } : {}),
          ...(consolidated ? { consolidation: consolidated } : {}),
          ...(overRemembering ? { warning: `${fearful} of ${places.length} remembered places are marked dangerous: the bot may be over-remembering threats` } : {}),
          ...(Object.keys(errors).length ? { errors } : {}),
        },
      };
    },
  };
}
