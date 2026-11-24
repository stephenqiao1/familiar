import type { MinecraftStateData } from "../encode/state-data.js";

// Glancing around when nothing stands out: one place at a time, the one looked toward longest
// ago. Mostly the eight compass directions at eye level; now and then up or down: the sky when
// outdoors, the ceiling and the floor ahead when under a roof.

/** Glances go this far out, to one of this many compass directions; every `vertical`th one goes up or down. */
export const SCAN = { blocks: 8, sectors: 8, vertical: 4 };
/** Where an up or down glance points, in blocks ahead and above the eyes. */
const UP_DOWN = { sky: { ahead: 3, up: 8 }, ceiling: { ahead: 3, up: 3 }, floor: { ahead: 3, up: -3 } };

/** Picks where to glance. `upDown`: also up and down (0: eye level only, as before). One per bot. */
export function createScan(): (data: MinecraftStateData, now: number, upDown?: number) => string {
  const looked = new Array<number>(SCAN.sectors).fill(0);
  const width = 360 / SCAN.sectors;
  let glances = 0;
  let floorNext = false;
  return (data, now, upDown = 0) => {
    const { x, y, z } = data.self.position;
    const at = (heading: number, ahead: number, up: number) => `pos:${Math.round(x - Math.sin(heading) * ahead)},${y + 1 + up},${Math.round(z - Math.cos(heading) * ahead)}`;
    glances++;
    if (upDown > 0 && glances % SCAN.vertical === 0) {
      // Outdoors the sky; under a roof the ceiling and the floor ahead, in turn.
      const where = data.self.skyLight > 0 ? UP_DOWN.sky : (floorNext = !floorNext) ? UP_DOWN.ceiling : UP_DOWN.floor;
      return at((data.self.gaze.yaw * Math.PI) / 180, where.ahead, where.up);
    }
    looked[Math.round(data.self.gaze.yaw / width) % SCAN.sectors] = now;
    const sector = looked.indexOf(Math.min(...looked));
    looked[sector] = now;
    return at((sector * width * Math.PI) / 180, SCAN.blocks, 0);
  };
}
