import { describe, expect, it } from "vitest";
import { createCanopyTileStore } from "../canopyTileStore";
import type { CanopyTileHandle, CanopyTileSource } from "../cogTileSource";
import {
  CANOPY_TILE_ZOOM,
  type LonLatBbox,
  type MercatorBbox,
  type OverviewCandidate,
  type PixelWindow,
  lonLatToMercator,
  quadkeyFor,
  tileXYForQuadkey,
} from "../tiles";

/**
 * `CanopyTileStore` against a fake COG.
 *
 * Everything the store is for — dedupe, cancellation, retry, eviction, stitching
 * across published quadkeys — is behaviour under concurrency and failure, which is
 * exactly what a live-network test cannot pin down and a fake source can. The one
 * thing this deliberately does not test is `geotiff.js`: that is `cogTileSource.ts`,
 * and `npm run bench:canopy` is where it meets the real host.
 */

const WORLD_SPAN = 2 * Math.PI * 6378137;
const TILE_SPAN = WORLD_SPAN / 2 ** CANOPY_TILE_ZOOM;

/**
 * A smaller IFD chain than the real dataset's, in the same shape.
 *
 * Scaled down so a route-sized area is a few hundred pixels rather than a few
 * thousand: these tests decode every pixel in JavaScript, and the arithmetic under
 * test is indifferent to how many there are.
 */
const LEVELS: OverviewCandidate[] = [
  { index: 0, width: 4096 },
  { index: 2, width: 2048 },
  { index: 3, width: 1024 },
];
const BLOCK = 256;

/** The level `TARGET_RES_M` selects at Madrid, named so the tests can georeference. */
const LEVEL_WIDTH = 2048;

/** Picks the 2048 level at Madrid (14.5 m on the ground), i.e. not the finest. */
const TARGET_RES_M = 16;

const MADRID: [number, number] = [-3.7038, 40.4168];

/** The zoom 10 tile corner nearest Madrid — a point four published COGs meet at. */
const TILE_SEAM_LON = -3.8671875;
const TILE_SEAM_LAT = 40.4469470596005;

/**
 * Height as a function of position on the world pixel grid.
 *
 * Linear in x and y on purpose. Every stitching failure this store can have —
 * a block placed at the wrong offset, a seam between two quadkeys, a run split
 * that drops a column — shows up as a break in that linearity, and the test can
 * check it without re-deriving the store's own window arithmetic.
 */
const worldValue = (x: number, y: number) => (x * 3 + y) & 0xff;

interface FakeRead {
  quadkey: string;
  window: PixelWindow;
  signal?: AbortSignal;
}

interface FakeOptions {
  /** Awaited inside every read, so a test can hold fetches open. */
  gate?: () => Promise<void>;
  failFirstReads?: number;
  invalidAt?: (worldX: number, worldY: number) => boolean;
  onReadStart?: () => void;
  onReadEnd?: () => void;
}

function createFakeSource(options: FakeOptions = {}) {
  const reads: FakeRead[] = [];
  let opens = 0;
  let readAttempts = 0;

  const source: CanopyTileSource = {
    async open(quadkey) {
      opens += 1;
      const [tileX, tileY] = tileXYForQuadkey(quadkey);
      const tileBbox: MercatorBbox = [
        -WORLD_SPAN / 2 + tileX * TILE_SPAN,
        WORLD_SPAN / 2 - (tileY + 1) * TILE_SPAN,
        -WORLD_SPAN / 2 + (tileX + 1) * TILE_SPAN,
        WORLD_SPAN / 2 - tileY * TILE_SPAN,
      ];

      const handle: CanopyTileHandle = {
        quadkey,
        tileBbox,
        levels: LEVELS,
        async grid(levelIndex) {
          const level = LEVELS.find((candidate) => candidate.index === levelIndex);
          if (!level) throw new Error(`no level ${levelIndex}`);
          return { width: level.width, height: level.width, blockSize: BLOCK };
        },
        async read(levelIndex, window, signal) {
          const level = LEVELS.find((candidate) => candidate.index === levelIndex);
          if (!level) throw new Error(`no level ${levelIndex}`);
          reads.push({ quadkey, window: [...window] as PixelWindow, signal });
          options.onReadStart?.();
          readAttempts += 1;
          const attempt = readAttempts;
          if (options.gate) await options.gate();
          if (attempt <= (options.failFirstReads ?? 0)) {
            options.onReadEnd?.();
            throw new Error("source.coop said 504");
          }

          const width = window[2] - window[0];
          const height = window[3] - window[1];
          const heights = new Uint8Array(width * height);
          let valid: Uint8Array | null = null;
          for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
              const worldX = tileX * level.width + window[0] + x;
              const worldY = tileY * level.width + window[1] + y;
              heights[y * width + x] = worldValue(worldX, worldY);
              if (options.invalidAt?.(worldX, worldY)) {
                if (!valid) valid = new Uint8Array(width * height).fill(1);
                valid[y * width + x] = 0;
              }
            }
          }
          options.onReadEnd?.();
          return { heights, valid };
        },
      };
      return handle;
    },
  };

  return { source, reads, opens: () => opens };
}

function storeWith(options: FakeOptions = {}, storeOptions = {}) {
  const fake = createFakeSource(options);
  const store = createCanopyTileStore({
    source: fake.source,
    targetGroundRes: TARGET_RES_M,
    // Backoff is a real delay against a real host; in a unit test it is just a wait.
    sleep: async () => {},
    ...storeOptions,
  });
  return { ...fake, store };
}

/** A square area of interest, in degrees, centred on a point. */
function boxAround([lon, lat]: [number, number], sizeM: number): LonLatBbox {
  const dLat = sizeM / 2 / 111_320;
  const dLon = dLat / Math.cos((lat * Math.PI) / 180);
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
}

/** Let every pending microtask and timer callback run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Every pixel of a row follows from its first, or the raster has a seam in it. */
function expectRowIsContinuous(heights: Uint8Array, width: number, row: number): void {
  const base = heights[row * width];
  for (let x = 0; x < width; x++) {
    expect({ x, value: heights[row * width + x] }).toEqual({ x, value: (base + 3 * x) & 0xff });
  }
}

/**
 * The raster's first pixel is the pixel its own bbox says it is.
 *
 * Continuity catches a raster assembled wrongly; it cannot catch one assembled
 * consistently in the wrong place, and a whole-raster offset of one pixel is the
 * failure `tiles.ts` warns about — plausible heights for the wrong street. This
 * re-derives the world pixel from the reported bbox and asks the fake what should
 * be there.
 */
function expectGeoreferenced(patch: { heights: Uint8Array; bbox: LonLatBbox }): void {
  const res = TILE_SPAN / LEVEL_WIDTH;
  const [west] = lonLatToMercator(patch.bbox[0], 0);
  const [, north] = lonLatToMercator(0, patch.bbox[3]);
  const worldX = Math.round((west + WORLD_SPAN / 2) / res);
  const worldY = Math.round((WORLD_SPAN / 2 - north) / res);
  expect(patch.heights[0]).toBe(worldValue(worldX, worldY));
}

/** The same claim down a column, which is where a wrong block *row* shows up. */
function expectColumnIsContinuous(
  heights: Uint8Array,
  width: number,
  height: number,
  column: number,
): void {
  const base = heights[column];
  for (let y = 0; y < height; y++) {
    expect({ y, value: heights[y * width + column] }).toEqual({ y, value: (base + y) & 0xff });
  }
}

describe("createCanopyTileStore", () => {
  it("reads a route-sized area at the level the target resolution asks for", async () => {
    const { store, reads } = storeWith();
    const patch = await store.read(boxAround(MADRID, 4000));

    expect(patch.overviewIndex).toBe(2);
    expect(patch.metresPerPixel).toBeCloseTo(14.55, 1);
    expect(patch.quadkeys).toEqual([quadkeyFor(...MADRID)]);
    expect(patch.heights.length).toBe(patch.width * patch.height);
    expect(reads.length).toBeGreaterThan(0);
    expectGeoreferenced(patch);
    expectRowIsContinuous(patch.heights, patch.width, 0);
  });

  it("covers the area asked for, to within a pixel", async () => {
    const { store } = storeWith();
    const aoi = boxAround(MADRID, 4000);
    const patch = await store.read(aoi);

    // Outward-rounded: a route corridor is mostly edge, so a window that rounded
    // inward would drop the strip of canopy along the boundary.
    expect(patch.bbox[0]).toBeLessThanOrEqual(aoi[0]);
    expect(patch.bbox[1]).toBeLessThanOrEqual(aoi[1]);
    expect(patch.bbox[2]).toBeGreaterThanOrEqual(aoi[2]);
    expect(patch.bbox[3]).toBeGreaterThanOrEqual(aoi[3]);
  });

  it("stitches an area spanning four published quadkeys, with no seam", async () => {
    const { store } = storeWith();
    // This box straddles a tile boundary in both axes, so it is served by a 2x2
    // block of published COGs — the case `readCanopyHeights` refuses outright.
    const patch = await store.read(boxAround([TILE_SEAM_LON, TILE_SEAM_LAT], 10_000));

    expect(patch.quadkeys).toHaveLength(4);
    expectGeoreferenced(patch);
    // Both seams run through the middle of this raster. Composing it from four
    // tile-local windows is precisely what would put a step in these.
    expectRowIsContinuous(patch.heights, patch.width, Math.floor(patch.height / 2));
    expectColumnIsContinuous(
      patch.heights,
      patch.width,
      patch.height,
      Math.floor(patch.width / 2),
    );
  });

  it("answers a repeated area from cache without touching the source", async () => {
    const { store, reads } = storeWith();
    const aoi = boxAround(MADRID, 4000);
    await store.read(aoi);
    const afterFirst = reads.length;

    const patch = await store.read(aoi);
    expect(reads.length).toBe(afterFirst);
    expect(store.stats().blockMisses).toBe(store.stats().cachedBlocks);
    expectRowIsContinuous(patch.heights, patch.width, 0);
  });

  it("fetches only the blocks an overlapping area is missing", async () => {
    const { store, reads } = storeWith();
    await store.read(boxAround(MADRID, 8000));
    const afterFirst = reads.length;
    const missesAfterFirst = store.stats().blockMisses;

    // Shifted far enough east to need new blocks and to keep most of the old ones.
    const shifted = boxAround([MADRID[0] + 0.03, MADRID[1]], 8000);
    const patch = await store.read(shifted);

    expect(reads.length).toBeGreaterThan(afterFirst);
    expect(store.stats().blockHits).toBeGreaterThan(0);
    // The point of the store: the second read pays for the new blocks only.
    expect(store.stats().blockMisses - missesAfterFirst).toBeLessThan(missesAfterFirst);
    expectRowIsContinuous(patch.heights, patch.width, 0);
  });

  it("collapses two concurrent reads of the same area into one set of fetches", async () => {
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { store, reads } = storeWith({ gate: () => held });

    const aoi = boxAround(MADRID, 4000);
    const first = store.read(aoi);
    const second = store.read(aoi);
    await flush();

    const issued = reads.length;
    release();
    const [a, b] = await Promise.all([first, second]);

    expect(reads.length).toBe(issued);
    expect(store.stats().blockHits).toBeGreaterThan(0);
    expect([...a.heights]).toEqual([...b.heights]);
  });

  it("runs no more than four COG windows concurrently", async () => {
    let active = 0;
    let peak = 0;
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { store, reads } = storeWith({
      gate: () => held,
      onReadStart: () => {
        active++;
        peak = Math.max(peak, active);
      },
      onReadEnd: () => active--,
    });
    const pending = store.read(boxAround(MADRID, 20_000), { priority: "prefetch" });
    await flush();
    expect(reads).toHaveLength(4);
    expect(peak).toBe(4);
    release();
    await pending;
    expect(peak).toBe(4);
  });

  it("promotes a queued viewport block when a route joins it", async () => {
    const routeAoi = boxAround([MADRID[0] + 0.07, MADRID[1] - 0.07], 100);
    const reference = storeWith();
    await reference.store.read(routeAoi, { priority: "route" });
    const expected = reference.reads[0].window;

    let hold = true;
    const releases: Array<() => void> = [];
    const gated = storeWith({
      gate: () => hold
        ? new Promise<void>((resolve) => releases.push(resolve))
        : Promise.resolve(),
    });
    const background = gated.store.read(boxAround(MADRID, 20_000), { priority: "prefetch" });
    await flush();
    expect(gated.reads).toHaveLength(4);

    const route = gated.store.read(routeAoi, { priority: "route" });
    await flush();
    expect(gated.reads).toHaveLength(4);
    releases[0]();
    await flush();

    const promoted = gated.reads[4].window;
    expect(promoted[1]).toBeLessThanOrEqual(expected[1]);
    expect(promoted[3]).toBeGreaterThanOrEqual(expected[3]);

    hold = false;
    for (const release of releases) release();
    await Promise.all([background, route]);
  });

  it("keeps a shared fetch alive when one of two consumers walks away", async () => {
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { store, reads } = storeWith({ gate: () => held });

    const aoi = boxAround(MADRID, 4000);
    const abandoned = new AbortController();
    // The viewport consumer, which the camera is about to cancel...
    const viewport = store.read(aoi, { signal: abandoned.signal });
    // ...and the route corridor, which has its own lifecycle and must survive it.
    const corridor = store.read(aoi);
    await flush();

    abandoned.abort();
    await expect(viewport).rejects.toThrow();
    expect(reads.every((read) => read.signal?.aborted !== true)).toBe(true);

    release();
    const patch = await corridor;
    expectRowIsContinuous(patch.heights, patch.width, 0);
  });

  it("aborts a fetch once its last waiter is gone", async () => {
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { store, reads } = storeWith({ gate: () => held });

    const controller = new AbortController();
    const pending = store.read(boxAround(MADRID, 4000), { signal: controller.signal });
    await flush();

    controller.abort();
    await expect(pending).rejects.toThrow();
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.every((read) => read.signal?.aborted === true)).toBe(true);
    release();
  });

  it("retries a flaky host rather than failing the read", async () => {
    const { store } = storeWith({ failFirstReads: 1 });
    const patch = await store.read(boxAround(MADRID, 2000));

    expect(store.stats().retries).toBeGreaterThan(0);
    expectRowIsContinuous(patch.heights, patch.width, 0);
  });

  it("gives up after the attempt budget and reports the source's error", async () => {
    const { store } = storeWith({ failFirstReads: 99 }, { maxAttempts: 2 });
    await expect(store.read(boxAround(MADRID, 2000))).rejects.toThrow("504");
    expect(store.stats().cachedBlocks).toBe(0);
  });

  it("reports null validity when the model answered everywhere", async () => {
    const { store } = storeWith();
    const patch = await store.read(boxAround(MADRID, 2000));
    expect(patch.valid).toBeNull();
  });

  it("reports which pixels the raster never populated", { timeout: 10_000 }, async () => {
    // Thin stripes on a 512 pixel period, so some 256 pixel blocks carry a hole
    // and others are wholly valid — the case where composition has to fill in the
    // blocks it already placed without one.
    const { store } = storeWith({ invalidAt: (x) => x % 512 < 4 });
    const patch = await store.read(boxAround(MADRID, 8000));

    expect(patch.valid).not.toBeNull();
    const valid = patch.valid as Uint8Array;
    let zeros = 0;
    for (const v of valid) {
      expect(v === 0 || v === 1).toBe(true);
      if (v === 0) zeros += 1;
    }
    // 4 columns in every 512. A block left unfilled would be a sixteenth of the
    // raster, which this tolerance would not survive.
    expect(zeros / valid.length).toBeGreaterThan(0.004);
    expect(zeros / valid.length).toBeLessThan(0.015);
  });

  it("keeps the blocks a read is still composing from, whatever the budget says", async () => {
    const { store } = storeWith({}, { maxCacheBytes: 1 });
    const patch = await store.read(boxAround(MADRID, 8000));

    // Complete despite a budget that cannot hold a single block: the read pins
    // what it needs, and eviction takes it all back afterwards.
    expectRowIsContinuous(patch.heights, patch.width, 0);
    expect(store.stats().evictions).toBeGreaterThan(0);
    expect(store.stats().cachedBlocks).toBe(0);
  });

  it("does not let one read's eviction pull blocks out from under another's", async () => {
    // Both reads share the same fetches, so by the time the first composes, the
    // second's blocks are already cached and already unneeded by anyone else. A
    // budget this small evicts them the instant the first read's turn ends — and
    // the second read is still holding them.
    const { store } = storeWith({}, { maxCacheBytes: 1 });
    const aoi = boxAround(MADRID, 4000);
    const [first, second] = await Promise.all([store.read(aoi), store.read(aoi)]);

    expectRowIsContinuous(first.heights, first.width, 0);
    expectRowIsContinuous(second.heights, second.width, 0);
    expect([...first.heights]).toEqual([...second.heights]);
  });

  it("refuses an area too large to compose rather than attempting the allocation", async () => {
    const { store } = storeWith({}, { maxPixels: 100 });
    await expect(store.read(boxAround(MADRID, 8000))).rejects.toThrow(/maxPixels/);
  });

  it("opens each published quadkey once, however many reads want it", async () => {
    const { store, opens } = storeWith();
    await store.read(boxAround(MADRID, 2000));
    await store.read(boxAround(MADRID, 4000));
    expect(opens()).toBe(1);
  });

  it("drops everything on clear", async () => {
    const { store, reads } = storeWith();
    const aoi = boxAround(MADRID, 2000);
    await store.read(aoi);
    const afterFirst = reads.length;

    store.clear();
    expect(store.stats().cachedBlocks).toBe(0);
    await store.read(aoi);
    expect(reads.length).toBeGreaterThan(afterFirst);
  });
});
