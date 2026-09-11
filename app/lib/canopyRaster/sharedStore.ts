/**
 * The one `CanopyTileStore` the app reads canopy through.
 *
 * A8b built the store for two consumers with independent lifecycles — the route
 * corridor (`createRasterCanopyProvider`) and the viewport (A8f's canopy layer). Its
 * dedupe and refcounted cancellation only do anything if both hold the *same*
 * instance: two stores fetch the same bytes twice, and a pan could never be told
 * apart from the corridor's read because they would not share a fetch to refcount.
 *
 * Built on first use behind a dynamic import, so `geotiff.js` stays in its own chunk
 * rather than in the bundle every visitor downloads. A failed import is not cached,
 * so the next caller retries it.
 */

import type { CanopyTileStore } from "./canopyTileStore";

let shared: Promise<CanopyTileStore> | null = null;

export function sharedCanopyTileStore(): Promise<CanopyTileStore> {
  if (!shared) {
    shared = import("./canopyTileStore").then(
      ({ createCanopyTileStore }) => createCanopyTileStore(),
      (error) => {
        shared = null;
        throw error;
      },
    );
  }
  return shared;
}
