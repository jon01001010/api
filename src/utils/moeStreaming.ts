/**
 * "Stream large models from storage" (Settings → Advanced, off by default):
 * a mixture-of-experts model only uses a few of its experts per token, so
 * with the file memory-mapped Android can keep just the parts in use in
 * RAM and read the rest from storage. Slow, and Android may close the app
 * under memory pressure, so it is an experiment for phones near the limit.
 *
 * MoE models name their active size next to the total: granite-3.0-1b-a400m,
 * Qwen3-30B-A3B, LFM2-8B-A1B. That ratio is all this reads.
 */

const MOE_NAME =
  /(\d+(?:\.\d+)?)\s*([bm])[-_. ]a(\d+(?:\.\d+)?)([bm])(?![a-z0-9])/i;

const toBillions = (n: string, unit: string) =>
  Number(n) / (unit.toLowerCase() === 'm' ? 1000 : 1);

/** Active ÷ total parameters for an MoE name, or undefined if not MoE. */
export function moeActiveFraction(name: string): number | undefined {
  const m = MOE_NAME.exec(name);
  if (!m) {
    return undefined;
  }
  const total = toBillions(m[1], m[2]);
  const active = toBillions(m[3], m[4]);
  if (!(total > 0) || !(active > 0) || active >= total) {
    return undefined;
  }
  return active / total;
}

/**
 * The share of the weights to count against free memory when streaming:
 * twice the active share (experts change from token to token), between a
 * quarter and all of it.
 */
export function streamingSizeFactor(name: string): number {
  const f = moeActiveFraction(name);
  if (f === undefined) {
    return 1;
  }
  return Math.min(1, Math.max(0.25, f * 2));
}
