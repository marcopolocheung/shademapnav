import { defineConfig } from "@playwright/test";
import baseConfig from "./playwright.config";

/**
 * G2's route benchmark. Separate from `playwright.config.ts` on purpose.
 *
 * The benchmark **measures and commits a baseline; it does not gate a build**.
 * Failing CI on a regression is G3. Keeping it in its own config is what makes
 * that true mechanically rather than by convention: `npm run e2e` cannot pick it
 * up, and CI — which runs `npm run e2e` — never spends four minutes on it.
 *
 * It also runs keyless only. G1's `smoke-live` project exists to check MapTiler's
 * real building schema; real tile fetches inside a performance number would put
 * network variance inside the baseline.
 *
 * The canonical environment is a developer machine, not a GitHub runner: a 2-core
 * runner on SwiftShader is roughly 3x slower, so a before/after comparison has to
 * happen on one machine and the baseline names which.
 */
export default defineConfig({
  ...baseConfig,
  testDir: "e2e/bench",
  // Canopy has a separate live-network config. Without an explicit match, adding
  // those specs made the keyless route command wait on source.coop before G2 ran.
  testMatch: ["**/routeCalc.bench.spec.ts", "**/detourSweep.bench.spec.ts"],
  testIgnore: undefined,
  // The smoke config's project announcement must not run here: this config runs
  // neither `smoke` nor `smoke-live`, and saying otherwise in the output of a
  // benchmark whose headline caveat is "keyless" is worse than saying nothing.
  globalSetup: undefined,
  // No retries. A benchmark that silently re-ran a bad sample would report the
  // luckier of two runs, which is the one thing a baseline must not do.
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  // Cold scenarios pay a full page load per repeat, and the map has to paint
  // under SwiftShader before each one counts.
  timeout: 600_000,
  projects: [{ name: "bench" }],
});
