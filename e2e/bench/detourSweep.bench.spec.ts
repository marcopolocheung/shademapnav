import { expect, test } from "@playwright/test";
import {
  type EdgeRef,
  type PrismProvider,
  bboxAroundEdges,
  createGeometryShadeField,
  staticPrismProvider,
} from "../../app/lib/shade/ShadeField";
import { prismsFromTileFeatures } from "../../app/lib/shade/geometry";
import {
  type GraphEdge,
  type RoutingGraph,
  haversineMeters,
  parallelSidewalkEdges,
  paretoRoutes,
} from "../../app/lib/routing";
import { computeSolarIntensity } from "../../app/lib/shadeSampling";
import { fixtureBuildingFeatures } from "../fixtures/basemapStyle";
import { GRID_COLS, GRID_ROWS, nodeId, overpassGridGraph } from "../fixtures/overpassGrid";
import { markdownTable, ms, pct, stats } from "./stats";

/**
 * The detour-budget sweep — issue #243, folded into G2 because it is the same
 * measurement with one parameter varied.
 *
 * `paretoRoutes` prunes any label whose optimistic length exceeds
 * `shortestDist × maxDetourFactor + 250 m`. `maxDetourFactor` defaults to
 * **2.0**, which admits a route twice as long as the direct one. Three
 * independent studies in `docs/research/shade-thermal-comfort-literature-2026-09-09.md`
 * find useful shade detours around +1.3%, under 3%, and plateauing near 110% —
 * roughly a tenth of what the budget allows.
 *
 * **This publishes the curve. It does not change the constant.** #243 is
 * labelled `track-h` and H3 picks a value against the measured cost, not against
 * a citation. A benchmark that also moves the thing it measures is not a
 * benchmark.
 *
 * ## Why this half runs in Node, not the browser
 *
 * `maxDetourFactor` is a `DijkstraOptions` field, and `useNavigation.ts` does not
 * pass it — the app always gets the 2.0 default. Sweeping it in the browser would
 * mean adding a way to set it from outside, which is a production change G2 has
 * no business making. So the sweep drives `paretoRoutes` directly, on the same
 * fixture grid, with shade from the same fixture buildings at the same instant
 * the browser benchmark uses.
 *
 * What that costs in fidelity, stated plainly: this is the **search** alone. It
 * excludes the Overpass fetch, the canvas read and the shade sampling that the
 * browser numbers carry, and its graph is the whole 11x11 grid rather than the
 * bbox the app fetches around its waypoints. The compute column is therefore not
 * comparable to the browser totals — it is comparable **across rows**, which is
 * the entire question the budget poses.
 */

// The instant G1 pins, in UTC. `America/New_York` is UTC-4 on the June solstice.
const WHEN = new Date("2026-06-21T13:00:00Z");

/** How many times each (pair, factor) search is repeated before taking a median. */
const REPEATS = 5;

/**
 * The budgets to price. 2.0 is today's default; 1.05 through 1.5 bracket what the
 * literature reports as useful; 3.0 is there to show the curve past the default
 * rather than stopping at it.
 */
const FACTORS = [1.05, 1.1, 1.25, 1.5, 2.0, 3.0];

/**
 * Origin/destination pairs, as (row, col) on the grid. Fixed and spread across
 * shapes — along a row, up a column, and three diagonals of growing length — so
 * one easy pair cannot carry the average.
 */
const PAIRS: [[number, number], [number, number]][] = [
  [[1, 1], [1, 9]],
  [[1, 1], [9, 1]],
  [[0, 0], [5, 5]],
  [[2, 8], [8, 2]],
  [[0, 10], [10, 0]],
  [[3, 3], [7, 8]],
  [[9, 2], [1, 7]],
  [[5, 0], [5, 10]],
];

/** Canonical (low→high node id) key for an undirected segment. */
const edgeKey = (a: number, b: number) => `${Math.min(a, b)},${Math.max(a, b)}`;

/**
 * The grid with real shade on every edge, built the way `useNavigation` builds
 * it: sample the canonical direction once, then split each directed edge into
 * its two sidewalks with `parallelSidewalkEdges`.
 */
function shadedGrid(): { graph: RoutingGraph; shadedShare: number } {
  const base = overpassGridGraph();

  const seen = new Set<string>();
  const refs: EdgeRef[] = [];
  const keys: string[] = [];
  for (const [fromId, edges] of base.adj) {
    for (const edge of edges) {
      const key = edgeKey(fromId, edge.toId);
      if (seen.has(key)) continue;
      seen.add(key);
      const lo = base.nodes.get(Math.min(fromId, edge.toId))!;
      const hi = base.nodes.get(Math.max(fromId, edge.toId))!;
      refs.push({ from: [lo.lon, lo.lat], to: [hi.lon, hi.lat] });
      keys.push(key);
    }
  }

  const prisms = prismsFromTileFeatures(fixtureBuildingFeatures());
  const bbox = bboxAroundEdges(refs, 2000)!;
  const provider: PrismProvider = staticPrismProvider(prisms, bbox, "tiles");
  const samples = createGeometryShadeField([provider]).sampleEdges(refs, WHEN);

  const shade = new Map<string, { left: number; right: number }>();
  samples.forEach((s, i) => {
    shade.set(keys[i], { left: s.left, right: s.right });
  });

  const adj = new Map<number, GraphEdge[]>();
  for (const [fromId, edges] of base.adj) {
    const out: GraphEdge[] = [];
    for (const edge of edges) {
      const { left, right } = shade.get(edgeKey(fromId, edge.toId))!;
      out.push(...parallelSidewalkEdges(fromId, edge, left, right));
    }
    adj.set(fromId, out);
  }

  const all = samples.flatMap((s) => [s.left, s.right]);
  return {
    graph: { nodes: base.nodes, adj },
    shadedShare: all.reduce((a, b) => a + b, 0) / all.length,
  };
}

test("detour budget sweep", () => {
  const { graph, shadedShare } = shadedGrid();

  // A sweep over a field that is all sun or all shade measures nothing: every
  // budget would buy the same zero. Fail loudly rather than publish a flat curve.
  expect(shadedShare, "fixture shade is degenerate — every budget would tie").toBeGreaterThan(0.05);
  expect(shadedShare, "fixture shade is degenerate — every budget would tie").toBeLessThan(0.95);

  // Warm the JIT over the whole pair set before anything is timed. Without it the
  // first factor in the list absorbs the compile cost and reads as the slowest
  // budget, which is the opposite of what the sweep is trying to show.
  for (const [[r0, c0], [r1, c1]] of PAIRS) {
    paretoRoutes(graph, nodeId(r0, c0), nodeId(r1, c1), { maxDetourFactor: 2.0 });
  }

  const rows: string[][] = [];

  for (const factor of FACTORS) {
    const timings: number[] = [];
    const gains: number[] = [];
    const overheads: number[] = [];
    let pairsWithAlternative = 0;

    for (const [[r0, c0], [r1, c1]] of PAIRS) {
      const startId = nodeId(r0, c0);
      const endId = nodeId(r1, c1);
      const start = graph.nodes.get(startId)!;
      const end = graph.nodes.get(endId)!;
      const straightLineDistM = haversineMeters([start.lon, start.lat], [end.lon, end.lat]);
      const solarIntensity = computeSolarIntensity(WHEN, start.lat, start.lon);
      const opts = {
        crossingPenaltyM: 15,
        solarIntensity,
        straightLineDistM,
        maxDetourFactor: factor,
      };

      let routes = paretoRoutes(graph, startId, endId, opts);
      for (let i = 0; i < REPEATS; i++) {
        const t = performance.now();
        routes = paretoRoutes(graph, startId, endId, opts);
        timings.push(performance.now() - t);
      }

      expect(routes.length, `no route at all for a connected grid pair (factor ${factor})`)
        .toBeGreaterThan(0);

      const shortest = routes[0];
      const shadiest = routes[routes.length - 1];
      if (routes.length > 1) pairsWithAlternative++;
      gains.push((shadiest.shadeCoverage - shortest.shadeCoverage) * 100);
      overheads.push(((shadiest.distanceM - shortest.distanceM) / shortest.distanceM) * 100);
    }

    const t = stats(timings);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    rows.push([
      factor === 2.0 ? "**2.0** (current)" : factor.toFixed(2),
      ms(t.p50),
      ms(t.p95),
      pct(mean(gains)),
      pct(mean(overheads)),
      `${pairsWithAlternative}/${PAIRS.length}`,
    ]);
  }

  console.log(
    `\n### Detour budget sweep (#243) — ${new Date().toISOString().slice(0, 10)}\n\n` +
      `${GRID_ROWS}x${GRID_COLS} fixture grid, ${PAIRS.length} O-D pairs, ${REPEATS} repeats each, ` +
      `${(shadedShare * 100).toFixed(1)}% mean sidewalk shade at 09:00 EDT on 2026-06-21.\n\n` +
      markdownTable(
        [
          "maxDetourFactor",
          "p50 search (ms)",
          "p95 search (ms)",
          "mean shade gain (pp)",
          "mean length overhead (%)",
          "pairs with an alternative",
        ],
        rows
      ) +
      "\n\nSearch time only — no fetch, no canvas read, no sampling. Comparable across " +
      "rows, not against the browser totals above.\n"
  );
});
