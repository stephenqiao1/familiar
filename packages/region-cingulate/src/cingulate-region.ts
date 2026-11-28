import type { Region, Workspace } from "@familiar/contracts";
import { createChangeable } from "./changeable.js";
import { budgetSpent, chanceOf, controlOf, costOf, stakeOf, verdictOf, type Chance, type Stake } from "./control.js";
import { createInward, INWARD_SIGNAL, inwardNow } from "./inward.js";
import { createLeave, type Progress } from "./leave.js";
import type { CingulateSettings } from "./settings.js";
import { createTrouble, type Sign } from "./trouble.js";

/** One source of trouble: its name, and its reading now (a strength, or a strength and what it concerns). To add one, add an entry where the region is built. */
export interface Source {
  name: string;
  read(ws: Workspace): number | { strength: number; about?: readonly string[] };
}

export interface CingulateOptions {
  settings: CingulateSettings;
  /** Every source of trouble but slow progress, which the region works out itself. */
  sources: Source[];
  /** How much is riding on it. */
  stake(ws: Workspace): Stake;
  /** How likely more thought is to help. */
  chance(ws: Workspace): Chance;
  /** Thinking spent in the last minute, in calls. */
  calls(now: number): number;
  tired?(ws: Workspace): number;
  stress?(ws: Workspace): number;
  /** Mood, -1 to 1. Default: even. */
  mood?(ws: Workspace): number;
  /** The body is in quiet rest (drowsy, safe and still for a while). Default: never, so it never looks inward. */
  quiet?(ws: Workspace): boolean;
  /** What is running, as a name for the activity; null for nothing, or for rest. */
  activity(ws: Workspace): string | null;
  /** The progress made since the last tick: reward, steps finished, ground covered. */
  progress(ws: Workspace): Progress;
  /** Each source of surprise and its level now, for how changeable things are. */
  surprises(ws: Workspace): Record<string, number>;
  /** What happens today without the cingulate, for the shadow trace (is the planner woken, are the deciders hurried). Default: not traced. */
  today?(ws: Workspace): Record<string, unknown>;
  /** What each reader took from this tick's reading, for the trace (a reader at strength 0 is left out). Default: not traced. */
  readBy?(ws: Workspace): Record<string, unknown>;
  /** Default: "cingulate". */
  name?: string;
  /** Default: 0 (runs inside every tick). */
  layer?: number;
}

/** The planner would be woken for control above this, when the verdict is to try harder. */
export const WAKE_ABOVE = 0.7;
/** And no more often than this. */
export const WAKE_GAP_MS = 5000;
export const SLOW_PROGRESS = "slow progress";

/**
 * The cingulate: gathers every sign of trouble into one reading and decides whether more effort
 * is worth it. Each tick it works out
 *   - `trouble`: the sources gathered, one event counted once (trouble.ts);
 *   - `control` = trouble × stake × chance − cost, and a verdict: try harder, carry on or leave it (control.ts);
 *   - `leave`: whether what is running is paying worse than things have in general (leave.ts);
 *   - `changeable`: whether surprises are coming more often than usual (changeable.ts);
 *   - `inward`: at quiet rest with next to no trouble and nothing to try harder at or leave (inward.ts), shared as a signal;
 * and writes them to the workspace as data (`ws.trouble`). It proposes no action and calls no model.
 * Its trace also says what it would do with each reading (`would`), beside what happens today.
 */
export function createCingulateRegion(options: CingulateOptions): Region {
  const { settings, name = "cingulate", layer = 0 } = options;
  const [trouble, leaving, changing, looking] = [createTrouble(), createLeave(), createChangeable(), createInward()];
  let troubledSince: number | null = null;
  let wokeAt = -Infinity;
  return {
    name,
    layer,
    everyMs: 0,
    run(ws) {
      if (!(settings.gather > 0)) {
        ws.setTrouble(null);
        return { proposals: [] };
      }
      const now = ws.state.timestamp;
      const activity = options.activity(ws);
      const stay = leaving.tick(activity, options.progress(ws), now);
      const leave = settings.leave * stay.leave;
      const signs: Sign[] = options.sources.map((source) => {
        const read = source.read(ws);
        return typeof read === "number" ? { name: source.name, strength: read } : { name: source.name, strength: read.strength, ...(read.about ? { about: read.about } : {}) };
      });
      const gathered = trouble.tick([...signs, { name: SLOW_PROGRESS, strength: leave, about: activity ? [activity] : [] }].map((s) => ({ ...s, strength: settings.gather * s.strength })), now);
      troubledSince = gathered.level >= 0.4 ? (troubledSince ?? now) : null;

      const [stakes, chances] = [options.stake(ws), options.chance(ws)];
      const spent = { calls: options.calls(now), budget: settings.callBudget, tired: options.tired?.(ws) ?? 0, stress: options.stress?.(ws) ?? 0 };
      const [stake, chance, cost] = [stakeOf(stakes, options.mood?.(ws) ?? 0, settings.mood), chanceOf(chances), costOf(spent)];
      const control = settings.control * controlOf(gathered.level, stake, chance, cost);
      const { verdict, why } = verdictOf({ control, trouble: gathered.level, leave, spent: budgetSpent(spent), troubledMs: troubledSince === null ? 0 : now - troubledSince });
      const change = changing.tick(options.surprises(ws), now);
      const changeable = settings.changeable * change.changeable;
      // Looking inward ends on the tick trouble rises: it is worked out afresh from this tick's reading.
      const inward = settings.inward > 0 ? looking.tick(inwardNow({ quiet: options.quiet?.(ws) ?? false, trouble: gathered.level, verdict }), now) : null;
      if (settings.inward > 0) ws.setSignal(INWARD_SIGNAL, inward === null ? 0 : 1);
      const reading = { level: gathered.level, events: gathered.events, control, verdict, leave, changeable, ...(inward === null ? {} : { inward }) };
      ws.setTrouble(reading);
      // Asked after the reading is written, so it is this tick's reading the readers are asked about.
      const readBy = options.readBy?.({ ...ws, trouble: reading });

      // What it would do with this, were anything reading it.
      const wake = verdict === "try harder" && control > WAKE_ABOVE && now - wokeAt >= WAKE_GAP_MS;
      if (wake) wokeAt = now;
      const would = { wakePlanner: wake, hurryDeciders: control >= 0.5, giveUp: verdict === "leave it" };
      return {
        proposals: [],
        trace: {
          trouble: { level: round(gathered.level), events: gathered.events.map((e) => ({ ...e, strength: round(e.strength) })) },
          stake: round(stake),
          chance: round(chance),
          cost: round(cost),
          control: round(control),
          verdict,
          ...(why ? { why } : {}),
          calls: spent.calls,
          leave: { level: round(leave), current: round(stay.current), background: round(stay.background) },
          changeable: { level: round(changeable), recent: round(change.recent), usual: round(change.usual) },
          ...(inward === null ? {} : { inward: { since: inward } }),
          would,
          ...(options.today ? { today: options.today(ws) } : {}),
          ...(readBy ? { readBy } : {}),
        },
      };
    },
  };
}

const round = (n: number) => Math.round(n * 1000) / 1000;
