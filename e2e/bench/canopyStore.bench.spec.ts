import { expect, test } from "@playwright/test";
import { markdownTable, ms } from "./stats";

/**
 * A8b — what `CanopyTileStore` saves, against the real host.
 *
 * A8a measured one read of one area. The store exists because the app does not
 * make one read: the viewport follows the camera and the route corridor does not,
 * and both want overlapping canopy. So the figure that matters here is not the
 * cost of a read — it is the cost of a **sequence** of overlapping reads, with and
 * without the store between them, which is the gap A8a's benchmark left open when
 * it reported requested against transferred bytes and named closing it as A8b's
 * job.
 *
 * Three claims, in the order they are tested:
 *
 * - **The store is cheaper.** A corridor walked in overlapping steps transfers
 *   materially fewer bytes and makes materially fewer requests through one store
 *   than through a fresh store per step, which is what A8a's reader amounts to.
 * - **The store is not lossy.** Every step returns byte-identical pixels either
 *   way. A cache that changes the answer is worse than no cache.
 * - **The store does what A8a refused to.** An area straddling a zoom 10 boundary
 *   returns one stitched raster from two published COGs; `readCanopyHeights`
 *   throws on it by design.
 *
 * **Chromium's HTTP cache is disabled for the whole run.** Without that the
 * uncached arm is served its repeat ranges out of the browser cache with
 * `Content-Length` intact, and the comparison measures Chromium rather than the
 * store.
 *
 * Runs on demand only (`npm run bench:canopy`, its own config). Like A8a's it
 * talks to a third-party host, so it never runs in CI and its numbers are quoted
 * with the machine and date they were taken on.
 */

/** The A3 corpus centre for Madrid, so every canopy measurement names one place. */
const MADRID: [number, number] = [-3.7038, 40.4168];

/** Longitude of the zoom 10 tile boundary west of Madrid — two COGs meet here. */
const TILE_SEAM_LON = -3.8671875;

/** A route corridor walked as overlapping viewport-sized boxes. */
const BOX_M = 2000;
const STEP_M = 600;
const STEPS = 5;

interface SequenceMeasurement {
  label: string;
  requests: number;
  requestedBytes: number;
  transferredBytes: number;
  totalMs: number;
  /** One per step, so the two arms can be compared pixel for pixel. */
  checksums: string[];
  blockHits: number;
  blockMisses: number;
  runsFetched: number;
}

test("a canopy tile store pays for itself across overlapping reads", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });

  await page.goto("/e2e/bench/canopyStoreHarness.html");
  await page.waitForFunction(() => window.__umbraCanopyStore?.ready === true);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });

  const perRead = await measureSequence(page, "a store per read", false);
  const shared = await measureSequence(page, "one shared store", true);

  console.log(`\n${renderReport([perRead, shared])}\n`);

  expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);

  // The claim: overlapping reads share blocks rather than re-fetching them.
  expect(shared.transferredBytes).toBeLessThan(perRead.transferredBytes);
  expect(shared.requests).toBeLessThan(perRead.requests);
  expect(shared.blockHits).toBeGreaterThan(0);
  // ...and the saving is not a rounding error at this overlap.
  expect(shared.transferredBytes).toBeLessThan(perRead.transferredBytes * 0.8);

  // And the answer is the same either way, step for step.
  expect(shared.checksums).toEqual(perRead.checksums);
});

test("a canopy tile store stitches an area spanning two published tiles", async ({ page }) => {
  await page.goto("/e2e/bench/canopyStoreHarness.html");
  await page.waitForFunction(() => window.__umbraCanopyStore?.ready === true);

  const result = await page.evaluate(
    async ([lon, lat, side]) => {
      const store = window.__umbraCanopyStore.createCanopyTileStore();
      const half = side / 2;
      const dLat = half / 111_320;
      const dLon = half / (111_320 * Math.cos((lat * Math.PI) / 180));
      const startedAt = performance.now();
      const patch = await store.read([lon - dLon, lat - dLat, lon + dLon, lat + dLat]);
      let canopyPixels = 0;
      let maxHeightM = 0;
      for (const h of patch.heights) {
        if (h > 0) canopyPixels += 1;
        if (h > maxHeightM) maxHeightM = h;
      }
      return {
        quadkeys: patch.quadkeys,
        width: patch.width,
        height: patch.height,
        metresPerPixel: patch.metresPerPixel,
        validIsNull: patch.valid === null,
        invalidShare: patch.valid
          ? [...patch.valid].filter((v) => v === 0).length / patch.valid.length
          : 0,
        canopyPixelShare: canopyPixels / patch.heights.length,
        maxHeightM,
        totalMs: performance.now() - startedAt,
      };
    },
    [TILE_SEAM_LON, MADRID[1], BOX_M] as const,
  );

  console.log(
    `\n  ${result.quadkeys.join(" + ")} → ${result.width}x${result.height} @ ${result.metresPerPixel.toFixed(2)} m/px` +
      ` in ${ms(result.totalMs)} ms, ${(result.canopyPixelShare * 100).toFixed(1)}% canopy,` +
      ` validity ${result.validIsNull ? "all valid" : `${(result.invalidShare * 100).toFixed(2)}% blank`}\n`,
  );

  // Two published COGs, one raster. This is the read `readCanopyHeights` throws on.
  expect(result.quadkeys).toHaveLength(2);
  expect(result.width * result.height).toBeGreaterThan(0);
  // A decoded height band and not the 1-bit mask, which is entirely ones.
  expect(result.maxHeightM).toBeGreaterThan(1);
  expect(result.maxHeightM).toBeLessThan(120);
  expect(result.canopyPixelShare).toBeGreaterThan(0);
  expect(result.canopyPixelShare).toBeLessThan(1);
});

/** Walk the corridor once, counting every byte that crosses the wire. */
async function measureSequence(
  page: import("@playwright/test").Page,
  label: string,
  shareStore: boolean,
): Promise<SequenceMeasurement> {
  const measured = await page.evaluate(
    async ([lon, lat, side, stepM, steps, share]) => {
      // Count what the library asks for and what comes back, as A8a's benchmark
      // does — headers are exact, and readable because the host sends
      // `access-control-expose-headers: *`.
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

      try {
        const shared = window.__umbraCanopyStore.createCanopyTileStore();
        const checksums: string[] = [];
        const startedAt = performance.now();

        for (let step = 0; step < (steps as number); step++) {
          // Eastward, the way a corridor is followed: consecutive boxes overlap
          // by most of their width, which is the case the store is built for.
          const centreLon = lon + (step * stepM) / (111_320 * Math.cos((lat * Math.PI) / 180));
          const half = side / 2;
          const dLat = half / 111_320;
          const dLon = half / (111_320 * Math.cos((lat * Math.PI) / 180));
          const store = share ? shared : window.__umbraCanopyStore.createCanopyTileStore();
          const patch = await store.read([
            centreLon - dLon,
            lat - dLat,
            centreLon + dLon,
            lat + dLat,
          ]);

          let sum = 0;
          for (const h of patch.heights) sum = (sum * 31 + h) >>> 0;
          checksums.push(`${patch.width}x${patch.height}:${sum}`);
        }

        const stats = shared.stats();
        return {
          requests,
          requestedBytes,
          transferredBytes,
          totalMs: performance.now() - startedAt,
          checksums,
          blockHits: share ? stats.blockHits : 0,
          blockMisses: share ? stats.blockMisses : 0,
          runsFetched: share ? stats.runsFetched : 0,
        };
      } finally {
        window.fetch = nativeFetch;
      }
    },
    [MADRID[0], MADRID[1], BOX_M, STEP_M, STEPS, shareStore] as const,
  );

  return { label, ...measured };
}

/** The table, ready to paste into the note. */
function renderReport(results: SequenceMeasurement[]): string {
  const kb = (b: number) => `${(b / 1024).toFixed(1)} KB`;
  const baseline = results[0];
  return markdownTable(
    ["arm", "requests", "requested", "transferred", "vs baseline", "total", "block hits/misses"],
    results.map((r) => [
      r.label,
      String(r.requests),
      kb(r.requestedBytes),
      kb(r.transferredBytes),
      `${((r.transferredBytes / baseline.transferredBytes) * 100).toFixed(0)}%`,
      `${ms(r.totalMs)} ms`,
      r.runsFetched > 0 ? `${r.blockHits}/${r.blockMisses}` : "—",
    ]),
  );
}

declare global {
  interface Window {
    __umbraCanopyStore: {
      ready: boolean;
      createCanopyTileStore: () => {
        read(aoi: [number, number, number, number]): Promise<{
          heights: Uint8Array;
          valid: Uint8Array | null;
          width: number;
          height: number;
          metresPerPixel: number;
          quadkeys: string[];
        }>;
        stats(): { blockHits: number; blockMisses: number; runsFetched: number };
      };
    };
  }
}
