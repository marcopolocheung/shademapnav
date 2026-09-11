/**
 * A8f — does building shadow stay detectable where it falls on the canopy fill?
 *
 * The fill sits under the shadow layer, so shadow now composites over it instead of
 * over the basemap, and the canvas fallback decides "shadowed" with
 * `isBlueDominantShadowPixel` on whatever that produces (invariant #5). The unit tests
 * prove it for the fill colour against a handful of basemap colours; this measures it
 * on the real canvas, over the real basemap, with the real renderer.
 *
 *   npm run dev -- --port 5190 &
 *   LD_LIBRARY_PATH=$HOME/miniconda3/lib node studies/canopy-paint-predicate.mjs
 *   node studies/canopy-paint-predicate.mjs --base http://127.0.0.1:5173 --scene sg-low
 *
 * **Method: the same frame twice.** Each scene is rendered once with `source.coop`
 * blocked — the canopy layer then paints nothing, which is exactly `main`'s canvas —
 * and once with it open. Same URL, same camera, same tiles (see caching below), so the
 * two canvases differ only where the fill is. Then, over the pixels that changed:
 *
 * - **retained**: of the pixels the predicate called shadowed without the fill, the
 *   share it still calls shadowed with it. This is #275's acceptance number.
 * - **gained**: pixels the predicate calls shadowed only with the fill, and of those,
 *   how many were **open ground** — see `compare`. The colour argument says a sunlit
 *   fill cannot turn blue-dominant; this checks it on real pixels instead of trusting it.
 *
 * What it cannot see: a shadowed pixel `main` already failed to detect and the fill
 * did not rescue is invisible to both runs, and counted in neither.
 *
 * **Cached.** `source.coop`'s responses are recorded to a HAR on the first run and
 * replayed on every later one, under `node_modules/.cache/umbra-canopy-paint/`; delete
 * it to re-record. That is the public research host the studies contract protects.
 * MapTiler is not cached: replaying its style broke the basemap (React's development
 * double mount aborts the first style request, and the HAR kept the aborted one), and
 * the two runs of a scene are a minute apart on the app's own CDN.
 *
 * The predicate is bundled from `app/lib/shadowSampling.ts` by esbuild, as
 * `canopy-urban-confusion.mjs` bundles its reader: the measurement uses the app's
 * predicate, not a copy of it.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_DIR = join(REPO_ROOT, "node_modules", ".cache", "umbra-canopy-paint");

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const BASE = argValue("--base", "http://127.0.0.1:5190");
const ONLY = argValue("--scene", null);
const SHOTS = argValue("--shots", null);
const VERBOSE = args.includes("--verbose");

const VIEWPORT = { width: 1280, height: 900 };

/**
 * Three corpus cities, each at a low sun and a high one.
 *
 * Low is the case that matters: the dawn shadow colour is the dark end of the
 * renderer's range, where a warm background comes closest to failing the predicate,
 * and A8d made the canvas fallback run *more* often near the horizon. Times are the
 * map's local time, as the share URL takes them.
 */
const SCENES = [
  // ~4° of sun, 15 minutes after sunrise: the dawn blue with almost nothing mixed in.
  { id: "sg-dawn", lat: 1.2795, lng: 103.8475, date: "2026-07-15", time: "07:20" },
  { id: "sg-low", lat: 1.2795, lng: 103.8475, date: "2026-07-15", time: "07:50" },
  { id: "sg-high", lat: 1.2795, lng: 103.8475, date: "2026-07-15", time: "13:00" },
  { id: "kent-low", lat: 47.3809, lng: -122.2348, date: "2026-07-15", time: "06:40" },
  { id: "kent-high", lat: 47.3809, lng: -122.2348, date: "2026-07-15", time: "13:00" },
  { id: "madrid-low", lat: 40.4168, lng: -3.7038, date: "2026-07-15", time: "07:45" },
  { id: "madrid-high", lat: 40.4168, lng: -3.7038, date: "2026-07-15", time: "14:00" },
];
const ZOOM = 17;

async function loadPredicate() {
  mkdirSync(CACHE_DIR, { recursive: true });
  execFileSync(
    join(REPO_ROOT, "node_modules", ".bin", "esbuild"),
    [
      join(REPO_ROOT, "app", "lib", "shadowSampling.ts"),
      "--bundle",
      "--format=esm",
      "--platform=node",
      `--outfile=${join(CACHE_DIR, "shadowSampling.mjs")}`,
    ],
    { stdio: "inherit" },
  );
  return (await import(join(CACHE_DIR, "shadowSampling.mjs"))).isBlueDominantShadowPixel;
}

/** The whole map canvas as RGBA, read back the way the fallback reads it. */
async function readCanvas(page) {
  const b64 = await page.evaluate(() => {
    const canvas = document.querySelector("canvas.maplibregl-canvas");
    const scratch = document.createElement("canvas");
    scratch.width = canvas.width;
    scratch.height = canvas.height;
    const ctx = scratch.getContext("2d");
    ctx.drawImage(canvas, 0, 0);
    const { data } = ctx.getImageData(0, 0, scratch.width, scratch.height);
    let binary = "";
    for (let i = 0; i < data.length; i += 0x8000) {
      binary += String.fromCharCode(...data.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  });
  return new Uint8Array(Buffer.from(b64, "base64"));
}

async function render(browser, scene, { canopy }) {
  const har = join(CACHE_DIR, `${scene.id}.har`);
  const recording = !existsSync(har);
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  await context.routeFromHAR(har, {
    url: /data\.source\.coop/,
    update: recording,
    notFound: "fallback",
  });
  const page = await context.newPage();
  // Registered after the HAR, so it wins: the no-canopy frame never sees the raster.
  if (!canopy) await page.route(/data\.source\.coop/, (route) => route.abort());

  const url = `${BASE}/?lat=${scene.lat}&lng=${scene.lng}&z=${ZOOM}&date=${scene.date}&time=${scene.time}`;
  await page.goto(url);
  await page.waitForSelector("canvas.maplibregl-canvas");
  if (canopy) {
    await page.waitForSelector('[data-testid="canopy-legend"]', { timeout: 120_000 });
  }
  // Tiles, the shadow worker and label fades all land at their own pace. Wait for the
  // frame to stop changing rather than for a fixed time, so a slow run is not a
  // half-rendered one.
  let pixels = await readCanvas(page);
  for (let attempt = 0; attempt < 30; attempt++) {
    await page.waitForTimeout(2000);
    const next = await readCanvas(page);
    const same = next.length === pixels.length && next.every((v, i) => v === pixels[i]);
    pixels = next;
    if (same) break;
  }
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, `${scene.id}-${canopy ? "canopy" : "main"}.png`) });
  }
  await context.close();
  return { pixels, recorded: recording };
}

/** Does any of the eight neighbours of pixel `p` satisfy `test`? */
function touches(px, p, width, height, test) {
  const x = p % width;
  const y = Math.floor(p / width);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if ((dx === 0 && dy === 0) || x + dx < 0 || y + dy < 0 || x + dx >= width || y + dy >= height) continue;
      const j = ((y + dy) * width + (x + dx)) * 4;
      if (test(px[j], px[j + 1], px[j + 2])) return true;
    }
  }
  return false;
}

/**
 * Compare the two frames over the pixels the fill changed.
 *
 * A pixel whose verdict flips is sorted two ways, both asked of the frame *without*
 * the fill. **At an edge**: it touches a pixel on the other side of the verdict. The
 * renderer supersamples, so a shadow's rim is part-shadow, and whether a part-covered
 * pixel clears the predicate depends on how light the surface under it is.
 * **Open ground**, for a gained pixel: before the fill it leaned no more toward blue
 * than a sunlit surface does. Every surface the fill can land on leans at most
 * `b − (r + g) / 2 = +2` (outdoor-v2's hospital pink; background, landcover and
 * landuse all lean negative), while even the dawn shadow — the darkest, least blue
 * end of the renderer's range — leaves a half-covered pixel leaning ~+13. So a gained
 * pixel leaning ≤ `OPEN_GROUND_LEAN` had no shadow in it to find, and the fill made
 * one. That count is the one that has to be zero. `minLean` is reported beside it so
 * the threshold can be checked rather than trusted.
 */
const OPEN_GROUND_LEAN = 3;

function compare(before, after, isShadow, width) {
  const height = before.length / 4 / width;
  const counts = {
    pixels: before.length / 4,
    changed: 0,
    shadowedBefore: 0,
    retained: 0,
    lost: 0,
    lostAtEdge: 0,
    gained: 0,
    gainedAtEdge: 0,
    gainedOpenGround: 0,
    minLean: Number.POSITIVE_INFINITY,
    examples: [],
  };
  for (let i = 0; i < before.length; i += 4) {
    const delta = Math.max(
      Math.abs(before[i] - after[i]),
      Math.abs(before[i + 1] - after[i + 1]),
      Math.abs(before[i + 2] - after[i + 2]),
    );
    if (delta <= 2) continue;
    counts.changed += 1;
    const wasShadow = isShadow(before[i], before[i + 1], before[i + 2]);
    const isShadowNow = isShadow(after[i], after[i + 1], after[i + 2]);
    if (wasShadow) counts.shadowedBefore += 1;
    if (wasShadow && isShadowNow) counts.retained += 1;
    if (wasShadow === isShadowNow) continue;

    const p = i / 4;
    const atEdge = touches(before, p, width, height, (r, g, b) => isShadow(r, g, b) !== wasShadow);
    if (wasShadow) {
      counts.lost += 1;
      if (atEdge) counts.lostAtEdge += 1;
    } else {
      counts.gained += 1;
      if (atEdge) counts.gainedAtEdge += 1;
      const lean = before[i + 2] - (before[i] + before[i + 1]) / 2;
      counts.minLean = Math.min(counts.minLean, lean);
      if (lean <= OPEN_GROUND_LEAN) counts.gainedOpenGround += 1;
    }
    if (counts.examples.length < 8 && !atEdge) {
      counts.examples.push({
        x: p % width,
        y: Math.floor(p / width),
        was: wasShadow,
        before: [before[i], before[i + 1], before[i + 2]],
        after: [after[i], after[i + 1], after[i + 2]],
      });
    }
  }
  return counts;
}

const { chromium } = await import(join(REPO_ROOT, "node_modules", "@playwright", "test", "index.mjs"));
const isShadow = await loadPredicate();
const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});

const rows = [];
for (const scene of SCENES.filter((s) => !ONLY || s.id === ONLY)) {
  // Canopy first: on a cold cache it is the run that records every tile both need.
  const withFill = await render(browser, scene, { canopy: true });
  const without = await render(browser, scene, { canopy: false });
  const c = compare(without.pixels, withFill.pixels, isShadow, VIEWPORT.width);
  rows.push({ scene: scene.id, ...c, recorded: withFill.recorded });
  const pct = (n, d) => (d === 0 ? "—" : `${((100 * n) / d).toFixed(2)}%`);
  console.log(
    `${scene.id.padEnd(12)} fill px ${String(c.changed).padStart(7)} (${pct(c.changed, c.pixels)} of frame)` +
      ` · shadowed under fill ${String(c.shadowedBefore).padStart(6)}` +
      ` · retained ${pct(c.retained, c.shadowedBefore).padStart(7)}` +
      ` · lost ${c.lost} (${c.lostAtEdge} at an edge)` +
      ` · gained ${c.gained} (${c.gainedAtEdge} at an edge, ${c.gainedOpenGround} open ground` +
      `${c.gained ? `, least blue lean before +${c.minLean.toFixed(1)}` : ""})` +
      `${withFill.recorded ? " · (recorded)" : ""}`,
  );
  if (VERBOSE) for (const e of c.examples) console.log("   ", JSON.stringify(e));
}
await browser.close();

const out = argValue("--json", null);
if (out) writeFileSync(out, JSON.stringify(rows, null, 2));
