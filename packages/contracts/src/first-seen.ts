/** The first time a hostile mob showed up in the encoded state. */
export interface FirstSeen {
  /** Target id, e.g. "entity:42". */
  mobId: string;
  type: string;
  dist: number;
  /** Timestamp of the state it first appeared in. */
  timestamp: number;
}
