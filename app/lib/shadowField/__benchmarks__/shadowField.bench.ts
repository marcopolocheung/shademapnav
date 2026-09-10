/**
 * Shadow sampling throughput — the number behind any "this made it faster" claim.
 *
 * Deliberately **not** a test. `.claude/rules/routing-and-shadow.md` says to take
 * timings rather than assert them, and a wall-clock assertion on a shared CI runner
 * is a flake generator. Vitest's benchmark glob (`*.bench.ts`) is disjoint from the
 * test glob in `vitest.config.ts`, so nothing here runs under `npm test` or in CI.
 *
 *   npm run bench                      # the repeated cases below
 *   UMBRA_BENCH_FULL=1 npm run bench  # adds the full route-graph case
 *
 * Everything here goes through the public `ShadowField` surface, so the same file
 * runs unmodified on either side of a change to how shadow is computed — which is
 * the only way a before/after comparison means anything. Record results in
 * `docs/notes/performance-baseline.md` with the environment and the commit.
 */

import { bench, describe } from "vitest";
import { type EdgeRef, bboxAroundEdges, createGeometryShadowField, staticPrismProvider } from "../ShadowField";
import { type BuildingPrism, type PrismSet, metersPerDegree } from "../geometry";

/** Midtown Manhattan — dense, tall, and the case the route graph numbers come from. */
const LAT = 40.7484;
const LNG = -73.9857;
const { mPerLat, mPerLng } = metersPerDegree(LAT);

/** Mid-afternoon in August: sun high enough to cast usable shadow, low enough to be long. */
const WHEN = new Date("2026-08-16T16:30:00Z");

/** A square grid of buildings on a 60 m pitch, heights cycling 20–110 m. */
function prismSet(count: number): PrismSet {
  const prisms: BuildingPrism[] = [];
  const side = Math.ceil(Math.sqrt(count));
  for (let i = 0; i < count; i++) {
    const eastM = ((i % side) - side / 2) * 60;
    const northM = (Math.floor(i / side) - side / 2) * 60;
    const w = eastM / mPerLng;
    const s = northM / mPerLat;
    const e = (eastM + 35) / mPerLng;
    const n = (northM + 35) / mPerLat;
    prisms.push({
      ring: [
        [LNG + w, LAT + s],
        [LNG + e, LAT + s],
        [LNG + e, LAT + n],
        [LNG + w, LAT + n],
      ],
      heightM: 20 + ((i * 37) % 90),
    });
  }
  return { prisms, maxHeightM: 110 };
}

/**
 * 50 m edges in rows of 40 — the shape a sidewalk graph actually has.
 * `edgeSampleCount` gives 3 steps per edge, so each one costs 8 point queries.
 */
function edges(count: number): EdgeRef[] {
  const out: EdgeRef[] = [];
  for (let i = 0; i < count; i++) {
    const northM = (i % 40) * 50;
    const eastM = Math.floor(i / 40) * 50;
    out.push({
      from: [LNG + eastM / mPerLng, LAT + northM / mPerLat],
      to: [LNG + (eastM + 50) / mPerLng, LAT + northM / mPerLat],
    });
  }
  return out;
}

function fieldFor(prismCount: number, edgeCount: number) {
  const set = prismSet(prismCount);
  const batch = edges(edgeCount);
  const coverage = bboxAroundEdges(batch, 5000);
  if (!coverage) throw new Error("no edges");
  return { field: createGeometryShadowField([staticPrismProvider(set, coverage, "tiles")]), batch };
}

// Few iterations, fixed: one call took ~0.8 s before the shadow index landed, so a
// time-budgeted run would manage a single pass and report a meaningless margin.
const REPEAT = { time: 0, iterations: 8, warmupIterations: 1 } as const;

describe("ShadowField.sampleEdges", () => {
  for (const [prisms, edgeCount] of [
    [400, 200],
    [800, 200],
    [1600, 200],
    [400, 400],
  ] as const) {
    const { field, batch } = fieldFor(prisms, edgeCount);
    bench(`${prisms} prisms x ${edgeCount} edges`, () => {
      field.sampleEdges(batch, WHEN);
    }, REPEAT);
  }
});

/**
 * A6's number: N hours against one hour, over the same route.
 *
 * A 3 km route is 60 edges of 50 m, which `edgeSampleCount` walks 4 points deep on
 * each sidewalk — 480 point queries per hour. The 14 hours run 11:00–24:00 UTC, i.e.
 * a full New York day either side of solar noon, because a sweep whose hours are
 * mostly below the horizon measures the short-circuit rather than the sweep.
 *
 * Three cases on purpose. `sweep(14)` against `sampleEdges` x14 is what A6 actually
 * improved — the shared preparation. `sampleEdges` alone is the denominator A6's
 * acceptance criterion names, and it is the one that says how much of the per-hour
 * cost no amount of sharing can remove.
 */
describe("ShadowField.sweep — a 3 km route across a day", () => {
  const SWEEP_HOURS: Date[] = [];
  for (let hour = 11; hour < 25; hour++) {
    SWEEP_HOURS.push(new Date(Date.UTC(2026, 7, 16, hour, 0, 0)));
  }

  /** 50 m edges in an L-turning chain, so the route wanders like a real one. */
  function routeEdges(totalM: number): EdgeRef[] {
    const out: EdgeRef[] = [];
    let eastM = -1000;
    let northM = -1000;
    for (let done = 0, i = 0; done < totalM; done += 50, i++) {
      const from: [number, number] = [LNG + eastM / mPerLng, LAT + northM / mPerLat];
      if (Math.floor(i / 4) % 2 === 0) eastM += 50;
      else northM += 50;
      out.push({ from, to: [LNG + eastM / mPerLng, LAT + northM / mPerLat] });
    }
    return out;
  }

  // More iterations than `REPEAT`: the one-hour case is the denominator of the
  // headline ratio, and at 8 iterations it reported a ±35% margin — wide enough to
  // move the ratio by a third on noise alone.
  const SWEEP_REPEAT = { time: 0, iterations: 40, warmupIterations: 10 } as const;

  const set = prismSet(2000);
  const route = routeEdges(3000);
  const coverage = bboxAroundEdges(route, 5000);
  if (!coverage) throw new Error("no edges");
  const field = createGeometryShadowField([staticPrismProvider(set, coverage, "tiles")]);

  bench("sampleEdges, one hour", () => {
    field.sampleEdges(route, SWEEP_HOURS[3]);
  }, SWEEP_REPEAT);

  bench("sampleEdges x14, one hour at a time", () => {
    for (const when of SWEEP_HOURS) field.sampleEdges(route, when);
  }, SWEEP_REPEAT);

  bench("sweep, 14 hours in one call", () => {
    field.sweep(route, SWEEP_HOURS);
  }, SWEEP_REPEAT);
});

/**
 * City-scale: ~2,000 buildings, the prism count `querySourceFeatures` returns over
 * Midtown. Opt-in because one iteration took ~20 s before the shadow index landed.
 *
 * The edge count is held at 1,000 rather than a full graph's ~5,400 on purpose. A
 * single bench iteration that blocks the event loop for minutes trips vitest's worker
 * heartbeat (`Timeout calling "onTaskUpdate"`) and the run reports nothing at all, so
 * a full-graph case is not measurable through `vitest bench` on the slow path. Scale
 * linearly in edges to reach a route-graph estimate — the 200-vs-400 edge cases above
 * are there to show that the scaling really is linear.
 */
describe.runIf(process.env.UMBRA_BENCH_FULL === "1")("ShadowField.sampleEdges — city scale", () => {
  const { field, batch } = fieldFor(2000, 1000);
  bench("2000 prisms x 1000 edges", () => {
    field.sampleEdges(batch, WHEN);
  }, { time: 0, iterations: 3, warmupIterations: 0 });
});
