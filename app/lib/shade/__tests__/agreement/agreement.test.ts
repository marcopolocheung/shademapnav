/**
 * A3's gate: the shade field must agree with the pixel sampler, and CI must say by
 * how much. The brief makes this a product gate rather than a test detail — when the
 * two diverge, the renderer is what the user believes, so a regression here means
 * either the field is wrong or its confidence is overstated.
 *
 * `harness.ts` documents exactly which disagreements this corpus can and cannot see.
 */

import { describe, expect, it } from "vitest";
import { agreementFixtures, sunFor } from "./fixtures";
import { disagreementsFor, formatReport, referenceFor, reportFor } from "./harness";

/**
 * Committed thresholds.
 *
 * These are ceilings on a measured number, not aspirations: they were set just above
 * what the corpus currently reports so that a regression trips them, and they should
 * be *lowered* as the field improves, never raised to make a failure go away. Raising
 * one is a product decision — it means accepting more divergence between what the map
 * paints and what routing believes.
 */
const MAX_MEAN_DISAGREEMENT = 0.04;
const MAX_P90_DISAGREEMENT = 0.05;
const MAX_SEVERE_SHARE = 0.04;

describe("shade field vs pixel sampler", () => {
  const fixtures = agreementFixtures();
  const disagreements = disagreementsFor(fixtures, (fixture) => {
    const sun = sunFor(fixture);
    return referenceFor(fixture, sun, sun.altitudeFraction);
  });
  const report = reportFor(disagreements);

  it("covers three city morphologies with a corpus worth trusting", () => {
    expect(report.cases).toBeGreaterThanOrEqual(100);
    expect(Object.keys(report.byCity).sort()).toEqual(["kent-wa", "madrid", "singapore"]);
  });

  it("reports the disagreement metric", () => {
    // Printed on every run so the number is visible in CI logs, not just when it fails.
    console.log(formatReport(report));

    expect(Number.isFinite(report.meanAbsolute)).toBe(true);
  });

  it("stays under the committed mean threshold", () => {
    expect(report.meanAbsolute).toBeLessThanOrEqual(MAX_MEAN_DISAGREEMENT);
  });

  it("stays under the committed p90 threshold", () => {
    expect(report.p90).toBeLessThanOrEqual(MAX_P90_DISAGREEMENT);
  });

  it("keeps the severe tail rare", () => {
    // One edge the field calls shaded and the map paints sunlit is a promise the app
    // cannot keep, and p90 cannot see it while nine cases in ten agree exactly.
    expect(report.severeShare).toBeLessThanOrEqual(MAX_SEVERE_SHARE);
  });

  it("agrees in every city, not just on average", () => {
    for (const [city, mean] of Object.entries(report.byCity)) {
      expect(mean, `${city} mean disagreement`).toBeLessThanOrEqual(MAX_MEAN_DISAGREEMENT * 2);
    }
  });

  it("is measuring something — the corpus contains real shade and real sun", () => {
    // A corpus where every case is fully sunlit would report perfect agreement and
    // prove nothing. Guard against that by checking the reference itself varies.
    const references = fixtures.slice(0, 40).map((fixture) => {
      const sun = sunFor(fixture);
      return referenceFor(fixture, sun, sun.altitudeFraction);
    });
    const values = references.flatMap((r) => [r.left, r.right]);

    expect(values.some((v) => v > 0.6)).toBe(true);
    expect(values.some((v) => v < 0.4)).toBe(true);
  });
});
