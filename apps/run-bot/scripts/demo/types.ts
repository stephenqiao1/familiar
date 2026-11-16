import type { Stage } from "./stage.ts";

/** How a demo went. */
export interface Outcome {
  /** The limit showed itself in this run. */
  shown: boolean;
  /** The measured result, in one line. */
  result: string;
}

/** One live demonstration of one entry in docs/findings.md. */
export interface Demo {
  name: string;
  /** The heading of the entry in docs/findings.md that this shows. */
  finding: string;
  /** The words for the title on screen. */
  title: string;
  /** What to watch for, in one sentence. */
  watch: string;
  /** Where the viewer's camera starts: "x y z yaw pitch". */
  camera: string;
  /** Uses the whole brain (Jev), so it varies from run to run. */
  varies?: boolean;
  run(stage: Stage): Promise<Outcome>;
}

/** A camera over the south edge of the plaza, looking north and down at the middle of it. */
export const OVERVIEW = "60 166 58 180 42";
