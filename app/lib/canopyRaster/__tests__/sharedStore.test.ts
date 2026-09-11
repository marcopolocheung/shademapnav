import { describe, expect, it, vi } from "vitest";
import { createRasterCanopyProvider } from "../../shadowField/providers";
import type { CanopyPatch, CanopyTileStore } from "../canopyTileStore";

/**
 * The route corridor and the map layer must read through one `CanopyTileStore`, or
 * A8b's dedupe and refcounted cancellation have nothing to share. The real store is
 * replaced here so no test reaches `geotiff.js` or the network.
 */

const reads: Array<[number, number, number, number]> = [];

const fakeStore: CanopyTileStore = {
  async read(aoi) {
    reads.push(aoi);
    const patch: CanopyPatch = {
      heights: new Uint8Array(4),
      valid: null,
      width: 2,
      height: 2,
      bbox: aoi,
      metresPerPixel: 1,
      overviewIndex: 0,
      quadkeys: ["0331110121"],
    };
    return patch;
  },
  stats: () => ({
    cachedBlocks: 0,
    cachedBytes: 0,
    blockHits: 0,
    blockMisses: 0,
    runsFetched: 0,
    retries: 0,
    evictions: 0,
  }),
  clear: () => {},
};

const created = vi.fn(() => fakeStore);
vi.mock("../canopyTileStore", () => ({ createCanopyTileStore: () => created() }));

describe("sharedCanopyTileStore", () => {
  it("builds one store, however many consumers ask", async () => {
    const { sharedCanopyTileStore } = await import("../sharedStore");
    const [a, b] = await Promise.all([sharedCanopyTileStore(), sharedCanopyTileStore()]);
    expect(a).toBe(b);
    expect(await sharedCanopyTileStore()).toBe(a);
    expect(created).toHaveBeenCalledTimes(1);
  });

  it("is the store the route corridor's raster provider reads through", async () => {
    const provider = createRasterCanopyProvider();
    const before = reads.length;
    await provider.load?.({ west: -3.705, south: 40.416, east: -3.702, north: 40.418 });
    expect(reads.length).toBe(before + 1);
    expect(created).toHaveBeenCalledTimes(1);
  });
});
