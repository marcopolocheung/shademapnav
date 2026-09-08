import SunCalc from "suncalc";
import { describe, expect, it } from "vitest";
import {
  LOW_CONFIDENCE,
  type BBox,
  type EdgeRef,
  type PrismProvider,
  bboxAroundEdges,
  bboxAroundPoint,
  bboxContains,
  confidenceFor,
  edgeSampleCount,
  createGeometryShadeField,
  QUERY_PAD_M,
  sidewalkOffsets,
  staticPrismProvider,
} from "../ShadeField";
import { type PrismSet, metersPerDegree } from "../geometry";

// ─── A scene with a known sun ─────────────────────────────────────────────────

const LAT = 40.4168;
const LNG = -3.7038;
const { mPerLat, mPerLng } = metersPerDegree(LAT);

/** Midday over Madrid — high sun, short shadows, nothing near the horizon. */
const NOON = new Date("2026-06-21T12:00:00Z");
/** Well after sunset in Madrid on the same day. */
const NIGHT = new Date("2026-06-21T23:30:00Z");

const sun = SunCalc.getPosition(NOON, LAT, LNG);

/**
 * The direction a shadow travels, as a unit vector in metres (east, north).
 * `buildShadowTriangles` shifts a footprint by `(sin az, cos az) × length`, so this
 * is where the shade lands — which is what makes the expectations below hand-computable.
 */
const SHADOW_DIR: [number, number] = [Math.sin(sun.azimuth), Math.cos(sun.azimuth)];

/** A point `d` metres from the scene origin along the shadow direction. */
function alongShadow(d: number): [number, number] {
  return [LNG + (SHADOW_DIR[0] * d) / mPerLng, LAT + (SHADOW_DIR[1] * d) / mPerLat];
}

/** A point `d` metres from the scene origin across the shadow direction. */
function acrossShadow(d: number): [number, number] {
  return [LNG - (SHADOW_DIR[1] * d) / mPerLng, LAT + (SHADOW_DIR[0] * d) / mPerLat];
}

const HALF_M = 20;
/** Height chosen so the shadow is exactly 40 m long at this sun altitude. */
const SHADOW_LENGTH_M = 40;
const HEIGHT_M = SHADOW_LENGTH_M * Math.tan(sun.altitude);

/** One square building, 40 m on a side, centred on the scene origin. */
function oneBuilding(): PrismSet {
  const dLat = HALF_M / mPerLat;
  const dLng = HALF_M / mPerLng;
  return {
    prisms: [
      {
        heightM: HEIGHT_M,
        ring: [
          [LNG - dLng, LAT - dLat],
          [LNG + dLng, LAT - dLat],
          [LNG + dLng, LAT + dLat],
          [LNG - dLng, LAT + dLat],
          [LNG - dLng, LAT - dLat],
        ],
      },
    ],
    maxHeightM: HEIGHT_M,
  };
}

const WIDE_COVERAGE: BBox = bboxAroundPoint(LNG, LAT, 5000);

function fieldOverOneBuilding(source: PrismProvider["source"] = "tiles") {
  return createGeometryShadeField([staticPrismProvider(oneBuilding(), WIDE_COVERAGE, source)]);
}

// ─── shadeAt ──────────────────────────────────────────────────────────────────

describe("shadeAt", () => {
  it("shades a point inside the building's cast shadow", () => {
    const field = fieldOverOneBuilding();
    const [lng, lat] = alongShadow(35); // past the 20 m footprint, inside the 40 m shadow

    const sample = field.shadeAt(lng, lat, NOON);

    expect(sample.shade).toBe(1);
    expect(sample.source).toBe("tiles");
    expect(sample.confidence).toBeGreaterThan(LOW_CONFIDENCE);
  });

  it("leaves a point beyond the shadow's end in full sun, and stays confident about it", () => {
    const field = fieldOverOneBuilding();
    const [lng, lat] = alongShadow(HALF_M + SHADOW_LENGTH_M + 40);

    const sample = field.shadeAt(lng, lat, NOON);

    expect(sample.shade).toBe(0);
    // "The sun reaches here" is a real answer once buildings are loaded — it must
    // not read as a doubt, or A4 would fall back to the canvas on every sunlit edge.
    expect(sample.confidence).toBeGreaterThan(LOW_CONFIDENCE);
  });

  it("leaves the sun-facing side in full sun", () => {
    const field = fieldOverOneBuilding();
    const [lng, lat] = alongShadow(-35);

    expect(field.shadeAt(lng, lat, NOON).shade).toBe(0);
  });

  it("leaves a point beside the shadow in full sun", () => {
    const field = fieldOverOneBuilding();
    const [lng, lat] = acrossShadow(60);

    expect(field.shadeAt(lng, lat, NOON).shade).toBe(0);
  });

  it("reports partial shade at the shadow's edge, not a hard 0 or 1", () => {
    const field = fieldOverOneBuilding();
    // The 5-offset probe straddles the shadow's end (footprint edge + 40 m).
    const [lng, lat] = alongShadow(HALF_M + SHADOW_LENGTH_M);

    const shade = field.shadeAt(lng, lat, NOON).shade;

    expect(shade).toBeGreaterThan(0);
    expect(shade).toBeLessThan(1);
  });

  it("reports full, confident shade everywhere once the sun is down", () => {
    const field = fieldOverOneBuilding();
    const far = field.shadeAt(LNG + 3, LAT + 2, NIGHT);

    expect(far).toEqual({ shade: 1, source: "none", confidence: 1 });
    expect(field.shadeAt(...alongShadow(35), NIGHT).shade).toBe(1);
  });

  it("asks the caller to fall back when no source covers the point", () => {
    const narrow = bboxAroundPoint(LNG, LAT, 10); // far too small to contain the query bbox
    const field = createGeometryShadeField([
      staticPrismProvider(oneBuilding(), narrow, "tiles"),
    ]);

    const sample = field.shadeAt(...alongShadow(35), NOON);

    expect(sample).toEqual({ shade: 0, source: "none", confidence: 0 });
    expect(sample.confidence).toBeLessThan(LOW_CONFIDENCE);
  });

  it("takes the first provider that can speak for the area", () => {
    const empty: PrismSet = { prisms: [], maxHeightM: 1 };
    const field = createGeometryShadeField([
      staticPrismProvider(empty, bboxAroundPoint(LNG, LAT, 10), "tiles"), // cannot cover
      staticPrismProvider(oneBuilding(), WIDE_COVERAGE, "overpass"),
    ]);

    const sample = field.shadeAt(...alongShadow(35), NOON);

    expect(sample.source).toBe("overpass");
    expect(sample.shade).toBe(1);
  });

  it("hedges when a covering source has no building near the point", () => {
    const empty: PrismSet = { prisms: [], maxHeightM: 1 };
    const field = createGeometryShadeField([
      staticPrismProvider(empty, WIDE_COVERAGE, "tiles"),
    ]);

    const sample = field.shadeAt(LNG, LAT, NOON);

    // Full sun is the honest reading of the geometry, but an empty plaza and an
    // unloaded neighbourhood look identical, so this must not read as certain.
    expect(sample.shade).toBe(0);
    expect(sample.source).toBe("tiles");
    expect(sample.confidence).toBeLessThan(LOW_CONFIDENCE);
  });
});

// ─── sampleEdges ──────────────────────────────────────────────────────────────

describe("sampleEdges", () => {
  const field = fieldOverOneBuilding();

  it("reports a fully shaded edge as 1 on both sidewalks", () => {
    const edge: EdgeRef = { from: alongShadow(28), to: alongShadow(50) };

    const [shade] = field.sampleEdges([edge], NOON);

    expect(shade.left).toBe(1);
    expect(shade.right).toBe(1);
    expect(shade.source).toBe("tiles");
  });

  it("reports a fully sunlit edge as 0 on both sidewalks", () => {
    const edge: EdgeRef = { from: acrossShadow(120), to: acrossShadow(200) };

    const [shade] = field.sampleEdges([edge], NOON);

    expect(shade.left).toBe(0);
    expect(shade.right).toBe(0);
  });

  it("reports about half for an edge that runs out of the shadow", () => {
    // Starts just past the footprint, ends as far beyond the shadow's end as it
    // started inside it — so half the samples land in shade.
    const shadowEnd = HALF_M + SHADOW_LENGTH_M;
    const edge: EdgeRef = { from: alongShadow(HALF_M + 2), to: alongShadow(2 * shadowEnd - HALF_M - 2) };

    const [shade] = field.sampleEdges([edge], NOON);

    expect(shade.left).toBeGreaterThan(0.3);
    expect(shade.left).toBeLessThan(0.7);
  });

  it("distinguishes the two sidewalks of a street running along the shadow's edge", () => {
    // The edge runs across the shadow direction, offset so one sidewalk sits in
    // shade and the other in sun. This left/right split is the product asset —
    // Track B's "cross to the shaded side" cue reads exactly this.
    const shadowEnd = HALF_M + SHADOW_LENGTH_M;
    const centre = alongShadow(shadowEnd);
    const across = acrossShadow(30);
    const delta: [number, number] = [across[0] - LNG, across[1] - LAT];
    const edge: EdgeRef = {
      from: [centre[0] - delta[0], centre[1] - delta[1]],
      to: [centre[0] + delta[0], centre[1] + delta[1]],
    };

    const [shade] = field.sampleEdges([edge], NOON);

    expect(shade.left).not.toBe(shade.right);
  });

  it("reports both sidewalks fully shaded at night", () => {
    const edge: EdgeRef = { from: alongShadow(28), to: alongShadow(50) };

    const [shade] = field.sampleEdges([edge], NIGHT);

    expect(shade).toEqual({ left: 1, right: 1, source: "none", confidence: 1 });
  });

  it("returns one result per edge, in order", () => {
    const edges: EdgeRef[] = [
      { from: alongShadow(28), to: alongShadow(50) },
      { from: acrossShadow(120), to: acrossShadow(200) },
    ];

    const result = field.sampleEdges(edges, NOON);

    expect(result).toHaveLength(2);
    expect(result[0].left).toBe(1);
    expect(result[1].left).toBe(0);
  });

  it("samples long edges more densely, matching what useNavigation asks the pixel path for", () => {
    // useNavigation calls sampleBothSidewalks with max(3, ceil(distanceM / 25)); a fixed
    // count here would make A3's disagreement number measure sampling density, not shade.
    expect(edgeSampleCount(10)).toBe(3);
    expect(edgeSampleCount(75)).toBe(3);
    expect(edgeSampleCount(200)).toBe(8);
    expect(edgeSampleCount(1000)).toBe(40);
  });

  it("samples the sidewalk line itself, without smearing a neighbourhood across it", () => {
    // shadeAt softens a point query over a ±4 m neighbourhood, which is right for
    // "is this terrace shaded?". Doing the same per edge sample would displace each
    // sidewalk a second time, across the street it belongs to — A3's harness caught
    // exactly that, as a 60pp disagreement on a Madrid street.
    const justOutside = alongShadow(HALF_M + SHADOW_LENGTH_M + 2);

    const point = field.shadeAt(...justOutside, NOON);
    const [edge] = field.sampleEdges([{ from: justOutside, to: justOutside }], NOON);

    expect(point.shade).toBeGreaterThan(0); // neighbourhood reaches back into shade
    expect(edge.left).toBe(0); // the point itself is in sun
    expect(edge.right).toBe(0);
  });

  it("handles an empty edge list", () => {
    expect(field.sampleEdges([], NOON)).toEqual([]);
  });

  it("survives a zero-length edge", () => {
    const point = alongShadow(35);
    const [shade] = field.sampleEdges([{ from: point, to: point }], NOON);

    expect(shade.left).toBe(1);
    expect(shade.right).toBe(1);
  });
});

// ─── sweep ────────────────────────────────────────────────────────────────────

describe("sweep", () => {
  it("matches N separate sampleEdges calls exactly", () => {
    const field = fieldOverOneBuilding();
    const edges: EdgeRef[] = [
      { from: alongShadow(28), to: alongShadow(50) },
      { from: acrossShadow(60), to: acrossShadow(120) },
    ];
    const times = [
      new Date("2026-06-21T08:00:00Z"),
      new Date("2026-06-21T12:00:00Z"),
      new Date("2026-06-21T17:00:00Z"),
      new Date("2026-06-21T23:30:00Z"),
    ];

    const swept = field.sweep(edges, times);

    expect(swept).toHaveLength(times.length);
    times.forEach((when, i) => {
      expect(swept[i]).toEqual(field.sampleEdges(edges, when));
    });
  });

  it("returns one empty row per time for no edges", () => {
    const field = fieldOverOneBuilding();

    expect(field.sweep([], [NOON, NIGHT])).toEqual([[], []]);
  });
});

// ─── ready ────────────────────────────────────────────────────────────────────

describe("ready", () => {
  it("loads every provider that offers a preload", async () => {
    const loaded: BBox[] = [];
    const provider: PrismProvider = {
      source: "overpass",
      prismsFor: () => null,
      load: async (bbox) => {
        loaded.push(bbox);
      },
    };
    const withoutLoad: PrismProvider = { source: "tiles", prismsFor: () => null };

    await createGeometryShadeField([provider, withoutLoad]).ready(WIDE_COVERAGE);

    expect(loaded).toEqual([WIDE_COVERAGE]);
  });
});

// ─── coverage ─────────────────────────────────────────────────────────────────

describe("coverage", () => {
  const area = bboxAroundPoint(LNG, LAT, 200);

  it("reports the source that would answer, without building any geometry", () => {
    const result = fieldOverOneBuilding().coverage(area, NOON);

    expect(result.source).toBe("tiles");
    expect(result.confidence).toBe(confidenceFor("tiles", sun.altitude, 1));
  });

  it("agrees with what sampleEdges then reports for the same area and time", () => {
    const field = fieldOverOneBuilding();
    const edge: EdgeRef = { from: acrossShadow(-50), to: acrossShadow(50) };

    const promised = field.coverage(bboxAroundEdges([edge], QUERY_PAD_M)!, NOON);
    const delivered = field.sampleEdges([edge], NOON)[0];

    expect(promised.source).toBe(delivered.source);
    expect(promised.confidence).toBe(delivered.confidence);
  });

  it("reports no confidence at all when no provider covers the area", () => {
    const elsewhere = bboxAroundPoint(LNG + 40, LAT, 200);

    expect(fieldOverOneBuilding().coverage(elsewhere, NOON)).toEqual({
      source: "none",
      confidence: 0,
    });
  });

  it("is fully confident after sunset, when no geometry is needed to answer", () => {
    // Not the same "none" as an uncovered area: the sun being down is an
    // astronomical certainty, and a caller must not fall back on it.
    expect(fieldOverOneBuilding().coverage(area, NIGHT)).toEqual({
      source: "none",
      confidence: 1,
    });
  });

  it("docks a source whose geometry is only partly there", () => {
    // A provider that answers with a decimated set is the failure this guards: it
    // has buildings, so the no-geometry factor says nothing, and without the
    // completeness multiplier the field would route on it at the full tile prior.
    const partial = {
      ...staticPrismProvider(oneBuilding(), WIDE_COVERAGE, "tiles"),
      completeness: () => 0.5,
    };
    const result = createGeometryShadeField([partial]).coverage(area, NOON);

    expect(result.source).toBe("tiles");
    expect(result.confidence).toBeLessThan(LOW_CONFIDENCE);
  });

  it("docks a source that covers the area but holds no buildings", () => {
    const empty = staticPrismProvider({ prisms: [], maxHeightM: 0 }, WIDE_COVERAGE, "overpass");
    const result = createGeometryShadeField([empty]).coverage(area, NOON);

    expect(result.source).toBe("overpass");
    expect(result.confidence).toBeLessThan(LOW_CONFIDENCE);
  });
});

// ─── Confidence ───────────────────────────────────────────────────────────────

describe("confidenceFor", () => {
  const HIGH_SUN = Math.PI / 4;

  it("trusts tiles more than Overpass", () => {
    expect(confidenceFor("tiles", HIGH_SUN, 3)).toBeGreaterThan(
      confidenceFor("overpass", HIGH_SUN, 3)
    );
  });

  it("docks confidence when the covering source holds no buildings", () => {
    expect(confidenceFor("tiles", HIGH_SUN, 0)).toBeLessThan(confidenceFor("tiles", HIGH_SUN, 1));
    expect(confidenceFor("tiles", HIGH_SUN, 0)).toBeLessThan(LOW_CONFIDENCE);
  });

  it("does not dock for a point that merely sits outside every shadow", () => {
    // The count is "buildings this source knows about", not "buildings in reach".
    // Keying it off reach would push almost every sunlit sample to the fallback path.
    expect(confidenceFor("tiles", HIGH_SUN, 40)).toBe(confidenceFor("tiles", HIGH_SUN, 1));
  });

  it("falls off as the sun approaches the horizon", () => {
    const noon = confidenceFor("tiles", HIGH_SUN, 5);
    const lateAfternoon = confidenceFor("tiles", (5 * Math.PI) / 180, 5);
    const sunset = confidenceFor("tiles", 0.0001, 5);

    expect(lateAfternoon).toBeLessThan(noon);
    expect(sunset).toBeLessThan(lateAfternoon);
  });

  it("stops penalising once the sun is comfortably up", () => {
    expect(confidenceFor("tiles", (10 * Math.PI) / 180, 5)).toBe(
      confidenceFor("tiles", Math.PI / 3, 5)
    );
  });

  it("never leaves the 0–1 range", () => {
    for (const altitude of [0.0001, 0.05, 0.2, 1.4]) {
      for (const inReach of [0, 12]) {
        for (const source of ["tiles", "overpass"] as const) {
          const c = confidenceFor(source, altitude, inReach);
          expect(c).toBeGreaterThanOrEqual(0);
          expect(c).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

// ─── Geometry helpers ─────────────────────────────────────────────────────────

describe("sidewalkOffsets", () => {
  it("offsets 4 m perpendicular to the edge, one side each way", () => {
    const edge: EdgeRef = { from: [LNG, LAT], to: [LNG + 0.01, LAT] }; // due east
    const { left, right } = sidewalkOffsets(edge);

    expect(left[0]).toBeCloseTo(0, 12);
    expect(left[1] * mPerLat).toBeCloseTo(4, 1);
    expect(right[0]).toBeCloseTo(-left[0], 12);
    expect(right[1]).toBeCloseTo(-left[1], 12);
  });

  it("collapses to no offset for a zero-length edge", () => {
    const point: [number, number] = [LNG, LAT];

    expect(sidewalkOffsets({ from: point, to: point })).toEqual({ left: [0, 0], right: [0, 0] });
  });
});

describe("bbox helpers", () => {
  it("pads a point bbox by the requested metres", () => {
    const bbox = bboxAroundPoint(LNG, LAT, 100);

    expect((bbox.north - LAT) * mPerLat).toBeCloseTo(100, 6);
    expect((bbox.east - LNG) * mPerLng).toBeCloseTo(100, 6);
  });

  it("covers every edge endpoint plus padding", () => {
    const edges: EdgeRef[] = [
      { from: [LNG, LAT], to: [LNG + 0.01, LAT + 0.01] },
      { from: [LNG - 0.02, LAT - 0.005], to: [LNG, LAT] },
    ];

    const bbox = bboxAroundEdges(edges, 50);

    expect(bbox).not.toBeNull();
    expect(bbox?.west).toBeLessThan(LNG - 0.02);
    expect(bbox?.east).toBeGreaterThan(LNG + 0.01);
    expect(bbox?.south).toBeLessThan(LAT - 0.005);
    expect(bbox?.north).toBeGreaterThan(LAT + 0.01);
  });

  it("has no bbox for no edges", () => {
    expect(bboxAroundEdges([], 50)).toBeNull();
  });

  it("only contains a bbox it fully encloses", () => {
    const outer = bboxAroundPoint(LNG, LAT, 500);

    expect(bboxContains(outer, bboxAroundPoint(LNG, LAT, 100))).toBe(true);
    expect(bboxContains(outer, bboxAroundPoint(LNG, LAT, 900))).toBe(false);
    expect(bboxContains(outer, bboxAroundPoint(LNG + 0.02, LAT, 100))).toBe(false);
  });
});
