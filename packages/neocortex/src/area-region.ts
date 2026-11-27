import type { Region, Workspace } from "@familiar/contracts";
import type { Area, Standing } from "./area.js";
import { feedbackFor } from "./ladder.js";

/** The every-tick half of a background area is a region named after it, with this on the end. */
const HOLD = "-hold";
/** The area a region belongs to (its own name, for anything but an area's every-tick half). */
export const areaOf = (region: string) => (region.endsWith(HOLD) ? region.slice(0, -HOLD.length) : region);

/**
 * An area as the regions the brain loop runs. An every-tick area is one region. A background
 * area is two: the area itself (slow), and before it a `<name>-hold` region that says what the
 * area holds again every tick. Each run reads the area's input and feedback, writes its `up`,
 * its feedback for the area below and its `ask` to `ws.cortex`, and traces the ports: `input`
 * (the view's name), `feedback` (what it was told), `up`, `action`, `ask`, and `down` (what it tells the area below).
 */
export function areaRegions(area: Area, ladder: readonly string[]): Region[] {
  const { name, layer, input } = area;
  const write = (ws: Workspace, standing: Standing, up: Record<string, unknown> | null) => {
    const ports = { up, feedback: standing.feedback ?? null, ask: standing.ask ?? [] };
    ws.setCortex(name, ports);
    return ports;
  };
  const region: Region = {
    name,
    layer,
    everyMs: area.everyMs,
    ...(area.timeoutMs === undefined ? {} : { timeoutMs: area.timeoutMs }),
    ...(area.dueNow ? { dueNow: (ws) => area.dueNow!(ws) } : {}),
    async run(ws, signal) {
      const feedback = feedbackFor(ws, name, ladder);
      const out = await area.run({ ws, view: ws.view(input), feedback }, signal);
      const held = area.hold?.(ws) ?? {};
      const said = write(ws, { feedback: out.feedback ?? held.feedback ?? null, ask: out.ask ?? held.ask ?? [] }, out.up ?? null);
      const ports = { input, feedback, up: said.up, action: out.action.map((p) => p.action), ask: said.ask, down: said.feedback };
      return { proposals: out.action, trace: { ...out.trace, ports } };
    },
  };
  if (area.everyMs <= 0 || !area.hold) return [region];
  const hold: Region = {
    name: `${name}${HOLD}`,
    layer,
    everyMs: 0,
    run(ws) {
      const said = write(ws, area.hold!(ws), ws.cortex[name]?.up ?? null);
      return { proposals: [], trace: { ports: { ask: said.ask, down: said.feedback } } };
    },
  };
  return [hold, region];
}
