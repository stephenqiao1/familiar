/** A snapshot of the world at one tick. Core never reads inside `data`. */
export interface State {
  schemaVersion: number;
  tick: number;
  timestamp: number;
  /** Filled by a game-specific encoder. Opaque to core. */
  data: Record<string, unknown>;
}
