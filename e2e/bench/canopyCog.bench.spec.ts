import { expect, test } from "@playwright/test";
import { markdownTable, ms } from "./stats";

/**
 * A8a — what a browser pays to read canopy heights straight from `source.coop`.
 *
 * **This measures and records. It has no routing effect and gates nothing.** The
 * checkpoint's whole claim is that a route-sized area of the Meta/WRI canopy
 * height map is reachable from a page with no server, no proxy and no
 * preprocessing, at a cost worth paying — and until this ran there was an
 * estimate (summed from the Madrid tile's `TileByteCounts` in
 * `docs/notes/canopy-raster-feasibility-2026-09-09.md`) and no measurement.
 *
 * Four figures, for three AOI sizes, over the A3 Madrid corpus centre:
 *
 * - **payload** — the compressed COG tiles the window overlaps. The floor a
 *   perfect reader would transfer, summed from `TileByteCounts`.
 * - **requested / transferred** — the byte ranges `geotiff` asked for, against
 *   what the responses actually carried. Counted from the `Range` request header
 *   and the `Content-Length` of each response rather than by reading the bodies:
 *   `source.coop` sends no `Timing-Allow-Origin`, so Resource Timing reports zero
 *   sizes cross-origin, and cloning each body to measure it undercounts once
 *   Chromium's cache is in play. Headers are exact, and readable here because the
 *   host sends `access-control-expose-headers: *`. Two limits worth knowing:
 *   these are **body** bytes, so 26-146 sets of response headers are uncounted
 *   and real wire cost is above the figure, most visibly on the smallest AOI; and
 *   the three AOIs read one `.tif` in one browser session, so Chromium may serve
 *   some ranges from cache with `Content-Length` intact.
 * - **decode** — `readRasters`: the range fetches plus DEFLATE, split from the
 *   open so the one-off IFD cost is visible separately from the per-AOI cost.
 * - **heap held** — `performance.memory.usedJSHeapSize` with the decoded raster
 *   live, against a `HeapProfiler.collectGarbage` baseline, with the raster's own
 *   size alongside it for scale.
 *
 * Two instruments had to be discarded before that last figure meant anything, and
 * both are worth not repeating. Sampling `performance.memory` in a loop inflated
 * decode **5-7x** — `--enable-precise-memory-info` makes every read do real work,
 * so the instrument ended up inside its own measurement; it is now read exactly
 * twice. And CDP's `Runtime.getHeapUsage`, tried as the cheap alternative, counts
 * only the V8 heap: `ArrayBuffer` backing stores live outside it, so the 7.4 MB
 * raster reported as **1.0 MB** and the figure *fell* as the AOI grew. What is
 * reported is therefore what the reader retains, not the transient peak inside
 * `readRasters`, which nothing available here can see.
 *
 * Runs on demand only (`npm run bench:canopy`, its own config). It is the one
 * check in this repo that talks to a third-party host, so it never runs in CI and
 * its numbers are quoted with the machine and date they were taken on.
 */

/** The A3 corpus centre for Madrid, so this and the agreement corpus agree on "Madrid". */
const MADRID: [number, number] = [-3.7038, 40.4168];

/** The three box sizes the feasibility note estimated, so estimate and measurement compare. */
const AOI_SIZES_M = [500, 2000, 5000];

interface ReadMeasurement {
  sizeM: number;
  width: number;
  height: number;
  metresPerPixel: number;
  overviewIndex: number;
  quadkey: string;
  payloadBytes: number;
  tilesRead: number;
  wholeTileBytes: number;
  requestedBytes: number;
  transferredBytes: number;
  requests: number;
  heapMeasured: boolean;
  openMs: number;
  decodeMs: number;
  totalMs: number;
  rasterBytes: number;
  heldHeapBytes: number;
  baselineHeapBytes: number;
  maxHeightM: number;
  canopyPixelShare: number;
}

test("canopy COG reads browser-direct at route scale", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });

  await page.goto("/e2e/bench/canopyHarness.html");
  await page.waitForFunction(() => window.__umbraCanopy?.ready === true);

  const cdp = await page.context().newCDPSession(page);
  const results: ReadMeasurement[] = [];
  for (const sizeM of AOI_SIZES_M) {
    results.push(await measureRead(page, cdp, MADRID, sizeM));
  }

  console.log(`\n${renderReport(results)}\n`);

  expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);

  for (const r of results) {
    // The claim under test, in three parts: it is one tile of the published grid,
    // it is the ~1.8 m overview rather than native resolution, and it is
    // route-sized rather than tile-sized.
    expect(r.quadkey).toBe("0331110121");
    expect(r.overviewIndex).toBe(2);
    expect(r.metresPerPixel).toBeGreaterThan(1.7);
    expect(r.metresPerPixel).toBeLessThan(1.9);
    expect(r.transferredBytes).toBeLessThan(r.wholeTileBytes / 10);
    // Ranges are honoured exactly: no over-delivery, and no silent fall back to
    // serving the whole 84 MB object when a range is refused.
    expect(r.transferredBytes).toBe(r.requestedBytes);
    expect(r.transferredBytes).toBeGreaterThanOrEqual(r.payloadBytes);
    // The heap figure is a measurement or it is reported as absent — never a
    // silent zero standing in for "the API was not there".
    expect(r.heapMeasured).toBe(true);
    // A decoded raster of the right shape, not a mask: the 1-bit validity mask
    // decodes just as cleanly and is entirely ones, so a height range that is
    // neither empty nor saturated is what distinguishes them.
    expect(r.width * r.height).toBe(r.rasterBytes);
    expect(r.maxHeightM).toBeGreaterThan(1);
    expect(r.maxHeightM).toBeLessThan(120);
    expect(r.canopyPixelShare).toBeGreaterThan(0);
    expect(r.canopyPixelShare).toBeLessThan(1);
  }
});

/**
 * One read per AOI, with the heap baseline collected first so it is live memory
 * and not the previous AOI's raster waiting to be swept — a delta measured
 * against an inflated baseline reads *smaller* than the truth.
 */
async function measureRead(
  page: import("@playwright/test").Page,
  cdp: import("@playwright/test").CDPSession,
  centre: [number, number],
  sizeM: number,
): Promise<ReadMeasurement> {
  await cdp.send("HeapProfiler.collectGarbage");
  return runRead(page, centre, sizeM);
}

/** One read, instrumented from inside the page. */
async function runRead(
  page: import("@playwright/test").Page,
  centre: [number, number],
  sizeM: number,
): Promise<ReadMeasurement> {
  return page.evaluate(
    async ([lon, lat, side]) => {
      const half = side / 2;
      const dLat = half / 111_320;
      const dLon = half / (111_320 * Math.cos((lat * Math.PI) / 180));
      const aoi: [number, number, number, number] = [
        lon - dLon,
        lat - dLat,
        lon + dLon,
        lat + dLat,
      ];

      // Count every byte the library asks for and every byte that comes back,
      // including the IFD walk and any block-aligned over-read.
      // `readCanopyHeights` deliberately does not know about this: only a
      // counting fetch sees what actually crossed the wire.
      const nativeFetch = window.fetch.bind(window);
      let requestedBytes = 0;
      let transferredBytes = 0;
      let requests = 0;
      window.fetch = async (...args: Parameters<typeof fetch>) => {
        requests += 1;
        const range = new Headers(args[1]?.headers).get("range");
        const asked = /bytes=(\d+)-(\d+)/.exec(range ?? "");
        if (asked) requestedBytes += Number(asked[2]) - Number(asked[1]) + 1;
        const response = await nativeFetch(...args);
        const length = response.headers.get("content-length");
        if (length) transferredBytes += Number(length);
        return response;
      };

      // Read exactly twice. With `--enable-precise-memory-info` each call does
      // real work, and polling it is what put the instrument inside the timing.
      const heap = () =>
        (performance as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0;
      const baselineHeapBytes = heap();

      try {
        const { raster, stats } = await window.__umbraCanopy.readCanopyHeights(aoi);
        // Taken with `raster` still referenced, so its backing store is live.
        const heldHeapBytes = heap();

        let maxHeightM = 0;
        let canopyPixels = 0;
        for (const h of raster.heights) {
          if (h > maxHeightM) maxHeightM = h;
          if (h > 0) canopyPixels += 1;
        }

        return {
          sizeM: side,
          width: raster.width,
          height: raster.height,
          metresPerPixel: raster.metresPerPixel,
          overviewIndex: raster.overviewIndex,
          quadkey: raster.quadkey,
          payloadBytes: stats.payloadBytes,
          tilesRead: stats.tilesRead,
          wholeTileBytes: stats.wholeTileBytes,
          requestedBytes,
          transferredBytes,
          requests,
          openMs: stats.openMs,
          decodeMs: stats.decodeMs,
          totalMs: stats.totalMs,
          rasterBytes: raster.heights.byteLength,
          baselineHeapBytes,
          heldHeapBytes,
          heapMeasured: baselineHeapBytes > 0 && heldHeapBytes > 0,
          maxHeightM,
          canopyPixelShare: canopyPixels / raster.heights.length,
        };
      } finally {
        window.fetch = nativeFetch;
      }
    },
    [centre[0], centre[1], sizeM] as const,
  );
}

/** The tables, ready to paste into the feasibility note. */
function renderReport(results: ReadMeasurement[]): string {
  const kb = (b: number) => `${(b / 1024).toFixed(1)} KB`;
  const transport = markdownTable(
    [
      "AOI",
      "raster",
      "m/px",
      "COG tiles",
      "payload",
      "requested",
      "transferred",
      "overhead",
      "requests",
      "vs whole tile",
    ],
    results.map((r) => [
      `${r.sizeM / 1000} km box`,
      `${r.width}x${r.height}`,
      r.metresPerPixel.toFixed(2),
      String(r.tilesRead),
      kb(r.payloadBytes),
      kb(r.requestedBytes),
      kb(r.transferredBytes),
      `${(r.transferredBytes / r.payloadBytes).toFixed(2)}x`,
      String(r.requests),
      `${(r.transferredBytes / r.wholeTileBytes) * 100 < 0.1 ? "<0.1" : ((r.transferredBytes / r.wholeTileBytes) * 100).toFixed(1)}%`,
    ]),
  );

  const timing = markdownTable(
    ["AOI", "open", "read + decode", "total", "round trips", "raster", "heap held over baseline"],
    results.map((r) => [
      `${r.sizeM / 1000} km box`,
      `${ms(r.openMs)} ms`,
      `${ms(r.decodeMs)} ms`,
      `${ms(r.totalMs)} ms`,
      String(r.requests),
      kb(r.rasterBytes),
      r.heapMeasured ? kb(Math.max(0, r.heldHeapBytes - r.baselineHeapBytes)) : "not measurable",
    ]),
  );

  return `${transport}\n\n${timing}`;
}

declare global {
  interface Window {
    __umbraCanopy: {
      ready: boolean;
      readCanopyHeights: (aoi: [number, number, number, number]) => Promise<{
        raster: {
          heights: Uint8Array;
          width: number;
          height: number;
          metresPerPixel: number;
          overviewIndex: number;
          quadkey: string;
        };
        stats: {
          payloadBytes: number;
          tilesRead: number;
          wholeTileBytes: number;
          openMs: number;
          decodeMs: number;
          totalMs: number;
        };
      }>;
    };
  }
}
