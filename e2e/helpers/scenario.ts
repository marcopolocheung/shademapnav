import type { Page } from "@playwright/test";
import { fixtureBasemapStyle } from "../fixtures/basemapStyle";
import { overpassGridResponse } from "../fixtures/overpassGrid";

// Midtown Manhattan at z17 on the June solstice morning: dense towers, low sun,
// long shadows. Fixed on purpose — the assertions are pixel counts, and a moving
// camera or clock makes them unrepeatable. The `fixture` basemap keeps the same
// coordinates: nothing real is fetched there, but the Overpass street grid and
// the waypoints below are already anchored here.
export const CENTER = { lat: 40.754, lng: -73.984, zoom: 17 };
export const WAYPOINT_A: [number, number] = [-73.9855, 40.753];
export const WAYPOINT_B: [number, number] = [-73.9825, 40.755];
export const START_TIME = "09:00";
export const START_MINUTES = 9 * 60;
// Straight-line A→B is ~340 m, under the 500 m threshold that pulls the transit
// graph in — one fewer network dependency for the same route assertion.
export const SHARE_URL =
  `/?lat=${CENTER.lat}&lng=${CENTER.lng}&z=${CENTER.zoom}` +
  `&date=2026-06-21&time=${START_TIME}` +
  `&a=${WAYPOINT_A[0]},${WAYPOINT_A[1]}&b=${WAYPOINT_B[0]},${WAYPOINT_B[1]}`;

// Dragging the timeline left advances time: TimelineSlider maps 2 px to a minute
// and subtracts the drag delta, so -360 px is +3 h — 09:00 to noon, which moves
// every shadow in the frame.
export const DRAG_PX_PER_MIN = 2;
export const DRAG_MINUTES = 180;
export const INERTIA_CUTOFF_MS = 80;

// Every 8th pixel in both axes: ~18k samples off a 1280×900 canvas, enough to
// measure a shadow field without shipping 4.6 MB per read across CDP.
export const SAMPLE_STEP = 8;

/** Which basemap the run is testing against. See `playwright.config.ts`. */
export type Basemap = "fixture" | "live";

const MAPTILER_STYLE_URL = "**api.maptiler.com/maps/outdoor-v2/style.json*";

/**
 * Install every network stub the smoke test needs.
 *
 * Registration order matters: Playwright gives precedence to the most recently
 * registered matching route, so the blanket MapTiler abort goes in *before* the
 * style handler that has to win.
 */
export async function stubNetwork(page: Page, opts: { basemap: Basemap }): Promise<void> {
  if (opts.basemap === "fixture") {
    // Nothing should reach MapTiler once the style is stubbed. Abort rather than
    // let a stray request quietly hit the network (or 403 without a key), so a
    // future style change fails loudly instead of skewing the pixel counts.
    await page.route("**api.maptiler.com/**", (route) => route.abort());
    await page.route(MAPTILER_STYLE_URL, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(fixtureBasemapStyle()),
      })
    );
  }

  // Overpass is stubbed in both projects: the public instance rate-limits and
  // its graph changes month to month.
  await page.route("**/api/overpass", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: overpassGridResponse,
    })
  );

  // Reverse-geocoding the two waypoints is the app's only Nominatim call on this
  // path. `vite preview` serves no serverless functions, so /api/nominatim would
  // 404 — answer it here instead, both to keep the run hermetic and because the
  // OSMF policy is not something to lean on from a test loop.
  await page.route("**/api/nominatim*", (route) => {
    const isReverse = new URL(route.request().url()).searchParams.get("endpoint") === "reverse";
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: isReverse ? JSON.stringify({ display_name: "Test Street, Test City" }) : "[]",
    });
  });

  // The cloud-cover badge's forecast fetch is the one other third party the app
  // touches on load. It feeds no assertion here, and the caller already treats a
  // failure as "no data", so cut it rather than leave an unmocked call in a test
  // that claims to be deterministic.
  await page.route("**api.open-meteo.com/**", (route) => route.abort());
}
