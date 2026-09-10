/**
 * A8b — `CanopyTileStore`, the thing two consumers read canopy heights through.
 *
 * A8a proved one route-sized area of the Meta/WRI canopy height map is a few
 * hundred kilobytes away from a page with no server, and deliberately stopped
 * there: `readCanopyHeights` reads one published quadkey and throws on an area
 * spanning two. This is the part that was deferred, and the reason it was deferred
 * is that the app has **two independent consumers with independent lifecycles** —
 * the viewport, which follows the camera, and the route corridor, which does not.
 * Something has to sit between them and the network or they will fetch the same
 * bytes twice, and the corridor will inherit the camera's coupling.
 *
 * So the store owns exactly three things, and they are the checkpoint:
 *
 * - **Dedupe.** Caching is per *block* of the COG's own 512x512 tiling, not per
 *   read and not per published quadkey. A whole quadkey at the 1.8 m level is
 *   64 MP; a block is 0.26 MP, it is the unit a range request already fetches, and
 *   it is the unit two overlapping areas of interest actually share. Two reads
 *   overlapping by half fetch the half that is missing, not the whole second area.
 * - **Cancel.** A block fetch is shared by every read that wants it, so one
 *   consumer walking away must not cancel the other consumer's read. Fetches are
 *   reference-counted and aborted only when the last waiter leaves.
 * - **Retry.** A8a watched `source.coop` return 504s, truncated bodies and a 300 s
 *   timeout after a few hundred requests. Backoff belongs here, once, rather than
 *   in each caller.
 *
 * **Still no routing effect.** Nothing here reaches `ShadowField`, the renderer or
 * a component — that is A8d, and this file names none of them.
 *
 * Two decisions worth stating rather than leaving to be inferred:
 *
 * **The validity mask is read** (`cogTileSource.ts`). A8a read heights alone, where
 * `0` means "no canopy detected" and a nodata stamp is indistinguishable from a
 * correct answer. `CanopyPatch.valid` is the difference, and `null` there is the
 * honest and cheap way to say "all of it".
 *
 * **Building masking does not happen here.** A8c settled *that* footprints are
 * subtracted — it costs at most 17.4% of apparent canopy — and left *where* open.
 * It happens in `ShadowField` (A8d), because the footprints live there: this module
 * has no map, no Overpass and no camera, which is exactly what lets its behaviour
 * be tested against a fake source with no network. A store that had to fetch
 * buildings to answer a raster question would have re-acquired the coupling it
 * exists to remove.
 *
 * The pixel arithmetic is in `blockGrid.ts`, the `geotiff.js` shell in
 * `cogTileSource.ts`, and this file is policy. What it saves against the live host
 * is measured in `docs/notes/canopy-tile-store-2026-09-10.md`.
 */

import {
  type WorldFrame,
  blit,
  blocksForWindow,
  intersectWindows,
  runWindow,
  runsFor,
  tileExtent,
  worldFrameFor,
  worldWindowBbox,
} from "./blockGrid";
import { TARGET_GROUND_RES_M } from "./canopyCog";
import {
  type CanopyTileHandle,
  type CanopyTileSource,
  type CanopyWindowPixels,
  createCogTileSource,
} from "./cogTileSource";
import {
  CANOPY_TILE_ZOOM,
  type LonLatBbox,
  type MercatorBbox,
  type PixelWindow,
  pixelWindowFor,
  quadkeyFor,
  quadkeysForBbox,
  selectOverview,
  tileXYForQuadkey,
} from "./tiles";

/**
 * Decoded pixels the store will hold, in bytes.
 *
 * **Bytes, not blocks**, because a block is not a fixed amount of ground. The
 * 1.82 m overview is 2.39 mercator metres per pixel everywhere, which is 1.82 m on
 * the ground at Madrid and 2.39 m at Singapore — so Singapore falls through to the
 * next level down and pays roughly four times the pixels for the same area. A
 * budget counted in tiles would be wrong by 4x between two cities in the same
 * corpus.
 *
 * 64 MB is about a 5 km Singapore corridor (~37 MB) alongside a viewport, or
 * several Madrid ones (~9 MB each). It is a ceiling on retained pixels, not on a
 * single read: a read pins the blocks it needs, so an area of interest larger than
 * the budget still succeeds and simply keeps nothing afterwards.
 */
export const DEFAULT_MAX_CACHE_BYTES = 64 * 1024 * 1024;

/**
 * The largest area of interest the store will compose, in pixels.
 *
 * A guard, not a policy: the viewport consumer hands over whatever the camera is
 * looking at, and a zoomed-out camera would otherwise ask for a continent and get
 * a multi-gigabyte allocation attempt rather than an error naming the problem.
 */
export const DEFAULT_MAX_PIXELS = 32 * 1024 * 1024;

/** Published COGs kept open. An area of interest spans at most four in practice. */
const MAX_OPEN_TILES = 8;

/** Canopy heights over an area of interest, stitched across published quadkeys. */
export interface CanopyPatch {
  /** Canopy height in whole metres, row-major, north-west origin. */
  heights: Uint8Array;
  /**
   * `1` where the model produced an answer, `0` where the raster is blank —
   * or `null` when every pixel is valid, which is the ordinary case.
   *
   * Read it before believing a `0` height. Without it "no canopy here" and "this
   * raster was never populated here" are the same byte.
   */
  valid: Uint8Array | null;
  width: number;
  height: number;
  /** What the pixels actually cover, which is never exactly the area asked for. */
  bbox: LonLatBbox;
  /** Ground metres per pixel at the area's centre latitude. */
  metresPerPixel: number;
  /** The IFD index read, for the record. Full resolution is 0. */
  overviewIndex: number;
  /** Every published quadkey that contributed, in row-major order. */
  quadkeys: string[];
}

/** What the store has done since it was created. The benchmark reports these. */
export interface CanopyStoreStats {
  cachedBlocks: number;
  cachedBytes: number;
  /** Blocks answered from cache or from a fetch already in flight. */
  blockHits: number;
  /** Blocks that had to be fetched. */
  blockMisses: number;
  /** Calls that reached the source — one per run of consecutive blocks. */
  runsFetched: number;
  retries: number;
  evictions: number;
}

export interface CanopyReadOptions {
  targetGroundRes?: number;
  signal?: AbortSignal;
}

export interface CanopyTileStore {
  read(aoi: LonLatBbox, options?: CanopyReadOptions): Promise<CanopyPatch>;
  stats(): CanopyStoreStats;
  /** Drop every cached block. In-flight fetches are left to their waiters. */
  clear(): void;
}

export interface CanopyTileStoreOptions {
  /** Defaults to the live `source.coop` reader. Tests supply a fake. */
  source?: CanopyTileSource;
  baseUrl?: string;
  targetGroundRes?: number;
  maxCacheBytes?: number;
  maxPixels?: number;
  /** Attempts per source call, the first included. */
  maxAttempts?: number;
  retryBaseDelayMs?: number;
  /** Injected so retry backoff does not put a real delay in a unit test. */
  sleep?: (ms: number) => Promise<void>;
}

/** One block of one published quadkey at one level, decoded. */
interface CachedBlock {
  heights: Uint8Array;
  valid: Uint8Array | null;
  width: number;
  height: number;
  /** Where the block sits in its own quadkey's pixel grid. */
  originX: number;
  originY: number;
  bytes: number;
}

/**
 * One in-flight fetch of consecutive blocks, and the reads waiting on it.
 *
 * The reference count is the whole cancellation story: a read registers as a waiter
 * on every fetch it depends on and releases them when it settles, and the fetch is
 * aborted only when the count reaches zero. Aborting on the first consumer's signal
 * instead — the obvious implementation — would let a camera pan cancel the route
 * corridor's read, which is the coupling this checkpoint exists to remove.
 */
interface PendingRun {
  promise: Promise<void>;
  controller: AbortController;
  waiters: number;
  settled: boolean;
}

/** One published quadkey's contribution to a single read. */
interface TilePlan {
  quadkey: string;
  handle: CanopyTileHandle;
  levelIndex: number;
  blockSize: number;
  imageWidth: number;
  imageHeight: number;
  /** World-pixel origin of this quadkey at this level. */
  originX: number;
  originY: number;
  /** The part of the read's window inside this quadkey, in tile-local pixels. */
  window: PixelWindow;
}

export function createCanopyTileStore(options: CanopyTileStoreOptions = {}): CanopyTileStore {
  const source = options.source ?? createCogTileSource({ baseUrl: options.baseUrl });
  const defaultGroundRes = options.targetGroundRes ?? TARGET_GROUND_RES_M;
  const maxCacheBytes = options.maxCacheBytes ?? DEFAULT_MAX_CACHE_BYTES;
  const maxPixels = options.maxPixels ?? DEFAULT_MAX_PIXELS;
  const maxAttempts = options.maxAttempts ?? 3;
  const retryBaseDelayMs = options.retryBaseDelayMs ?? 300;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  // Insertion order is the LRU order; a hit re-inserts.
  const cache = new Map<string, CachedBlock>();
  const inFlight = new Map<string, PendingRun>();
  const pins = new Map<string, number>();
  const handles = new Map<string, Promise<CanopyTileHandle>>();
  let cachedBytes = 0;
  const counters = { blockHits: 0, blockMisses: 0, runsFetched: 0, retries: 0, evictions: 0 };

  // ─── Retry ──────────────────────────────────────────────────────────────────

  async function withRetry<T>(op: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        counters.retries += 1;
        await sleep(retryBaseDelayMs * 2 ** (attempt - 1));
      }
      // A read nobody is waiting for any more is not worth another attempt, and
      // an abort is not the kind of failure backoff fixes.
      if (signal?.aborted) throw abortError();
      try {
        return await op();
      } catch (error) {
        if (signal?.aborted) throw error;
        lastError = error;
      }
    }
    throw lastError;
  }

  // ─── Open ───────────────────────────────────────────────────────────────────

  /**
   * Open a published COG, once, shared.
   *
   * Deliberately not cancellable. The IFD chain walk is a few kilobytes, it is the
   * one thing every consumer of this quadkey needs, and refcounting it would buy
   * back less than it cost. A caller's signal still ends its own wait.
   */
  function openTile(quadkey: string, signal?: AbortSignal): Promise<CanopyTileHandle> {
    const existing = handles.get(quadkey);
    if (existing) {
      handles.delete(quadkey);
      handles.set(quadkey, existing);
      return raceAbort(existing, signal);
    }

    const promise = withRetry(() => source.open(quadkey)).catch((error) => {
      // Never cache a failed open as "this quadkey does not exist".
      if (handles.get(quadkey) === promise) handles.delete(quadkey);
      throw error;
    });
    promise.catch(() => {});
    handles.set(quadkey, promise);
    while (handles.size > MAX_OPEN_TILES) {
      const oldest = handles.keys().next().value;
      if (oldest === undefined) break;
      handles.delete(oldest);
    }
    return raceAbort(promise, signal);
  }

  // ─── Cache ──────────────────────────────────────────────────────────────────

  function touch(key: string): CachedBlock | undefined {
    const block = cache.get(key);
    if (!block) return undefined;
    cache.delete(key);
    cache.set(key, block);
    return block;
  }

  function store(key: string, block: CachedBlock): void {
    const previous = cache.get(key);
    if (previous) {
      cachedBytes -= previous.bytes;
      cache.delete(key);
    }
    cache.set(key, block);
    cachedBytes += block.bytes;
  }

  function evict(): void {
    for (const [key, block] of cache) {
      if (cachedBytes <= maxCacheBytes) break;
      // A block a read is still composing from is not a candidate, whatever the
      // budget says: dropping it would compose a hole into the raster.
      if (pins.has(key)) continue;
      cache.delete(key);
      cachedBytes -= block.bytes;
      counters.evictions += 1;
    }
  }

  function pin(key: string): void {
    pins.set(key, (pins.get(key) ?? 0) + 1);
  }

  function unpin(key: string): void {
    const count = (pins.get(key) ?? 0) - 1;
    if (count > 0) pins.set(key, count);
    else pins.delete(key);
  }

  // ─── Read ───────────────────────────────────────────────────────────────────

  async function read(aoi: LonLatBbox, readOptions: CanopyReadOptions = {}): Promise<CanopyPatch> {
    const { signal } = readOptions;
    if (signal?.aborted) throw abortError();

    const centreLon = (aoi[0] + aoi[2]) / 2;
    const centreLat = (aoi[1] + aoi[3]) / 2;
    const targetGroundRes = readOptions.targetGroundRes ?? defaultGroundRes;

    // The tile under the centre fixes the level, and therefore the pixel grid the
    // whole read is expressed in. Every other quadkey is required to publish the
    // same level width, so the stitched raster has one resolution rather than a
    // seam where two COGs disagreed.
    const anchorKey = quadkeyFor(centreLon, centreLat);
    const anchor = await openTile(anchorKey, signal);
    const tileSpan = anchor.tileBbox[2] - anchor.tileBbox[0];
    const overview = selectOverview(anchor.levels, tileSpan, centreLat, targetGroundRes);

    const [anchorX, anchorY] = tileXYForQuadkey(anchorKey);
    const frame = worldFrameFor(anchor.tileBbox, anchorX, anchorY, overview.width);
    const window = worldWindowFor(aoi, frame);

    const pixels = (window[2] - window[0]) * (window[3] - window[1]);
    if (pixels > maxPixels) {
      throw new Error(
        `canopy area of interest is ${pixels} pixels at ${overview.groundRes.toFixed(2)} m, over the ${maxPixels} limit; read a smaller box or raise maxPixels`,
      );
    }

    const plans = await planTiles(aoi, window, frame, anchorKey, anchor, overview.width, signal);
    if (plans.length === 0) {
      throw new Error("area of interest does not overlap any published canopy tile");
    }

    const pinned: string[] = [];
    try {
      const needed = collectBlocks(plans);
      for (const block of needed) {
        pin(block.key);
        pinned.push(block.key);
      }

      const waitOn = new Set<PendingRun>();
      const missing = new Map<TilePlan, { col: number; row: number }[]>();
      for (const block of needed) {
        if (touch(block.key)) {
          counters.blockHits += 1;
          continue;
        }
        const pending = inFlight.get(block.key);
        if (pending) {
          counters.blockHits += 1;
          waitOn.add(pending);
          continue;
        }
        counters.blockMisses += 1;
        const list = missing.get(block.plan);
        if (list) list.push(block);
        else missing.set(block.plan, [block]);
      }

      for (const [plan, blocks] of missing) {
        for (const run of runsFor(blocks)) {
          waitOn.add(startRun(plan, run));
        }
      }

      for (const pending of waitOn) pending.waiters += 1;
      try {
        await raceAbort(
          Promise.all([...waitOn].map((pending) => pending.promise)),
          signal,
        );
      } finally {
        for (const pending of waitOn) {
          pending.waiters -= 1;
          if (pending.waiters <= 0 && !pending.settled) pending.controller.abort();
        }
      }

      return compose(needed, window, frame, plans, overview.index, overview.groundRes);
    } finally {
      for (const key of pinned) unpin(key);
      evict();
    }
  }

  /** Which quadkeys the read touches, opened, with their level resolved. */
  async function planTiles(
    aoi: LonLatBbox,
    window: PixelWindow,
    frame: WorldFrame,
    anchorKey: string,
    anchor: CanopyTileHandle,
    levelWidth: number,
    signal?: AbortSignal,
  ): Promise<TilePlan[]> {
    const candidates = quadkeysForBbox(aoi).map((quadkey) => {
      const [tileX, tileY] = tileXYForQuadkey(quadkey);
      return { quadkey, tileX, tileY, overlap: intersectWindows(window, tileExtent(frame, tileX, tileY)) };
    });

    return Promise.all(
      candidates
        .filter((candidate) => candidate.overlap !== null)
        .map(async ({ quadkey, tileX, tileY, overlap }) => {
          const handle = quadkey === anchorKey ? anchor : await openTile(quadkey, signal);
          const level = handle.levels.find((candidate) => candidate.width === levelWidth);
          if (!level) {
            throw new Error(
              `canopy tile ${quadkey} publishes no ${levelWidth}px level; it cannot be stitched with ${anchorKey}`,
            );
          }
          const grid = await handle.grid(level.index);
          const originX = tileX * frame.tilePixels;
          const originY = tileY * frame.tilePixels;
          const local = overlap as PixelWindow;
          return {
            quadkey,
            handle,
            levelIndex: level.index,
            blockSize: grid.blockSize,
            imageWidth: grid.width,
            imageHeight: grid.height,
            originX,
            originY,
            window: [
              local[0] - originX,
              local[1] - originY,
              local[2] - originX,
              local[3] - originY,
            ] as PixelWindow,
          };
        }),
    );
  }

  function collectBlocks(plans: TilePlan[]): { key: string; col: number; row: number; plan: TilePlan }[] {
    const blocks: { key: string; col: number; row: number; plan: TilePlan }[] = [];
    for (const plan of plans) {
      for (const { col, row } of blocksForWindow(plan.window, plan.blockSize)) {
        blocks.push({ key: blockKey(plan, col, row), col, row, plan });
      }
    }
    return blocks;
  }

  function startRun(plan: TilePlan, run: { row: number; firstCol: number; lastCol: number }): PendingRun {
    const controller = new AbortController();
    const keys: string[] = [];
    for (let col = run.firstCol; col <= run.lastCol; col++) keys.push(blockKey(plan, col, run.row));

    const pending: PendingRun = {
      promise: Promise.resolve(),
      controller,
      waiters: 0,
      settled: false,
    };
    pending.promise = (async () => {
      const window = runWindow(run, plan.blockSize, plan.imageWidth, plan.imageHeight);
      try {
        counters.runsFetched += 1;
        const pixels = await withRetry(
          () => plan.handle.read(plan.levelIndex, window, controller.signal),
          controller.signal,
        );
        storeRun(plan, run, window, pixels);
      } finally {
        pending.settled = true;
        for (const key of keys) {
          if (inFlight.get(key) === pending) inFlight.delete(key);
        }
      }
    })();
    // Waiters get the rejection through their own continuation; this only stops an
    // abandoned run from surfacing as an unhandled rejection.
    pending.promise.catch(() => {});

    for (const key of keys) inFlight.set(key, pending);
    return pending;
  }

  /** Split one fetched run back into the blocks the cache is keyed by. */
  function storeRun(
    plan: TilePlan,
    run: { row: number; firstCol: number; lastCol: number },
    window: PixelWindow,
    pixels: CanopyWindowPixels,
  ): void {
    const runWidth = window[2] - window[0];
    const runHeight = window[3] - window[1];

    for (let col = run.firstCol; col <= run.lastCol; col++) {
      const x0 = col * plan.blockSize;
      const width = Math.min(window[2], x0 + plan.blockSize) - x0;
      const height = runHeight;

      const heights = new Uint8Array(width * height);
      blit(heights, width, height, x0, window[1], pixels.heights, runWidth, runHeight, window[0], window[1]);

      let valid: Uint8Array | null = null;
      if (pixels.valid) {
        const slice = new Uint8Array(width * height);
        blit(slice, width, height, x0, window[1], pixels.valid, runWidth, runHeight, window[0], window[1]);
        valid = slice.includes(0) ? slice : null;
      }

      store(blockKey(plan, col, run.row), {
        heights,
        valid,
        width,
        height,
        originX: x0,
        originY: window[1],
        bytes: heights.length + (valid?.length ?? 0),
      });
    }
  }

  function compose(
    needed: { key: string; plan: TilePlan }[],
    window: PixelWindow,
    frame: WorldFrame,
    plans: TilePlan[],
    overviewIndex: number,
    metresPerPixel: number,
  ): CanopyPatch {
    const width = window[2] - window[0];
    const height = window[3] - window[1];
    const heights = new Uint8Array(width * height);
    let valid: Uint8Array | null = null;

    for (const { key, plan } of needed) {
      const block = cache.get(key);
      if (!block) throw new Error(`canopy block ${key} was dropped while the read still needed it`);
      const originX = plan.originX + block.originX;
      const originY = plan.originY + block.originY;

      blit(heights, width, height, window[0], window[1], block.heights, block.width, block.height, originX, originY);
      if (block.valid) {
        if (!valid) {
          // Every block composed before this one was fully valid, which is why
          // there was no array; ones is the correct history for them.
          valid = new Uint8Array(width * height).fill(1);
        }
        blit(valid, width, height, window[0], window[1], block.valid, block.width, block.height, originX, originY);
      }
    }

    return {
      heights,
      valid,
      width,
      height,
      bbox: worldWindowBbox(window, frame),
      metresPerPixel,
      overviewIndex,
      quadkeys: plans.map((plan) => plan.quadkey),
    };
  }

  return {
    read,
    stats: () => ({
      cachedBlocks: cache.size,
      cachedBytes,
      ...counters,
    }),
    clear: () => {
      cache.clear();
      cachedBytes = 0;
    },
  };
}

/** A block is identified by its quadkey, its level's width and its grid position. */
function blockKey(plan: TilePlan, col: number, row: number): string {
  return `${plan.quadkey}/${plan.imageWidth}/${row}/${col}`;
}

/**
 * The area of interest as a window on the world pixel grid.
 *
 * Expressed against the whole zoom 10 grid rather than one COG, so the clamping and
 * outward rounding happen once for the read instead of once per quadkey — which is
 * what stops two adjacent tiles rounding their shared edge in opposite directions.
 */
function worldWindowFor(aoi: LonLatBbox, frame: WorldFrame): PixelWindow {
  const worldPixels = frame.tilePixels * 2 ** CANOPY_TILE_ZOOM;
  const worldSpan = worldPixels * frame.res;
  const worldBbox: MercatorBbox = [
    frame.originX,
    frame.originY - worldSpan,
    frame.originX + worldSpan,
    frame.originY,
  ];
  return pixelWindowFor(aoi, worldBbox, worldPixels, worldPixels);
}

function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

function abortError(): Error {
  return new DOMException("canopy read aborted", "AbortError");
}
