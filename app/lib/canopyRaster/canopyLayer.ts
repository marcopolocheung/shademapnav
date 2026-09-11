/**
 * A8f — the estimated-canopy fill on the map: the MapLibre shell around
 * `canopyPaint.ts`.
 *
 * One image source, re-read on `moveend` and painted under the basemap's water,
 * roads and buildings. The placement matters for invariant #5 — see `beforeIdFor`.
 *
 * It reads through `sharedCanopyTileStore()`, the store the route corridor already
 * uses, so the two consumers A8b was built for finally share one cache. Each viewport
 * read has its own `AbortController` and is aborted when the camera moves again; the
 * store refcounts its fetches, so aborting the viewport cannot cancel a corridor read
 * waiting on the same blocks.
 */

import type maplibregl from "maplibre-gl";
import {
  CANOPY_FILL_OPACITY,
  type CanopyImage,
  type CanopyImagery,
  MAX_VIEW_HALF_M,
  MIN_CANOPY_ZOOM,
  clampAround,
  imageryAt,
  paintPatches,
  readViewport,
} from "./canopyPaint";
import { sharedCanopyTileStore } from "./sharedStore";

export const CANOPY_SOURCE_ID = "canopy-estimate";
export const CANOPY_LAYER_ID = "canopy-estimate-fill";

/** What the legend needs: `null` while nothing is painted. */
export interface CanopyLegendState {
  imagery: CanopyImagery | null;
}

/**
 * The layer the fill goes directly beneath: the basemap's first water layer.
 *
 * Everything drawn after it — water, roads, bridges, buildings — covers the fill, and
 * that is deliberate. Water is the one basemap colour that fails the shadow predicate
 * *only by being too bright* (outdoor-v2's ~(164, 209, 244) sums past 600); darkening
 * it by any amount would make sunlit water read as shadow. Under it, the fill only
 * ever composites with the landcover and landuse greens and greys, none of which it
 * can turn blue-dominant. Covering by buildings is also what `ShadowField` does: it
 * subtracts the footprints from the raster before marching it.
 *
 * `fallback` — the shadow layer — is for a style with no water layer. The fill must
 * never be drawn above the shadow layer while the camera is flat.
 */
function beforeIdFor(map: maplibregl.Map, fallback: string): string {
  for (const id of map.getLayersOrder()) {
    const sourceLayer = map.getLayer(id)?.sourceLayer;
    if (sourceLayer === "water" || sourceLayer === "waterway") return id;
  }
  return fallback;
}

export function attachCanopyLayer(
  map: maplibregl.Map,
  opts: { belowLayerId: string; onChange: (state: CanopyLegendState | null) => void },
): () => void {
  let controller: AbortController | null = null;
  let objectUrl: string | null = null;
  const canvas = document.createElement("canvas");

  function hide(): void {
    if (map.getLayer(CANOPY_LAYER_ID)) map.setLayoutProperty(CANOPY_LAYER_ID, "visibility", "none");
    opts.onChange(null);
  }

  function show(url: string, image: CanopyImage, imagery: CanopyImagery | null): void {
    const [west, south, east, north] = image.bbox;
    const coordinates: [[number, number], [number, number], [number, number], [number, number]] = [
      [west, north],
      [east, north],
      [east, south],
      [west, south],
    ];
    const source = map.getSource(CANOPY_SOURCE_ID) as maplibregl.ImageSource | undefined;
    if (source) {
      source.updateImage({ url, coordinates });
    } else {
      map.addSource(CANOPY_SOURCE_ID, { type: "image", url, coordinates });
      map.addLayer(
        {
          id: CANOPY_LAYER_ID,
          type: "raster",
          source: CANOPY_SOURCE_ID,
          paint: { "raster-opacity": CANOPY_FILL_OPACITY, "raster-fade-duration": 0 },
        },
        beforeIdFor(map, opts.belowLayerId),
      );
    }
    map.setLayoutProperty(CANOPY_LAYER_ID, "visibility", "visible");
    // The previous image is decoded, or its load was just aborted by `updateImage`.
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = url;
    opts.onChange({ imagery });
  }

  async function refresh(): Promise<void> {
    controller?.abort();
    controller = null;
    if (map.getZoom() < MIN_CANOPY_ZOOM) {
      hide();
      return;
    }

    const ctrl = new AbortController();
    controller = ctrl;
    const bounds = map.getBounds();
    const centre = map.getCenter();
    const bbox = clampAround(
      [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()],
      [centre.lng, centre.lat],
      MAX_VIEW_HALF_M,
    );

    try {
      const store = await sharedCanopyTileStore();
      const image = paintPatches(await readViewport(store, bbox, ctrl.signal));
      if (ctrl.signal.aborted) return;
      // No quadkey answered — open ocean, or the host is unreachable. A legend over
      // an empty map would claim the canopy here was assessed and found absent.
      if (!image) {
        hide();
        return;
      }
      const url = await toObjectUrl(canvas, image);
      if (ctrl.signal.aborted) {
        URL.revokeObjectURL(url);
        return;
      }
      show(url, image, imageryAt(centre.lng, centre.lat));
    } catch {
      // Superseded by a newer read — which owns the map now — or the store's chunk
      // failed to load, which the next `moveend` retries.
      if (!ctrl.signal.aborted) hide();
    }
  }

  map.on("moveend", refresh);
  void refresh();

  return () => {
    controller?.abort();
    map.off("moveend", refresh);
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  };
}

/** Encode the image for an image source, reusing one scratch canvas. */
async function toObjectUrl(canvas: HTMLCanvasElement, image: CanopyImage): Promise<string> {
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("2d canvas unavailable");
  context.putImageData(new ImageData(image.rgba, image.width, image.height), 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("canopy image could not be encoded");
  return URL.createObjectURL(blob);
}
