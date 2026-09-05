import { expect, type Page, test } from "@playwright/test";
import { isBlueDominantShadowPixel } from "../app/lib/shadeSampling";
import { hasMapTilerKey } from "../playwright.config";
import { overpassGridResponse } from "./fixtures/overpassGrid";

// Midtown Manhattan at z17 on the June solstice morning: dense towers, low sun,
// long shadows. Fixed on purpose — the assertions below are pixel counts, and a
// moving camera or clock makes them unrepeatable.
const CENTER = { lat: 40.754, lng: -73.984, zoom: 17 };
const WAYPOINT_A: [number, number] = [-73.9855, 40.753];
const WAYPOINT_B: [number, number] = [-73.9825, 40.755];
const START_TIME = "09:00";
const START_MINUTES = 9 * 60;
// Straight-line A→B is ~340 m, under the 500 m threshold that pulls the transit
// graph in — one fewer network dependency for the same route assertion.
const SHARE_URL =
  `/?lat=${CENTER.lat}&lng=${CENTER.lng}&z=${CENTER.zoom}` +
  `&date=2026-06-21&time=${START_TIME}` +
  `&a=${WAYPOINT_A[0]},${WAYPOINT_A[1]}&b=${WAYPOINT_B[0]},${WAYPOINT_B[1]}`;

// Dragging the timeline left advances time: TimelineSlider maps 2 px to a minute
// and subtracts the drag delta, so -360 px is +3 h — 09:00 to noon, which moves
// every shadow in the frame.
const DRAG_PX_PER_MIN = 2;
const DRAG_MINUTES = 180;
const INERTIA_CUTOFF_MS = 80;

// Every 8th pixel in both axes: ~18k samples off a 1280×900 canvas, enough to
// measure a shadow field without shipping 4.6 MB per read across CDP.
const SAMPLE_STEP = 8;

test.skip(
  !hasMapTilerKey,
  "VITE_MAPTILER_API_KEY is not set — the browser smoke test needs real basemap tiles to render buildings and shadows."
);

/** Flat [r, g, b, r, g, b, …] read back from the live map canvas. */
async function sampleMapCanvas(page: Page, step: number): Promise<number[]> {
  return page.evaluate((sampleStep) => {
    const canvas = document.querySelector<HTMLCanvasElement>("canvas.maplibregl-canvas");
    if (!canvas) throw new Error("MapLibre canvas not found");
    // Readable only because of invariant #3, preserveDrawingBuffer: true.
    const scratch = document.createElement("canvas");
    scratch.width = canvas.width;
    scratch.height = canvas.height;
    const ctx = scratch.getContext("2d");
    if (!ctx) throw new Error("2d context unavailable");
    ctx.drawImage(canvas, 0, 0);
    const { data } = ctx.getImageData(0, 0, scratch.width, scratch.height);
    const out: number[] = [];
    for (let y = 0; y < scratch.height; y += sampleStep) {
      for (let x = 0; x < scratch.width; x += sampleStep) {
        const i = (y * scratch.width + x) * 4;
        out.push(data[i], data[i + 1], data[i + 2]);
      }
    }
    return out;
  }, step);
}

/**
 * Fraction of samples whose shaded state differs between two frames. Throws on a
 * length mismatch: a resized canvas would otherwise read as "everything changed"
 * and pass the shadows-moved assertion for the wrong reason.
 */
function maskDiff(before: boolean[], after: boolean[]): number {
  if (before.length !== after.length) {
    throw new Error(`canvas sample count changed: ${before.length} then ${after.length}`);
  }
  return after.filter((shaded, i) => shaded !== before[i]).length / after.length;
}

/** The app's own shade predicate, imported rather than restated (invariant #5). */
function shadeMask(samples: number[]): boolean[] {
  const mask: boolean[] = [];
  for (let i = 0; i < samples.length; i += 3) {
    mask.push(isBlueDominantShadowPixel(samples[i], samples[i + 1], samples[i + 2]));
  }
  return mask;
}

const shadedFraction = (mask: boolean[]) => mask.filter(Boolean).length / mask.length;

/**
 * Pixels of the nav route line (#f59e0b at 0.9 opacity over the basemap).
 * Counted at full resolution in-page: the line is 4 px wide, so the sampling
 * grid used for shade would step straight over it.
 */
async function countRouteLinePixels(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("canvas.maplibregl-canvas");
    if (!canvas) throw new Error("MapLibre canvas not found");
    const scratch = document.createElement("canvas");
    scratch.width = canvas.width;
    scratch.height = canvas.height;
    const ctx = scratch.getContext("2d");
    if (!ctx) throw new Error("2d context unavailable");
    ctx.drawImage(canvas, 0, 0);
    const { data } = ctx.getImageData(0, 0, scratch.width, scratch.height);
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (r > 200 && g > 110 && g < 200 && b < 90 && r - b > 140) count++;
    }
    return count;
  });
}

test("loads, paints shadows, retimes them, and renders a calculated route", async ({ page }) => {
  // Overpass is stubbed: the public instance rate-limits and its graph changes
  // month to month. MapTiler is deliberately *not* stubbed — real buildings are
  // the whole point of rendering in a browser.
  await page.route("**/api/overpass", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: overpassGridResponse,
    })
  );
  // The cloud-cover badge's forecast fetch is the one other third party the app
  // touches on load. It feeds no assertion here, and the caller already treats a
  // failure as "no data", so cut it rather than leave an unmocked call in a test
  // that claims to be deterministic.
  await page.route("**api.open-meteo.com/**", (route) => route.abort());

  await page.goto(SHARE_URL);
  await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible();

  // 1. Shadows paint. Poll rather than wait a fixed time: tile fetches and the
  //    first shadow pass are both slower under SwiftShader than on a GPU.
  await expect
    .poll(
      async () => shadedFraction(shadeMask(await sampleMapCanvas(page, SAMPLE_STEP))),
      { timeout: 90_000, message: "no blue-dominant shadow pixels ever appeared on the map" }
    )
    .toBeGreaterThan(0.02);

  // Let the field settle before it becomes the reference frame: a half-finished
  // first shadow pass would otherwise read as the drag's doing.
  let morningMask = shadeMask(await sampleMapCanvas(page, SAMPLE_STEP));
  await expect
    .poll(
      async () => {
        const next = shadeMask(await sampleMapCanvas(page, SAMPLE_STEP));
        const drift = maskDiff(morningMask, next);
        morningMask = next;
        return drift;
      },
      { timeout: 15_000, message: "the shadow field never stopped changing on its own" }
    )
    .toBeLessThan(0.005);

  // 2. Dragging the timeline moves the shadows. Compare masks, not totals: at a
  //    different hour the same *amount* of shade can fall somewhere else.
  // The desktop and mobile layouts each mount a timeline; only one is displayed
  // at this viewport.
  const slider = page.getByTestId("timeline-slider").filter({ visible: true });
  await expect(slider).toBeVisible();
  const box = await slider.boundingBox();
  if (!box) throw new Error("timeline slider has no layout box");
  const startX = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(startX - DRAG_MINUTES * DRAG_PX_PER_MIN, y, { steps: 12 });
  // Pause before releasing. TimelineSlider launches momentum only when the
  // pointer comes up within 80 ms of the last move, and a flung slider coasts
  // for an unpredictable number of minutes — which would make the end time a
  // function of how fast the machine running the test happens to be.
  await page.waitForTimeout(INERTIA_CUTOFF_MS * 2);
  await page.mouse.up();

  // The app mirrors date and time back into the URL on every change, so this is
  // the clock the drag actually landed on. ±2 min absorbs per-frame rounding.
  await expect
    .poll(
      () => {
        const [h, m] = (new URL(page.url()).searchParams.get("time") ?? "0:0")
          .split(":")
          .map(Number);
        return Math.abs(h * 60 + m - (START_MINUTES + DRAG_MINUTES));
      },
      { timeout: 10_000, message: "the drag did not land on the expected clock time" }
    )
    .toBeLessThanOrEqual(2);

  await expect
    .poll(async () => maskDiff(morningMask, shadeMask(await sampleMapCanvas(page, SAMPLE_STEP))), {
      timeout: 20_000,
      message: "the shadow field did not change after dragging the timeline",
    })
    .toBeGreaterThan(0.01);

  // 3. A two-point route calculates and its line reaches the canvas. The share
  //    link already seeded both waypoints and opened the directions panel.
  const routeLinePixelsBefore = await countRouteLinePixels(page);
  await page.getByRole("button", { name: "Find Shaded Route" }).click();

  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const metrics = (window as unknown as { __shadeMapMetrics?: { latest?: unknown } })
            .__shadeMapMetrics;
          return Boolean(metrics?.latest);
        }),
      { timeout: 40_000, message: "no routing run was ever recorded on window.__shadeMapMetrics" }
    )
    .toBe(true);

  await expect
    .poll(() => countRouteLinePixels(page), {
      timeout: 20_000,
      message: "the route line never appeared on the map canvas",
    })
    .toBeGreaterThan(routeLinePixelsBefore + 200);
});
