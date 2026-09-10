/**
 * Aggregation for the route benchmark.
 *
 * `percentile` is deliberately the same definition `app/lib/metrics.ts` uses —
 * R-7 linear interpolation — because the browser scenarios report both this
 * harness's numbers and the app's own `window.__umbraMetrics.summary`, and
 * two percentile definitions that quietly disagree would make the pair
 * meaningless. `routeCalc.bench.spec.ts` asserts they agree.
 */

/** Linear-interpolated percentile (R-7) over an ascending-sorted array. */
export function percentile(sortedAsc: number[], q: number): number {
  const rank = (sortedAsc.length - 1) * q;
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (rank - lo);
}

export interface Stats {
  n: number;
  min: number;
  p50: number;
  p95: number;
  max: number;
  /** Half the p95−p5 span as a share of the median. The spread figure quoted. */
  spreadPct: number;
}

export function stats(samples: number[]): Stats {
  const sorted = [...samples].sort((a, b) => a - b);
  const p50 = percentile(sorted, 0.5);
  const p05 = percentile(sorted, 0.05);
  const p95 = percentile(sorted, 0.95);
  return {
    n: sorted.length,
    min: sorted[0],
    p50,
    p95,
    max: sorted[sorted.length - 1],
    spreadPct: p50 > 0 ? ((p95 - p05) / 2 / p50) * 100 : 0,
  };
}

/** A markdown table, printed ready to paste into the baseline note. */
export function markdownTable(headers: string[], rows: string[][]): string {
  const align = headers.map((_, i) => (i === 0 ? "---" : "---:"));
  return [
    `| ${headers.join(" | ")} |`,
    `|${align.map((a) => `${a}`).join("|")}|`,
    ...rows.map((r) => `| ${r.join(" | ")} |`),
  ].join("\n");
}

export const ms = (v: number) => v.toFixed(1);
export const pct = (v: number) => v.toFixed(1);
