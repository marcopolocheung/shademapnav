/**
 * Shade sampling throughput — the number behind any "this made it faster" claim.
 *
 * Deliberately **not** a test. `.claude/rules/routing-and-shade.md` says to take
 * timings rather than assert them, and a wall-clock assertion on a shared CI runner
 * is a flake generator. Vitest's benchmark glob (`*.bench.ts`) is disjoint from the
 * test glob in `vitest.config.ts`, so nothing here runs under `npm test` or in CI.
 *
 *   npm run bench                      # the repeated cases below
 *   SHADEMAP_BENCH_FULL=1 npm run bench  # adds the full route-graph case
 *
 * Everything here goes through the public `ShadeField` surface, so the same file
 * runs unmodified on either side of a change to how shade is computed — which is
 * the only way a before/after comparison means anything. Record results in
 * `docs/notes/performance-baseline.md` with the environment and the commit.
 */

import { bench, describe } from "vitest";
import { type EdgeRef, bboxAroundEdges, createGeometryShadeField, staticPrismProvider } from "../ShadeField";
import { type BuildingPrism, type PrismSet, metersPerDegree } from "../geometry";

/** Midtown Manhattan — dense, tall, and the case the route graph numbers come from. */
const LAT = 40.7484;
const LNG = -73.9857;
const { mPerLat, mPerLng } = metersPerDegree(LAT);

/** Mid-afternoon in August: sun high enough to cast usable shade, low enough to be long. */
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
  return { field: createGeometryShadeField([staticPrismProvider(set, coverage, "tiles")]), batch };
}

// Few iterations, fixed: one call took ~0.8 s before the shadow index landed, so a
// time-budgeted run would manage a single pass and report a meaningless margin.
const REPEAT = { time: 0, iterations: 8, warmupIterations: 1 } as const;

describe("ShadeField.sampleEdges", () => {
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
describe.runIf(process.env.SHADEMAP_BENCH_FULL === "1")("ShadeField.sampleEdges — city scale", () => {
  const { field, batch } = fieldFor(2000, 1000);
  bench("2000 prisms x 1000 edges", () => {
    field.sampleEdges(batch, WHEN);
  }, { time: 0, iterations: 3, warmupIterations: 0 });
});
