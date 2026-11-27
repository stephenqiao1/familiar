import type { Workspace } from "@familiar/contracts";
import type { MemoryTrigger } from "@familiar/memory";
import type { Surprise } from "@familiar/region-sensory";

/**
 * The hippocampus's reader of the sensory area: a strong surprise is kept as a discovery, once
 * (the same surprise is reported for a few seconds). `strong` gives the strong surprise standing
 * now, if any.
 */
export function surpriseKept(strong: (ws: Workspace) => Surprise | null): MemoryTrigger {
  let kept: string | null = null;
  return {
    name: "surprise",
    check({ ws }) {
      const surprise = strong(ws);
      const key = surprise && `${surprise.at} ${surprise.what} ${surprise.kind}`;
      if (!surprise || key === kept) return null;
      kept = key;
      const words = surprise.why.charAt(0).toUpperCase() + surprise.why.slice(1);
      return { kind: "discovery", summary: `Was surprised: ${words}`, involved: surprise.what === "expectation" ? [] : [surprise.kind], outcome: { feeling: "neutral", value: 0 } };
    },
  };
}
