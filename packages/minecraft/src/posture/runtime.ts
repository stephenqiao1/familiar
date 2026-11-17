// Each bot's posture at run time: its switches, and a note of what the posture system did since
// the brain last looked (refusals, stance holds, falls, things learned), for the tick's trace.

/** One action the check refused. */
export interface Refusal {
  action: string;
  at: string;
  reason: string;
}

/** One fall, noted on landing. */
export interface Fall {
  blocks: number;
  damage: number;
  /** Whether the body steered for a better landing on the way down. */
  steered: boolean;
  onto: string;
  /** With no better landing in reach there was nothing to do. */
  note?: string;
}

/** What happened since the notes were last taken. Only what happened is listed. */
export interface PostureNotes {
  refusals?: Refusal[];
  /** An action refused at the same place three times in a minute: the layer above is not learning from the failure. */
  repeated?: Refusal[];
  /** Actions during which sneak was held to keep steady. */
  stance?: string[];
  falls?: Fall[];
  learned?: string[];
  displaced?: string[];
  /** The slowest check so far, in ms (it should stay under 2). */
  worstCheckMs?: number;
}

export interface PostureSwitches {
  /** Check before acting. 0 is for experiments. */
  check: number;
  /** Hold sneak near an edge or something that hurts while the hands are busy. */
  stance: number;
}

export interface PostureRuntime extends PostureSwitches {
  log(msg: string): void;
  refused(refusal: Refusal, now: number): void;
  timed(ms: number): void;
  note(kind: "stance" | "learned" | "displaced", text: string): void;
  fell(fall: Fall): void;
  /** The last fall noted, for the skill that was steering. */
  lastFall(): Fall | null;
  /** Takes the notes, leaving none. */
  take(): PostureNotes;
}

/** The check should stay under this. */
export const CHECK_LIMIT_MS = 2;
/** The same refusal this many times within this long is worth a clear log line. */
const REPEATED = { times: 3, withinMs: 60_000 };

export function createPostureRuntime(switches: PostureSwitches = { check: 1, stance: 1 }, log: (msg: string) => void = () => {}): PostureRuntime {
  let notes: PostureNotes = {};
  let worst = 0;
  let last: Fall | null = null;
  const seen = new Map<string, number[]>();
  return {
    ...switches,
    log,
    refused(refusal, now) {
      (notes.refusals ??= []).push(refusal);
      const key = `${refusal.action}@${refusal.at}`;
      const times = [...(seen.get(key) ?? []).filter((at) => now - at <= REPEATED.withinMs), now];
      seen.set(key, times);
      if (times.length !== REPEATED.times) return;
      (notes.repeated ??= []).push(refusal);
      log(`posture: REFUSED ${refusal.action} at ${refusal.at} three times in a minute (${refusal.reason}): the layer above is not learning from the failure`);
    },
    timed(ms) {
      if (ms <= worst) return;
      worst = ms;
      notes.worstCheckMs = Math.round(ms * 1000) / 1000;
      if (ms > CHECK_LIMIT_MS) log(`posture: a check took ${ms.toFixed(2)} ms (it should stay under ${CHECK_LIMIT_MS})`);
    },
    note(kind, text) {
      notes[kind] = [...(notes[kind] ?? []), text];
    },
    fell(fall) {
      last = fall;
      (notes.falls ??= []).push(fall);
    },
    lastFall: () => last,
    take() {
      const out = notes;
      notes = {};
      return out;
    },
  };
}

const runtimes = new WeakMap<object, PostureRuntime>();

/** Gives a bot its posture switches and log. Without this a bot checks and holds stance with nothing logged. */
export function installPosture(bot: object, switches: PostureSwitches, log: (msg: string) => void): PostureRuntime {
  const runtime = createPostureRuntime(switches, log);
  runtimes.set(bot, runtime);
  return runtime;
}

/** A bot's posture at run time (everything on, by default). */
export function postureOf(bot: object): PostureRuntime {
  let runtime = runtimes.get(bot);
  if (!runtime) runtimes.set(bot, (runtime = createPostureRuntime()));
  return runtime;
}
