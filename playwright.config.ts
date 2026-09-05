import { defineConfig } from "@playwright/test";
import { loadEnv } from "vite";

// The smoke test needs real MapTiler vector tiles: building footprints come from
// the basemap source (`querySourceFeatures("maptiler_planet")`), and with no
// buildings there are no shadows to assert on. Without the key the suite skips
// with a message rather than failing, so forks and secret-less runs stay green.
// `loadEnv` reads the same sources the build does — the `.env` files locally, the
// environment in CI — so nobody has to export the key twice.
export const hasMapTilerKey = !!loadEnv("production", process.cwd(), "VITE_")
  .VITE_MAPTILER_API_KEY;

if (!hasMapTilerKey) {
  // Playwright's reporters print a bare "1 skipped"; say why.
  console.warn(
    "[e2e] VITE_MAPTILER_API_KEY is not set — skipping the browser smoke test. " +
      "It needs real MapTiler tiles: buildings, and therefore shadows, come from them."
  );
}

const PORT = 4173;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "e2e",
  // Flake budget: one retry, then fail. A browser test that needs more retries
  // than that is noise, and noisy CI is worse than no CI.
  retries: 1,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    browserName: "chromium",
    // Fixed viewport: the app switches layout at Tailwind's `md`, and the pixel
    // assertions below count samples off a canvas of exactly this size.
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    timezoneId: "America/New_York",
    launchOptions: {
      // Headless WebGL2 for MapLibre and the shadow renderer: ANGLE over
      // SwiftShader is the only software path that gives a real GL2 context.
      args: [
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
      ],
    },
  },
  // Runs against the production build, not the dev server: `import.meta.env.DEV`
  // picks the prod Overpass path, and only the built bundle proves the app the
  // deploy ships actually boots.
  webServer: hasMapTilerKey
    ? {
        command: `npm run build && npm run start -- --port ${PORT} --strictPort`,
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 240_000,
      }
    : undefined,
});
