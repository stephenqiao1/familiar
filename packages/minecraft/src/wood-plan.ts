/** A craft that eats `planks` planks, all of one wood type (Minecraft recipes don't mix woods). */
export interface WoodJob {
  item: string;
  planks: number;
}

/**
 * Gives each job a wood type so no type is overdrawn. `stock` maps a planks name (e.g. oak_planks)
 * to how many planks of it are available, counting logs as 4. Returns null if no assignment fits.
 */
export function assignWood(stock: ReadonlyMap<string, number>, jobs: readonly WoodJob[]): string[] | null {
  const types = [...stock.keys()];
  const used = new Map<string, number>();

  function place(i: number, chosen: string[]): string[] | null {
    if (i === jobs.length) return chosen;
    const job = jobs[i]!;
    for (const type of types) {
      const after = (used.get(type) ?? 0) + job.planks;
      if (after > stock.get(type)!) continue;
      used.set(type, after);
      const result = place(i + 1, [...chosen, type]);
      if (result) return result;
      used.set(type, after - job.planks);
    }
    return null;
  }
  return place(0, []);
}
