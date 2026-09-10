import { expect, test } from "@playwright/test";
import { markdownTable, ms } from "./stats";

/**
 * A8d — what the canopy raster says about a real street, against the real host.
 *
 * The unit tests pin the march against synthetic patches whose geometry is known
 * exactly, which is the only way to state where a shadow should land. What they cannot
 * say is whether the whole chain works on real data: whether `source.coop` still
 * serves the tiles, whether the store stitches them into a patch the provider will
 * accept, whether the heights that come back are canopy-shaped, and what a route pays
 * to find out. That is this.
 *
 * Two numbers matter and they pull in opposite directions:
 *
 * - **What a route waits for.** `ShadowField.ready()` is awaited beside the routing
 *   graph fetch, so a cold read is on the interactive path. `READY_BUDGET_MS` bounds
 *   that wait; this reports both the bounded wait and how long the read actually took,
 *   because the gap between them is the size of #290.
 * - **What the raster is worth.** Mean canopy shade over a 600 m line through each A3
 *   corpus centre, at four moments. Kent is leaf-on imagery, Madrid is leaf-off, and
 *   Singapore is where A7's census found *zero* tagged canopy in 2 km².
 *
 * Runs on demand only (`npm run bench:canopy`, its own config). Like A8a's and A8b's it
 * talks to a third-party host, so it never runs in CI and its numbers are quoted with
 * the machine and date they were taken on.
 */

const AOIS: Array<{ name: string; centre: [number, number] }> = [
  { name: "Madrid A3", centre: [-3.7038, 40.4168] },
  { name: "Kent, WA A3", centre: [-122.2348, 47.3809] },
  { name: "Singapore CBD", centre: [103.851, 1.284] },
];

/** Four moments a day, in UTC. Two of them are night somewhere, which is the point. */
const MOMENTS = [
  "2026-07-15T08:00:00Z",
  "2026-07-15T11:00:00Z",
  "2026-07-15T17:00:00Z",
  "2026-01-15T11:00:00Z",
];

interface AoiMeasurement {
  name: string;
  /** What `ready()` made the caller wait — bounded by `READY_BUDGET_MS`. */
  readyMs: number;
  /** Whether the read beat that budget. */
  landedAtReady: boolean;
  /** How long the read took in total, budget or no budget. */
  landedAfterMs: number;
  /** The same `ready()` again, once the area is cached. */
  readyAgainMs: number;
  validFraction: number | null;
  maxHeightM: number | null;
  shade: Array<{ iso: string; mean: number; source: string; confidence: number; ms: number }>;
}

test("the canopy raster reaches a real street, and says what it costs", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });

  await page.goto("/e2e/bench/a8dHarness.html");
  await page.waitForFunction(() => window.__umbraCanopyField?.ready === true);

  const measurements: AoiMeasurement[] = [];
  for (const { name, centre } of AOIS) {
    measurements.push({
      name,
      ...(await page.evaluate(
        async ({ centre, moments }) => {
          const {
            createRasterCanopyProvider, createGeometryShadowField, bboxAroundEdges, QUERY_PAD_M,
          } = window.__umbraCanopyField;

          const provider = createRasterCanopyProvider();
          const field = createGeometryShadowField([], [], [provider]);

          // A 600 m line through the corpus centre, cut into the 25 m edges a routing
          // graph produces. No building source: this measures the raster alone.
          const mPerLng = 111320 * Math.cos((centre[1] * Math.PI) / 180);
          const edges: Array<{ from: [number, number]; to: [number, number] }> = [];
          for (let i = 0; i < 24; i++) {
            edges.push({
              from: [centre[0] + (i * 25 - 300) / mPerLng, centre[1]] as [number, number],
              to: [centre[0] + ((i + 1) * 25 - 300) / mPerLng, centre[1]] as [number, number],
            });
          }
          const bbox = bboxAroundEdges(edges, QUERY_PAD_M);

          const t0 = performance.now();
          await field.ready(bbox);
          const readyMs = performance.now() - t0;
          const landedAtReady = provider.fieldFor(bbox) !== null;

          // Past the budget the read is still running. Wait it out, so the gap between
          // what a route waited for and what the network cost is on the record.
          const t1 = performance.now();
          while (provider.fieldFor(bbox) === null && performance.now() - t1 < 60_000) {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          const landedAfterMs = performance.now() - t1;

          const t2 = performance.now();
          await field.ready(bbox);
          const readyAgainMs = performance.now() - t2;

          const landed = provider.fieldFor(bbox);
          const shade = moments.map((iso) => {
            const when = new Date(iso);
            const t3 = performance.now();
            const sampled = field.sampleEdges(edges, when);
            const sampleMs = performance.now() - t3;
            return {
              iso,
              mean: sampled.reduce((sum, e) => sum + (e.left + e.right) / 2, 0) / sampled.length,
              source: sampled[0].source,
              confidence: sampled[0].confidence,
              ms: sampleMs,
            };
          });

          return {
            readyMs, landedAtReady, landedAfterMs, readyAgainMs, shade,
            validFraction: landed ? landed.validFraction : null,
            maxHeightM: landed ? landed.maxHeightM : null,
          };
        },
        { centre, moments: MOMENTS },
      )),
    });
  }

  console.log(`\n${markdownTable(
    ["AOI", "ready() waited", "read landed after", "ready() again", "valid", "tallest"],
    measurements.map((m) => [
      m.name,
      ms(m.readyMs),
      m.landedAtReady ? "(inside the budget)" : ms(m.landedAfterMs),
      ms(m.readyAgainMs),
      m.validFraction === null ? "—" : `${(m.validFraction * 100).toFixed(2)}%`,
      m.maxHeightM === null ? "—" : `${m.maxHeightM} m`,
    ]),
  )}\n`);

  console.log(`${markdownTable(
    ["AOI", ...MOMENTS.map((iso) => iso.slice(0, 16).replace("T", " "))],
    measurements.map((m) => [
      m.name,
      ...m.shade.map((s) =>
        s.source === "none" ? "sun down" : `${(s.mean * 100).toFixed(1)}% · c${s.confidence.toFixed(2)}`,
      ),
    ]),
  )}\n`);

  console.log(`${markdownTable(
    ["AOI", ...MOMENTS.map((iso) => iso.slice(11, 16))],
    measurements.map((m) => [m.name, ...m.shade.map((s) => ms(s.ms))]),
  )}\n`);

  for (const m of measurements) {
    // The chain works end to end: real tiles, stitched, decoded, marched.
    expect(m.maxHeightM, `${m.name} read a canopy height field`).not.toBeNull();
    expect(m.maxHeightM as number, `${m.name} found canopy standing in it`).toBeGreaterThan(0);
    // The bounded wait is what keeps a research mirror off the route path.
    expect(m.readyMs, `${m.name} bounded its ready() wait`).toBeLessThan(5_000);
    // Cached, the same area costs nothing.
    expect(m.readyAgainMs, `${m.name} answered a repeat ready() from cache`).toBeLessThan(50);
  }

  // At least one corpus city must report real canopy shade on a real street, or the
  // march works on synthetic patches and nothing else.
  const anyShade = measurements.some((m) =>
    m.shade.some((s) => s.source === "canopy" && s.mean > 0.05),
  );
  expect(anyShade, "some corpus city reported canopy shade over 5%").toBe(true);

  expect(consoleErrors, "no console errors").toEqual([]);
});

declare global {
  interface Window {
    __umbraCanopyField: {
      ready: boolean;
      QUERY_PAD_M: number;
      createRasterCanopyProvider: () => {
        fieldFor(bbox: BBoxLike): { validFraction: number; maxHeightM: number } | null;
      };
      createGeometryShadowField: (
        providers: unknown[],
        canopyProviders: unknown[],
        rasterProviders: unknown[],
      ) => {
        ready(bbox: BBoxLike): Promise<void>;
        sampleEdges(
          edges: Array<{ from: [number, number]; to: [number, number] }>,
          when: Date,
        ): Array<{ left: number; right: number; source: string; confidence: number }>;
      };
      bboxAroundEdges: (
        edges: Array<{ from: [number, number]; to: [number, number] }>,
        padM: number,
      ) => BBoxLike;
    };
  }
}

interface BBoxLike {
  west: number;
  south: number;
  east: number;
  north: number;
}
