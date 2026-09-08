import { describe, expect, it } from "vitest";
import {
  type EdgeShadeSource,
  describeShadeProvenance,
  summarizeShadeSource,
} from "../shadeProvenance";
import type { ShadeSource } from "../shade/ShadeField";

/**
 * A straight path of `nodeIds`, every leg the same length unless `lengths` says
 * otherwise — so a test can talk about shares of the path without doing arithmetic.
 */
function pathOf(nodeIds: number[], lengths?: number[]) {
  const distanceFor = (a: number, b: number) => {
    if (!lengths) return 100;
    const i = nodeIds.findIndex((id, idx) => id === a && nodeIds[idx + 1] === b);
    return i === -1 ? 100 : lengths[i];
  };
  return { nodeIds, distanceFor };
}

function shade(source: ShadeSource, confidence = 0.8): EdgeShadeSource {
  return { source, confidence };
}

/** Entries for consecutive pairs of `nodeIds`, keyed the way routing keys them. */
function entriesFor(nodeIds: number[], samples: Array<EdgeShadeSource | null>) {
  const map = new Map<string, EdgeShadeSource>();
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    if (!sample) continue;
    const a = nodeIds[i];
    const b = nodeIds[i + 1];
    map.set(`${Math.min(a, b)},${Math.max(a, b)}`, sample);
  }
  return map;
}

describe("summarizeShadeSource", () => {
  it("credits a wholly geometry-sourced route to geometry", () => {
    const { nodeIds, distanceFor } = pathOf([1, 2, 3, 4]);
    const entries = entriesFor(nodeIds, [shade("tiles"), shade("tiles"), shade("tiles")]);

    const p = summarizeShadeSource(nodeIds, entries, distanceFor);

    expect(p.dominant).toBe("tiles");
    expect(p.bySource.tiles).toBe(1);
    expect(p.sampledFraction).toBe(1);
  });

  it("keeps a short weak segment from renaming a long confident route", () => {
    // The bug this guards: summarising the whole graph rather than the chosen path
    // would let a 40%-fallback graph label a route whose own edges are all geometry.
    // Here the canvas edge is 5% of the distance — it must move confidence, not source.
    const nodeIds = [1, 2, 3, 4];
    const { distanceFor } = pathOf(nodeIds, [950, 50, 1000]);
    const entries = entriesFor(nodeIds, [
      shade("tiles", 0.8),
      shade("canvas", 0.3),
      shade("tiles", 0.8),
    ]);

    const p = summarizeShadeSource(nodeIds, entries, distanceFor);

    expect(p.dominant).toBe("tiles");
    expect(p.minConfidence).toBe(0.3);
    expect(p.meanConfidence).toBeGreaterThan(0.7);
  });

  it("refuses to name a dominant source when the path is split evenly", () => {
    const nodeIds = [1, 2, 3];
    const { distanceFor } = pathOf(nodeIds, [500, 500]);
    const entries = entriesFor(nodeIds, [shade("tiles"), shade("canvas")]);

    const p = summarizeShadeSource(nodeIds, entries, distanceFor);

    expect(describeShadeProvenance(p)).toBe("mixed sources");
  });

  it("counts unsampled virtual snap edges without letting them dock confidence", () => {
    // Virtual nodes are negative and never sampled. Every route starts and ends on
    // one, so if their absence counted as zero confidence, every route in the app
    // would be labelled low-confidence.
    const nodeIds = [-1, 2, 3, -2];
    const { distanceFor } = pathOf(nodeIds, [20, 960, 20]);
    const entries = entriesFor(nodeIds, [null, shade("tiles", 0.8), null]);

    const p = summarizeShadeSource(nodeIds, entries, distanceFor);

    expect(p.bySource.none).toBeCloseTo(0.04, 5);
    expect(p.sampledFraction).toBeCloseTo(0.96, 5);
    expect(p.minConfidence).toBe(0.8);
  });

  it("reports nothing sampled as full confidence rather than none", () => {
    const { nodeIds, distanceFor } = pathOf([-1, -2]);

    const p = summarizeShadeSource(nodeIds, new Map(), distanceFor);

    expect(p.sampledFraction).toBe(0);
    expect(p.minConfidence).toBe(1);
    expect(describeShadeProvenance(p)).toBe("source unknown");
  });

  it("has nothing to say about a path with no edges", () => {
    const p = summarizeShadeSource([7], new Map(), () => 100);

    expect(p.dominant).toBe("none");
    expect(p.bySource).toEqual({});
  });
});

describe("describeShadeProvenance", () => {
  const { nodeIds, distanceFor } = pathOf([1, 2, 3, 4]);
  const summarize = (samples: Array<EdgeShadeSource | null>) =>
    describeShadeProvenance(
      summarizeShadeSource(nodeIds, entriesFor(nodeIds, samples), distanceFor)
    );

  it("names geometry for either geometric provider", () => {
    expect(summarize([shade("tiles"), shade("tiles"), shade("tiles")])).toBe(
      "from building geometry"
    );
    expect(summarize([shade("overpass"), shade("overpass"), shade("overpass")])).toBe(
      "from building geometry"
    );
  });

  it("names the map view when the pixel sampler answered", () => {
    expect(summarize([shade("canvas"), shade("canvas"), shade("canvas")])).toBe(
      "from the map view"
    );
  });

  it("says the sun is down rather than claiming a missing source", () => {
    // After sunset the field reports source "none" with full confidence for every
    // edge. That is an answer, not a gap, and must not read as one.
    expect(summarize([shade("none", 1), shade("none", 1), shade("none", 1)])).toBe(
      "sun is below the horizon"
    );
  });

  it("appends the caveat when any sampled edge was weak", () => {
    expect(summarize([shade("tiles", 0.8), shade("tiles", 0.2), shade("tiles", 0.8)])).toBe(
      "from building geometry · low confidence"
    );
  });

  it("does not append the caveat to a mixed route whose edges were all decent", () => {
    // Mixed sources is a statement about provenance, not about doubt: every edge
    // here cleared LOW_CONFIDENCE, so nothing should suggest the number is shaky.
    expect(summarize([shade("tiles", 0.8), shade("canvas", 0.6), shade("tiles", 0.8)])).toBe(
      "mixed sources"
    );
  });
});
