import { expect, type Page, test } from "@playwright/test";
import { SAMPLE_STEP, stubNetwork } from "../helpers/scenario";
import { sampleMapCanvas, shadeMask, shadedFraction } from "../helpers/map";
import { markdownTable, ms, pct, stats, type Stats } from "./stats";
import {
  COLD_REPEATS,
  FIVE_POINT_URL,
  TWO_POINT_URL,
  VIA_WAYPOINTS,
  WARM_REPEATS,
} from "./scenarios";

/**
 * G2 — the route benchmark.
 *
 * Nobody may claim a routing perf win without a number, and until this existed
 * there was no number: `docs/notes/performance-baseline.md` measured the bundle
 * and `sampleEdges` in Node, and said outright that end-to-end route calculation
 * was missing.
 *
 * **This measures and commits. It does not gate.** Failing a build on regression
 * is G3. It runs on demand — `npm run bench:route`, its own Playwright config —
 * and never in CI: a 2-core GitHub runner on SwiftShader is roughly 3x slower
 * than this machine, so a baseline collected there and a comparison collected
 * here would not be the same measurement.
 *
 * **Keyless only.** The `smoke-live` half of G1 exists to check MapTiler's real
 * building schema; putting real tile fetches inside a performance number puts
 * network variance inside a baseline instead.
 *
 * What is being timed is `useNavigation.calculateRoute` end to end, as the app's
 * own instrumentation reports it (`window.__shadeMapMetrics`) — graph fetch,
 * canvas read, shade sampling and the Dijkstra/Pareto passes, with their phase
 * split. Two shapes, because they run different code:
 *
 * - **2-point** goes through `paretoRoutes`, the bi-criteria search.
 * - **5-point** goes through the per-segment branch, which runs a plain
 *   `dijkstra` per leg at several shade strengths. It is a different algorithm,
 *   not a bigger version of the same one.
 *
 * And two cache states: **cold** is the first calculation after a page load,
 * carrying the Overpass fetch and the first shade build; **warm** reuses the
 * module-level graph cache in `overpass.ts`, which is what a user gets on every
 * calculation after their first.
 */

interface PhaseSample {
  graphFetch: number;
  canvasRead: number;
  shadeSample: number;
  dijkstra: number;
  total: number;
  shadeFallbackShare: number;
}

interface AppSummary {
  runs: number;
  avgTotalMs: number;
  p50TotalMs: number;
  p95TotalMs: number;
}

interface ScenarioResult {
  name: string;
  samples: PhaseSample[];
  graphNodeCount: number;
  graphDirectedEdges: number;
  routeLabels: string[];
  /** Only warm scenarios have one: a reload wipes the app's history buffer. */
  appSummary: AppSummary | null;
}

const results: ScenarioResult[] = [];

/** Read the phase timings of every run the app has recorded, oldest first. */
async function readHistory(page: Page): Promise<PhaseSample[]> {
  return page.evaluate(() => {
    const m = (
      window as unknown as {
        __shadeMapMetrics?: {
          history: {
            phases: Record<string, number>;
            shadeFallbackShare: number;
          }[];
        };
      }
    ).__shadeMapMetrics;
    if (!m) return [];
    // The buffer is newest-first; the benchmark wants chronological order.
    return [...m.history].reverse().map((h) => ({
      graphFetch: h.phases.graphFetch,
      canvasRead: h.phases.canvasRead,
      shadeSample: h.phases.shadeSample,
      dijkstra: h.phases.dijkstra,
      total: h.phases.total,
      shadeFallbackShare: h.shadeFallbackShare,
    }));
  });
}

async function readLatestShape(
  page: Page
): Promise<{ graphNodeCount: number; graphDirectedEdges: number; routeLabels: string[] }> {
  return page.evaluate(() => {
    const m = (
      window as unknown as {
        __shadeMapMetrics?: {
          latest: {
            graphNodeCount: number;
            graphDirectedEdges: number;
            routes: { label: string }[];
          } | null;
        };
      }
    ).__shadeMapMetrics;
    const latest = m?.latest;
    return {
      graphNodeCount: latest?.graphNodeCount ?? 0,
      graphDirectedEdges: latest?.graphDirectedEdges ?? 0,
      routeLabels: latest?.routes.map((r) => r.label) ?? [],
    };
  });
}

async function readAppSummary(page: Page): Promise<AppSummary | null> {
  return page.evaluate(() => {
    const m = (window as unknown as { __shadeMapMetrics?: { summary: AppSummary | null } })
      .__shadeMapMetrics;
    return m?.summary ?? null;
  });
}

async function clearAppMetrics(page: Page): Promise<void> {
  await page.evaluate(() => {
    (
      window as unknown as { __shadeMapMetrics?: { clearMetrics: () => void } }
    ).__shadeMapMetrics?.clearMetrics();
  });
}

/**
 * Load the app and wait until it is genuinely ready to route: the canvas is up
 * and the shadow field has stopped changing on its own. Timing a calculation
 * against a half-built shadow field would measure the load, not the route.
 */
async function loadAndSettle(page: Page, url: string): Promise<void> {
  await stubNetwork(page, { basemap: "fixture" });
  await page.goto(url);
  await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible();

  await expect
    .poll(async () => shadedFraction(shadeMask(await sampleMapCanvas(page, SAMPLE_STEP))), {
      timeout: 90_000,
      message: "no shadow pixels ever appeared, so there was nothing to route against",
    })
    .toBeGreaterThan(0.02);

  let mask = shadeMask(await sampleMapCanvas(page, SAMPLE_STEP));
  await expect
    .poll(
      async () => {
        const next = shadeMask(await sampleMapCanvas(page, SAMPLE_STEP));
        const drift = next.filter((s, i) => s !== mask[i]).length / next.length;
        mask = next;
        return drift;
      },
      { timeout: 15_000, message: "the shadow field never settled" }
    )
    .toBeLessThan(0.005);
}

/** Click Find Shaded Route and wait for the run count to advance by one. */
async function calculateOnce(page: Page, runsBefore: number): Promise<void> {
  await page.getByRole("button", { name: "Find Shaded Route" }).click();
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const m = (window as unknown as { __shadeMapMetrics?: { history: unknown[] } })
            .__shadeMapMetrics;
          return m?.history.length ?? 0;
        }),
      { timeout: 60_000, message: "a route calculation never completed" }
    )
    .toBe(runsBefore + 1);
}

/**
 * Cold: one page load per repeat. The Overpass graph cache lives in a module in
 * `overpass.ts`, so a reload is the only honest reset — clearing the metrics
 * buffer would leave the graph cached and quietly measure a warm run.
 */
async function benchCold(page: Page, name: string, url: string, repeats: number) {
  const samples: PhaseSample[] = [];
  let shape = { graphNodeCount: 0, graphDirectedEdges: 0, routeLabels: [] as string[] };

  for (let i = 0; i < repeats; i++) {
    await loadAndSettle(page, url);
    await calculateOnce(page, 0);
    const history = await readHistory(page);
    expect(history, `${name}: expected exactly one run on a fresh page`).toHaveLength(1);
    samples.push(history[0]);
    shape = await readLatestShape(page);
  }

  results.push({ name, samples, ...shape, appSummary: null });
}

/**
 * Warm: one page load, one discarded warm-up calculation to populate the graph
 * cache, then `clearMetrics()` and the measured repeats. The reset is what #183
 * added — without it the warm-up's own timing sits inside the aggregate.
 */
async function benchWarm(page: Page, name: string, url: string, repeats: number) {
  await loadAndSettle(page, url);
  await calculateOnce(page, 0); // warm-up: fetches and caches the graph
  await clearAppMetrics(page);

  for (let i = 0; i < repeats; i++) {
    await calculateOnce(page, i);
  }

  const samples = await readHistory(page);
  expect(samples, `${name}: metrics buffer did not hold every measured run`).toHaveLength(repeats);

  results.push({
    name,
    samples,
    ...(await readLatestShape(page)),
    appSummary: await readAppSummary(page),
  });
}

test.describe.configure({ mode: "serial" });

test("2-point, cache-cold", async ({ page }) => {
  await benchCold(page, "2-point cold", TWO_POINT_URL, COLD_REPEATS);
});

test("2-point, cache-warm", async ({ page }) => {
  await benchWarm(page, "2-point warm", TWO_POINT_URL, WARM_REPEATS);
});

test("5-point, cache-cold", async ({ page }) => {
  await benchCold(page, "5-point cold", FIVE_POINT_URL, COLD_REPEATS);
});

test("5-point, cache-warm", async ({ page }) => {
  await benchWarm(page, "5-point warm", FIVE_POINT_URL, WARM_REPEATS);
});

test.afterAll(() => {
  if (results.length === 0) return;

  const totals = new Map<string, Stats>();
  for (const r of results) totals.set(r.name, stats(r.samples.map((s) => s.total)));

  const phaseRows = results.map((r) => {
    const phase = (pick: (s: PhaseSample) => number) => ms(stats(r.samples.map(pick)).p50);
    const t = totals.get(r.name)!;
    return [
      r.name,
      String(t.n),
      ms(t.p50),
      ms(t.p95),
      `±${pct(t.spreadPct)}%`,
      phase((s) => s.graphFetch),
      phase((s) => s.canvasRead),
      phase((s) => s.shadeSample),
      phase((s) => s.dijkstra),
    ];
  });

  console.log(
    `\n### Route calculation — ${new Date().toISOString().slice(0, 10)}\n\n` +
      markdownTable(
        [
          "Scenario",
          "N",
          "p50 total (ms)",
          "p95 total (ms)",
          "spread",
          "graph fetch",
          "canvas read",
          "shade sample",
          "dijkstra",
        ],
        phaseRows
      ) +
      "\n\nPhase columns are medians in ms and do not sum to the total: the phases " +
      "are timed inside one wall-clock span that also covers work between them.\n"
  );

  for (const r of results) {
    const fallback = stats(r.samples.map((s) => s.shadeFallbackShare)).p50;
    console.log(
      `${r.name}: ${r.graphNodeCount} nodes, ${r.graphDirectedEdges} directed edges, ` +
        `routes [${r.routeLabels.join(", ")}], median canvas fallback ${pct(fallback * 100)}%`
    );
    // Every run in order, not just the aggregate. A median hides the difference
    // between noise and a monotonic climb, and a warm scenario is a series of
    // calculations on one page — exactly where a climb would show up.
    console.log(`  totals in order: ${r.samples.map((s) => ms(s.total)).join(", ")}`);
    console.log(`  canvas read:     ${r.samples.map((s) => ms(s.canvasRead)).join(", ")}`);
    console.log(`  dijkstra:        ${r.samples.map((s) => ms(s.dijkstra)).join(", ")}`);
  }

  // The app's own summary and this harness must agree about the same runs. They
  // are two implementations of one percentile definition; if they ever drift,
  // the committed baseline and the number the app reports stop being comparable.
  for (const r of results) {
    if (!r.appSummary) continue;
    const t = totals.get(r.name)!;
    expect(r.appSummary.runs, `${r.name}: run count`).toBe(t.n);
    expect(r.appSummary.p50TotalMs, `${r.name}: p50 disagrees with window.__shadeMapMetrics`)
      .toBeCloseTo(t.p50, 6);
    expect(r.appSummary.p95TotalMs, `${r.name}: p95 disagrees with window.__shadeMapMetrics`)
      .toBeCloseTo(t.p95, 6);
  }

  console.log(
    `\nvia waypoints for the 5-point shape: ${VIA_WAYPOINTS.map((v) => v.join(",")).join(" ")}\n`
  );
});
