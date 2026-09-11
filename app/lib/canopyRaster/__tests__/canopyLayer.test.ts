import { describe, expect, it } from "vitest";
import { CANOPY_LAYER_ID, CANOPY_SOURCE_ID, type CanopyLegendState, attachCanopyLayer } from "../canopyLayer";
import type { CanopyPatch } from "../canopyTileStore";
import type { LonLatBbox } from "../tiles";

/**
 * The canopy layer's lifecycle, against a fake map and a fake store.
 *
 * What it looks like is a browser question (`studies/canopy-paint-predicate.mjs` and a
 * look in `npm run dev`). What is testable here is the order of events: where the
 * layer goes, when a read is fired, which read is allowed to paint, and what the
 * legend is told.
 */

type Map = Parameters<typeof attachCanopyLayer>[0];

interface FakeLayer {
  id: string;
  sourceLayer?: string;
  layout: Record<string, unknown>;
}

function fakeMap(style: Array<{ id: string; sourceLayer?: string }>, view: { bbox: LonLatBbox; zoom: number }) {
  const order: string[] = style.map((l) => l.id);
  const layers = new globalThis.Map<string, FakeLayer>(style.map((l) => [l.id, { ...l, layout: {} }]));
  const sources = new globalThis.Map<string, { url: string; coordinates: number[][] }>();
  const handlers = new Set<() => void>();
  let current = view;

  const map = {
    on: (_: string, fn: () => void) => handlers.add(fn),
    off: (_: string, fn: () => void) => handlers.delete(fn),
    getZoom: () => current.zoom,
    getBounds: () => ({
      getWest: () => current.bbox[0],
      getSouth: () => current.bbox[1],
      getEast: () => current.bbox[2],
      getNorth: () => current.bbox[3],
    }),
    getCenter: () => ({ lng: (current.bbox[0] + current.bbox[2]) / 2, lat: (current.bbox[1] + current.bbox[3]) / 2 }),
    getSource: (id: string) => {
      const source = sources.get(id);
      return source && {
        updateImage: (next: { url: string; coordinates: number[][] }) => Object.assign(source, next),
      };
    },
    addSource: (id: string, spec: { url: string; coordinates: number[][] }) => {
      sources.set(id, { url: spec.url, coordinates: spec.coordinates });
    },
    addLayer: (layer: { id: string }, beforeId?: string) => {
      const at = beforeId === undefined ? order.length : order.indexOf(beforeId);
      order.splice(at, 0, layer.id);
      layers.set(layer.id, { id: layer.id, layout: {} });
    },
    getLayer: (id: string) => layers.get(id),
    getLayersOrder: () => [...order],
    setLayoutProperty: (id: string, key: string, value: unknown) => {
      const layer = layers.get(id);
      if (layer) layer.layout[key] = value;
    },
  };

  return {
    map: map as unknown as Map,
    order,
    source: () => sources.get(CANOPY_SOURCE_ID),
    visibility: () => layers.get(CANOPY_LAYER_ID)?.layout.visibility,
    moveTo(next: { bbox: LonLatBbox; zoom: number }) {
      current = next;
      for (const fn of handlers) fn();
    },
  };
}

/** A patch over exactly the area asked for, every pixel at one height. */
function patchOver(aoi: LonLatBbox, heightM: number): CanopyPatch {
  return {
    heights: new Uint8Array(16).fill(heightM),
    valid: null,
    width: 4,
    height: 4,
    bbox: aoi,
    metresPerPixel: 2,
    overviewIndex: 2,
    quadkeys: [],
  };
}

/** A store whose reads the test resolves by hand, in whatever order it likes. */
function manualStore(heightM = 30) {
  const pending: Array<{ aoi: LonLatBbox; signal?: AbortSignal; resolve: () => void; reject: (e: unknown) => void }> =
    [];
  const store = {
    read: (aoi: LonLatBbox, options?: { signal?: AbortSignal }) =>
      new Promise<CanopyPatch>((resolve, reject) => {
        pending.push({ aoi, signal: options?.signal, resolve: () => resolve(patchOver(aoi, heightM)), reject });
      }),
  };
  return { store, pending };
}

/** An always-answering store that keeps a list of what it was asked for. */
function recordingStore() {
  const reads: LonLatBbox[] = [];
  const store = {
    read: async (aoi: LonLatBbox) => {
      reads.push(aoi);
      return patchOver(aoi, 30);
    },
  };
  return { store, reads };
}

/** An always-answering store. */
const answering = (heightM = 30) => ({ read: async (aoi: LonLatBbox) => patchOver(aoi, heightM) });

const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

/** A ~1 km box. Paris is outside the three indexed imagery tiles; Madrid is inside one. */
const box = ([lon, lat]: [number, number], halfDeg = 0.0045): LonLatBbox => [
  lon - halfDeg,
  lat - halfDeg,
  lon + halfDeg,
  lat + halfDeg,
];
const PARIS: [number, number] = [2.3522, 48.8566];
const MADRID: [number, number] = [-3.7038, 40.4168];

const STYLE = [
  { id: "background" },
  { id: "park", sourceLayer: "park" },
  { id: "river", sourceLayer: "waterway" },
  { id: "water", sourceLayer: "water" },
  { id: "road", sourceLayer: "transportation" },
  { id: "local-shadow-layer" },
];

function attach(
  fake: ReturnType<typeof fakeMap>,
  store: { read: (aoi: LonLatBbox, options?: { signal?: AbortSignal }) => Promise<CanopyPatch> },
  enabled = true,
) {
  const legend: Array<CanopyLegendState | null> = [];
  let encoded = 0;
  const handle = attachCanopyLayer(fake.map, {
    belowLayerId: "local-shadow-layer",
    enabled,
    onChange: (state) => legend.push(state),
    getStore: async () => store,
    encode: async () => `blob:canopy-${++encoded}`,
  });
  return { handle, legend };
}

describe("the canopy layer", () => {
  it("goes in under the style's first water layer, below roads and the shadow layer", async () => {
    const fake = fakeMap(STYLE, { bbox: box(PARIS), zoom: 16 });
    const { legend } = attach(fake, answering());
    await flush();

    expect(fake.order.indexOf(CANOPY_LAYER_ID)).toBe(fake.order.indexOf("river") - 1);
    expect(fake.order.indexOf(CANOPY_LAYER_ID)).toBeLessThan(fake.order.indexOf("local-shadow-layer"));
    expect(fake.visibility()).toBe("visible");
    expect(legend.at(-1)).toEqual({ imagery: null });
  });

  it("goes directly under the shadow layer in a style with no water, never above it", async () => {
    const fake = fakeMap([{ id: "background" }, { id: "building" }, { id: "local-shadow-layer" }], {
      bbox: box(PARIS),
      zoom: 16,
    });
    attach(fake, answering());
    await flush();

    expect(fake.order).toEqual(["background", "building", CANOPY_LAYER_ID, "local-shadow-layer"]);
  });

  it("reads nothing below the zoom floor, and takes the fill and legend off when zoomed out", async () => {
    const { store, reads } = recordingStore();
    const fake = fakeMap(STYLE, { bbox: box(PARIS, 0.05), zoom: 13 });
    const { legend } = attach(fake, store);
    await flush();
    expect(reads).toHaveLength(0);
    expect(legend.filter(Boolean)).toHaveLength(0);

    fake.moveTo({ bbox: box(PARIS), zoom: 16 });
    await flush();
    expect(reads.length).toBeGreaterThan(0);
    expect(legend.at(-1)).not.toBeNull();

    fake.moveTo({ bbox: box(PARIS, 0.05), zoom: 12 });
    await flush();
    expect(fake.visibility()).toBe("none");
    expect(legend.at(-1)).toBeNull();
  });

  it("aborts a read when the camera moves on, and only the newest read paints", async () => {
    const { store, pending } = manualStore();
    const first = box(PARIS);
    const second = box([PARIS[0] + 0.02, PARIS[1]]);
    const fake = fakeMap(STYLE, { bbox: first, zoom: 16 });
    attach(fake, store);
    await flush();
    expect(pending).toHaveLength(1);

    fake.moveTo({ bbox: second, zoom: 16 });
    await flush();
    expect(pending[0].signal?.aborted).toBe(true);

    pending[1].resolve();
    await flush();
    pending[0].resolve(); // lands late, after being superseded
    await flush();

    const [west, , east] = second;
    const corners = fake.source()?.coordinates ?? [];
    expect(corners[0][0]).toBeCloseTo(west, 6);
    expect(corners[1][0]).toBeCloseTo(east, 6);
    expect(fake.source()?.url).toBe("blob:canopy-1");
  });

  it("reads nothing for a move inside the painted image at the same resolution", async () => {
    const { store, reads } = recordingStore();
    const fake = fakeMap(STYLE, { bbox: box(PARIS), zoom: 16 });
    attach(fake, store);
    await flush();
    const after = reads.length;

    fake.moveTo({ bbox: box(PARIS, 0.004), zoom: 16.1 });
    await flush();
    expect(reads).toHaveLength(after);

    fake.moveTo({ bbox: box([PARIS[0] + 0.006, PARIS[1]]), zoom: 16 });
    await flush();
    expect(reads.length).toBeGreaterThan(after);
  });

  it("goes off and on with Sun Exposure, re-reading when it comes back", async () => {
    const { store, reads } = recordingStore();
    const fake = fakeMap(STYLE, { bbox: box(PARIS), zoom: 16 });
    const { handle, legend } = attach(fake, store, false);
    await flush();
    expect(reads).toHaveLength(0);

    handle.setEnabled(true);
    await flush();
    expect(fake.visibility()).toBe("visible");
    expect(legend.at(-1)).not.toBeNull();

    handle.setEnabled(false);
    await flush();
    expect(fake.visibility()).toBe("none");
    expect(legend.at(-1)).toBeNull();
  });

  it("tells the legend only when what it says changes", async () => {
    const fake = fakeMap(STYLE, { bbox: box(PARIS), zoom: 16 });
    const { legend } = attach(fake, answering());
    await flush();
    fake.moveTo({ bbox: box([PARIS[0] + 0.02, PARIS[1]]), zoom: 16 });
    await flush();
    fake.moveTo({ bbox: box([PARIS[0] + 0.04, PARIS[1]]), zoom: 16 });
    await flush();

    expect(legend.filter(Boolean)).toHaveLength(1);
  });

  it("shows no legend over a view with no canopy — unless the imagery was leaf-off", async () => {
    const bare = fakeMap(STYLE, { bbox: box(PARIS), zoom: 16 });
    const paris = attach(bare, answering(0));
    await flush();
    expect(paris.legend.filter(Boolean)).toHaveLength(0);

    const winter = fakeMap(STYLE, { bbox: box(MADRID), zoom: 16 });
    const madrid = attach(winter, answering(0));
    await flush();
    expect(madrid.legend.at(-1)).toEqual({ imagery: { date: "2020-02-20", leafOff: true } });
  });

  it("takes the fill and legend off when no quadkey answers", async () => {
    let fail = false;
    const store = {
      read: async (aoi: LonLatBbox) => {
        if (fail) throw new Error("404 chm/…tif");
        return patchOver(aoi, 30);
      },
    };
    const fake = fakeMap(STYLE, { bbox: box(PARIS), zoom: 16 });
    const { legend } = attach(fake, store);
    await flush();
    expect(fake.visibility()).toBe("visible");

    fail = true;
    fake.moveTo({ bbox: box([PARIS[0] + 0.05, PARIS[1]]), zoom: 16 });
    await flush();
    expect(fake.visibility()).toBe("none");
    expect(legend.at(-1)).toBeNull();
  });
});
