import { describe, expect, it } from "vitest";
import {
  type BuildingFeatureLike,
  type PrismMesh,
  appendPrismMesh,
  buildShadowTriangles,
  buildingHeightM,
  metersPerDegree,
  openRing,
  prismsFromFootprints,
  prismsFromTileFeatures,
} from "../geometry";
import { pointInPrismShadow } from "../shadowIndex";

// A 20 m square building centred on a point in Madrid. Latitude 40° is far
// enough from the equator that the lng/lat metre scales differ noticeably, so a
// bug that confuses the two shows up.
const LAT = 40;
const LNG = -3.7;
const { mPerLat, mPerLng } = metersPerDegree(LAT);
const HALF_M = 10;

function squareRing(): [number, number][] {
  const dLat = HALF_M / mPerLat;
  const dLng = HALF_M / mPerLng;
  return [
    [LNG - dLng, LAT - dLat],
    [LNG + dLng, LAT - dLat],
    [LNG + dLng, LAT + dLat],
    [LNG - dLng, LAT + dLat],
    [LNG - dLng, LAT - dLat], // closed, as GeoJSON and Overpass both deliver
  ];
}

/** A point `northM` metres north / `eastM` metres east of the square's centre. */
function offsetPoint(northM: number, eastM = 0): [number, number] {
  return [LNG + eastM / mPerLng, LAT + northM / mPerLat];
}

function tileFeature(
  properties: Record<string, unknown> | null,
  ring: [number, number][] = squareRing()
): BuildingFeatureLike {
  return { properties, geometry: { type: "Polygon", coordinates: [ring] } };
}

describe("buildingHeightM", () => {
  it("prefers render_height, then height, then levels", () => {
    expect(buildingHeightM({ render_height: 42, height: 9, "building:levels": 2 })).toBe(42);
    expect(buildingHeightM({ height: 9, "building:levels": 2 })).toBe(9);
    expect(buildingHeightM({ "building:levels": 4 })).toBeCloseTo(12.4, 6);
  });

  it("falls back to one storey for untagged and missing properties", () => {
    expect(buildingHeightM({})).toBeCloseTo(3.1, 6);
    expect(buildingHeightM(null)).toBeCloseTo(3.1, 6);
  });

  it("ignores non-positive and unparseable tags", () => {
    expect(buildingHeightM({ render_height: 0, height: "tall" })).toBeCloseTo(3.1, 6);
    expect(buildingHeightM({ height: -5, "building:levels": 3 })).toBeCloseTo(9.3, 6);
  });
});

describe("openRing", () => {
  it("drops a duplicated closing vertex", () => {
    expect(openRing(squareRing())).toHaveLength(4);
  });

  it("leaves an already-open ring alone", () => {
    const open = squareRing().slice(0, -1);
    expect(openRing(open)).toBe(open);
  });
});

describe("prismsFromTileFeatures", () => {
  it("builds one prism per ring with the feature's height", () => {
    const { prisms, maxHeightM } = prismsFromTileFeatures([tileFeature({ render_height: 18 })]);

    expect(prisms).toHaveLength(1);
    expect(prisms[0].heightM).toBe(18);
    expect(prisms[0].ring).toHaveLength(5);
    expect(maxHeightM).toBe(18);
  });

  it("drops underground features", () => {
    const { prisms } = prismsFromTileFeatures([
      tileFeature({ render_height: 18, underground: "true" }),
    ]);

    expect(prisms).toEqual([]);
  });

  it("drops tall features flagged hide_3d but keeps tall ones without the flag", () => {
    const hidden = prismsFromTileFeatures([tileFeature({ render_height: 150, hide_3d: true })]);
    const shown = prismsFromTileFeatures([tileFeature({ render_height: 150 })]);

    expect(hidden.prisms).toEqual([]);
    expect(shown.prisms).toHaveLength(1);
  });

  it("keeps a short hide_3d feature — the flag only disqualifies implausible heights", () => {
    const { prisms } = prismsFromTileFeatures([tileFeature({ render_height: 12, hide_3d: true })]);

    expect(prisms).toHaveLength(1);
  });

  it("orders prisms shortest building first so taller shadows composite last", () => {
    const { prisms } = prismsFromTileFeatures([
      tileFeature({ render_height: 30 }),
      tileFeature({ render_height: 6 }),
      tileFeature({ render_height: 15 }),
    ]);

    expect(prisms.map((p) => p.heightM)).toEqual([6, 15, 30]);
  });

  it("flattens MultiPolygon parts and courtyard rings into separate prisms", () => {
    const ring = squareRing();
    const multi: BuildingFeatureLike = {
      properties: { render_height: 9 },
      geometry: { type: "MultiPolygon", coordinates: [[ring, ring], [ring]] },
    };

    const { prisms } = prismsFromTileFeatures([multi]);

    expect(prisms).toHaveLength(3);
    expect(prisms.every((p) => p.heightM === 9)).toBe(true);
  });

  it("skips features that are not polygonal but still counts their height", () => {
    const point: BuildingFeatureLike = {
      properties: { render_height: 60 },
      geometry: { type: "Point", coordinates: [LNG, LAT] },
    };

    const { prisms, maxHeightM } = prismsFromTileFeatures([point, tileFeature({ height: 10 })]);

    expect(prisms).toHaveLength(1);
    // maxHeightM normalizes the renderer's height attribute; it is computed over
    // the filtered feature set, before the geometry-type check.
    expect(maxHeightM).toBe(60);
  });

  it("returns a usable divisor when there is nothing to draw", () => {
    expect(prismsFromTileFeatures([])).toEqual({ prisms: [], maxHeightM: 1 });
  });
});

describe("prismsFromFootprints", () => {
  it("carries the Overpass-resolved height onto every ring", () => {
    const { prisms, maxHeightM } = prismsFromFootprints([
      { heightM: 24, rings: [squareRing(), squareRing()] },
      { heightM: 8, rings: [squareRing()] },
    ]);

    expect(prisms.map((p) => p.heightM)).toEqual([24, 24, 8]);
    expect(maxHeightM).toBe(24);
  });

  it("returns a usable divisor for an empty fetch", () => {
    expect(prismsFromFootprints([])).toEqual({ prisms: [], maxHeightM: 1 });
  });

  it("agrees with the tile path on the same building", () => {
    const ring = squareRing();
    const fromTiles = prismsFromTileFeatures([tileFeature({ render_height: 10 }, ring)]);
    const fromOverpass = prismsFromFootprints([{ heightM: 10, rings: [ring] }]);

    expect(fromOverpass.prisms).toEqual(fromTiles.prisms);
  });
});

describe("buildShadowTriangles", () => {
  // SunCalc azimuth 0 = due south, so the shadow falls due north; altitude 45°
  // makes the shadow exactly as long as the building is tall.
  const DUE_SOUTH = 0;
  const ALT_45 = Math.PI / 4;

  it("projects the footprint away from the sun by height / tan(altitude)", () => {
    const tris = buildShadowTriangles(squareRing(), 10, DUE_SOUTH, ALT_45, mPerLat, mPerLng);
    const northernmost = Math.max(...tris.map(([, lat]) => lat));

    // North edge (+10 m) plus a 10 m shadow = 20 m north of centre.
    expect((northernmost - LAT) * mPerLat).toBeCloseTo(20, 3);
  });

  it("emits whole triangles", () => {
    const tris = buildShadowTriangles(squareRing(), 10, DUE_SOUTH, ALT_45, mPerLat, mPerLng);

    expect(tris.length % 3).toBe(0);
    expect(tris.length).toBeGreaterThan(0);
  });

  it("returns nothing for a degenerate ring", () => {
    const line: [number, number][] = [
      [LNG, LAT],
      [LNG + 0.001, LAT],
      [LNG, LAT],
    ];

    expect(buildShadowTriangles(line, 10, DUE_SOUTH, ALT_45, mPerLat, mPerLng)).toEqual([]);
  });

  it("interpolates to the analytic shadow ceiling across the whole footprint", () => {
    // The property the renderer actually depends on: rasterizing these triangles
    // under MAX blending yields, at every covered point, the height the caster
    // still shades there — `heightM - distance * tan(altitude)`. Per-vertex weights
    // are the mechanism; this is the claim. A far cap that only ever wrote its own
    // 0, or a cap wired to the wrong end of the sweep, passes the weight test above
    // and fails this one.
    const H = 40;
    const ceilings: number[] = [];
    const tris = buildShadowTriangles(
      squareRing(), H, DUE_SOUTH, ALT_45, mPerLat, mPerLng, ceilings
    );

    // What a MAX-blended rasterizer would leave at one point.
    const rasterize = (lng: number, lat: number): number => {
      let best = 0;
      for (let t = 0; t < tris.length; t += 3) {
        const [ax, ay] = tris[t];
        const [bx, by] = tris[t + 1];
        const [cx, cy] = tris[t + 2];
        const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
        if (Math.abs(det) < 1e-18) continue;
        const u = ((by - cy) * (lng - cx) + (cx - bx) * (lat - cy)) / det;
        const v = ((cy - ay) * (lng - cx) + (ax - cx) * (lat - cy)) / det;
        const w = 1 - u - v;
        const eps = -1e-9;
        if (u < eps || v < eps || w < eps) continue;
        best = Math.max(best, u * ceilings[t] + v * ceilings[t + 1] + w * ceilings[t + 2]);
      }
      return best * H;
    };

    // The square spans +/-HALF_M and the sun is due south at 45 degrees, so the
    // shadow runs due north exactly H metres. Walking north from the footprint's
    // north edge, the ceiling falls linearly from H to 0.
    const shadow = H / Math.tan(ALT_45);
    let checked = 0;
    for (let northM = -HALF_M + 1; northM <= HALF_M + shadow - 1; northM += 3) {
      const lat = LAT + northM / mPerLat;
      // Distance back to the footprint along the sun direction, 0 while inside it.
      const dist = Math.max(0, northM - HALF_M);
      const expected = H * (1 - dist / shadow);
      expect(rasterize(LNG, lat)).toBeCloseTo(expected, 6);
      checked++;
    }
    expect(checked).toBeGreaterThan(10);
  });

  it("weights the ceiling 1 under the caster and 0 at the shadow tip", () => {
    const ceilings: number[] = [];
    const tris = buildShadowTriangles(
      squareRing(), 100, DUE_SOUTH, ALT_45, mPerLat, mPerLng, ceilings
    );

    expect(ceilings).toHaveLength(tris.length);
    // The 100 m building throws a 100 m shadow at altitude 45, which puts every
    // shifted vertex far north of the footprint it came from — so latitude alone
    // says which end of the sweep a vertex belongs to.
    for (let i = 0; i < tris.length; i++) {
      const northM = (tris[i][1] - LAT) * mPerLat;
      expect(ceilings[i]).toBe(northM < 50 ? 1 : 0);
    }
    expect(ceilings).toContain(1);
    expect(ceilings).toContain(0);
  });
});

describe("appendPrismMesh", () => {
  /** A unit square in a planar frame, wound counter-clockwise. */
  const ccw: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
  const cw: [number, number][] = [[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]];
  /**
   * Its roof, pre-triangulated in the same frame. Deliberately one clockwise
   * triangle and one counter-clockwise, so a cap that re-winds nothing and a cap
   * that re-winds everything both fail.
   */
  const roofTris = [
    0, 0, 1, 1, 1, 0, // clockwise      (signed area -1)
    0, 0, 1, 1, 0, 1, // counter-clockwise (signed area +1)
  ];

  const build = (ring: [number, number][], h = 10): PrismMesh => {
    const mesh: PrismMesh = { pos: [], heightM: [], normal: [] };
    appendPrismMesh(ring, h, roofTris, mesh);
    return mesh;
  };

  /** Signed area of triangle `t` (0-based), doubled. */
  const area2 = (mesh: PrismMesh, t: number): number => {
    const [x0, y0, x1, y1, x2, y2] = mesh.pos.slice(t * 6, t * 6 + 6);
    return (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  };

  it("emits a roof cap plus two triangles per edge", () => {
    const mesh = build(ccw);
    // 2 roof triangles + 4 edges x 2 = 10 triangles, 30 vertices.
    expect(mesh.heightM).toHaveLength(30);
    expect(mesh.pos).toHaveLength(60);
    expect(mesh.normal).toHaveLength(90);
  });

  it("puts the roof at the roofline and the walls from the ground up", () => {
    const mesh = build(ccw, 10);
    expect(mesh.heightM.slice(0, 6)).toEqual([10, 10, 10, 10, 10, 10]);
    // Each wall quad runs 0,0,h / 0,h,h.
    expect(mesh.heightM.slice(6, 12)).toEqual([0, 0, 10, 0, 10, 10]);
  });

  it("points wall normals out of the ring whichever way it is wound", () => {
    // Checking the *set* of normals is not enough: reverse them all and the set is
    // unchanged. Each one has to be checked against the wall it belongs to, so the
    // test fails when a clockwise ring turns its walls inward.
    for (const ring of [ccw, cw]) {
      const mesh = build(ring);
      for (let t = 2; t < mesh.heightM.length / 3; t++) {
        const [ax, ay, bx, by] = mesh.pos.slice(t * 6, t * 6 + 4);
        const nx = mesh.normal[t * 9];
        const ny = mesh.normal[t * 9 + 1];
        // The unit square's centre is (0.5, 0.5); a wall's outward normal has to
        // point away from it.
        const midToCentre = [0.5 - (ax + bx) / 2, 0.5 - (ay + by) / 2];
        expect(nx * midToCentre[0] + ny * midToCentre[1]).toBeLessThan(0);
        expect(mesh.normal[t * 9 + 2]).toBe(0);
        expect(Math.hypot(nx, ny)).toBeCloseTo(1, 9);
      }
    }
  });

  it("winds every triangle the same way, so one cull mode covers roofs and walls", () => {
    // Back-face culling is what stops a slab seen edge-on from z-fighting its own
    // opposite wall, and it only works if the outward face of every triangle — the
    // re-wound roof cap included — turns the same way.
    for (const ring of [ccw, cw]) {
      const mesh = build(ring);
      // Both roof triangles, whichever way the caller wound them.
      expect(area2(mesh, 0)).toBeGreaterThan(0);
      expect(area2(mesh, 1)).toBeGreaterThan(0);
      for (let t = 2; t < mesh.heightM.length / 3; t++) {
        // A wall's cross product is (dy, -dx, 0) * h — the outward normal — so
        // checking it against the stored normal checks the vertex order.
        const [ax, ay, bx, by, , ] = mesh.pos.slice(t * 6, t * 6 + 6);
        const [hA, , hC] = mesh.heightM.slice(t * 3, t * 3 + 3);
        const dx = bx - ax;
        const dy = by - ay;
        const nx = mesh.normal[t * 9];
        const ny = mesh.normal[t * 9 + 1];
        const sign = hC > hA ? 1 : -1;
        expect(Math.sign(dy * nx - dx * ny) * sign).toBeGreaterThan(0);
      }
    }
  });

  it("skips the walls of a degenerate ring but still caps the roof", () => {
    const mesh = build([[0, 0], [1, 0], [0, 0]]);
    expect(mesh.heightM).toHaveLength(6); // the two roof triangles only
  });
});

describe("pointInPrismShadow", () => {
  const DUE_SOUTH = 0;
  const ALT_45 = Math.PI / 4;
  const prisms = prismsFromFootprints([{ heightM: 10, rings: [squareRing()] }]).prisms;

  const inShadow = (point: [number, number]) =>
    pointInPrismShadow(prisms, point[0], point[1], DUE_SOUTH, ALT_45, mPerLat, mPerLng);

  it("shades a point between the building and the end of its shadow", () => {
    expect(inShadow(offsetPoint(15))).toBe(true);
  });

  it("leaves a point beyond the shadow's reach sunlit", () => {
    expect(inShadow(offsetPoint(25))).toBe(false);
  });

  it("leaves the sun-facing side sunlit", () => {
    expect(inShadow(offsetPoint(-15))).toBe(false);
  });

  it("leaves a point beside the shadow sunlit", () => {
    expect(inShadow(offsetPoint(15, 25))).toBe(false);
  });

  it("reports a point on the roof as sunlit, not shaded", () => {
    expect(inShadow(offsetPoint(0))).toBe(false);
  });

  it("swings the shadow with the sun's azimuth", () => {
    const dueWest = Math.PI / 2; // SunCalc measures azimuth from south, west-positive
    const eastOfBuilding = offsetPoint(0, 15);

    expect(
      pointInPrismShadow(prisms, eastOfBuilding[0], eastOfBuilding[1], dueWest, ALT_45, mPerLat, mPerLng)
    ).toBe(true);
    expect(inShadow(eastOfBuilding)).toBe(false);
  });

  it("stretches the shadow as the sun drops", () => {
    const far = offsetPoint(40);
    const lowSun = Math.atan(1 / 5); // shadow 5× the building height = 50 m

    expect(inShadow(far)).toBe(false);
    expect(pointInPrismShadow(prisms, far[0], far[1], DUE_SOUTH, lowSun, mPerLat, mPerLng)).toBe(true);
  });

  it("shades nothing when there is no geometry", () => {
    expect(pointInPrismShadow([], LNG, LAT, DUE_SOUTH, ALT_45, mPerLat, mPerLng)).toBe(false);
  });
});
