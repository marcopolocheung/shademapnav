/**
 * `shadowIndex` must answer exactly what `pointInPrismShadow` answered before it.
 *
 * The index is a performance change wearing correctness clothes: it drops prisms
 * (the region filter), reorders which ones a point is tested against (the grid), and
 * moves the geometry build out of the query. Any of those three can change an answer
 * silently, and a wrong shadow number is invisible in review and contaminates routing.
 *
 * So the gate here is a frozen copy of the pre-index implementation, asserted point
 * for point rather than in aggregate — the technique `tileGeometryParity.test.ts`
 * already uses. The reference calls the real `buildShadowTriangles`, which that file
 * pins separately; what is frozen here is the query logic the index replaces.
 */

import { describe, expect, it } from "vitest";
import {
  type BuildingPrism,
  buildShadowTriangles,
  metersPerDegree,
} from "../geometry";
import {
  buildShadowIndex,
  buildShadowIndexFor,
  prepareShadowCasters,
  shadowTrianglesFlat,
} from "../shadowIndex";

// ─── Pre-index implementation, copied from main ───────────────────────────────

function refPointInTriangle(
  lng: number,
  lat: number,
  a: [number, number],
  b: [number, number],
  c: [number, number]
): boolean {
  const v0x = c[0] - a[0];
  const v0y = c[1] - a[1];
  const v1x = b[0] - a[0];
  const v1y = b[1] - a[1];
  const v2x = lng - a[0];
  const v2y = lat - a[1];

  const dot00 = v0x * v0x + v0y * v0y;
  const dot01 = v0x * v1x + v0y * v1y;
  const dot02 = v0x * v2x + v0y * v2y;
  const dot11 = v1x * v1x + v1y * v1y;
  const dot12 = v1x * v2x + v1y * v2y;
  const denom = dot00 * dot11 - dot01 * dot01;
  if (Math.abs(denom) < 1e-20) return false;

  const invDenom = 1 / denom;
  const u = (dot11 * dot02 - dot01 * dot12) * invDenom;
  const v = (dot00 * dot12 - dot01 * dot02) * invDenom;
  return u >= 0 && v >= 0 && u + v <= 1;
}

function refPointInPolygon(lng: number, lat: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersects =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi || 1e-20) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function refPointInPrismShadow(
  prisms: BuildingPrism[],
  lng: number,
  lat: number,
  sunAzimuth: number,
  sunAltitude: number,
  mPerLat: number,
  mPerLng: number
): boolean {
  for (const prism of prisms) {
    if (refPointInPolygon(lng, lat, prism.ring)) return false;
  }

  for (const prism of prisms) {
    const tris = buildShadowTriangles(
      prism.ring, prism.heightM, sunAzimuth, sunAltitude, mPerLat, mPerLng
    );
    for (let i = 0; i < tris.length; i += 3) {
      if (refPointInTriangle(lng, lat, tris[i], tris[i + 1], tris[i + 2])) return true;
    }
  }

  return false;
}

// ─── Corpus ───────────────────────────────────────────────────────────────────

/** Madrid: far enough from the equator that the lng/lat metre scales differ visibly. */
const LAT = 40.4168;
const LNG = -3.7038;
const { mPerLat, mPerLng } = metersPerDegree(LAT);

/** mulberry32 — a small deterministic PRNG, so the corpus is identical every run. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A rectangle in metres east/north of the corpus origin. */
function block(eastM: number, northM: number, wM: number, hM: number): [number, number][] {
  const w = eastM / mPerLng;
  const s = northM / mPerLat;
  const e = (eastM + wM) / mPerLng;
  const n = (northM + hM) / mPerLat;
  return [
    [LNG + w, LAT + s],
    [LNG + e, LAT + s],
    [LNG + e, LAT + n],
    [LNG + w, LAT + n],
  ];
}

/**
 * A ragged city block grid — irregular enough that footprints land inside other
 * buildings' shadows, which is the case a tidy grid never reaches.
 *
 * `half` is the grid's half-width in blocks: the default 3 gives 49 prisms, and
 * anything from 4 up clears `GRID_MIN_CASTERS`, which is what puts the A6 footprint
 * grid in play. Both sides of that threshold need covering.
 */
function corpus(seed: number, half = 3): BuildingPrism[] {
  const rand = rng(seed);
  const prisms: BuildingPrism[] = [];
  for (let gx = -half; gx <= half; gx++) {
    for (let gy = -half; gy <= half; gy++) {
      const eastM = gx * 70 + (rand() - 0.5) * 20;
      const northM = gy * 70 + (rand() - 0.5) * 20;
      const side = 25 + rand() * 30;
      prisms.push({
        ring: block(eastM, northM, side, side * (0.6 + rand() * 0.8)),
        heightM: 8 + rand() * 90,
      });
    }
  }
  return prisms;
}

/** A day's worth of sun, from a low winter morning to near-overhead. */
const SUN_POSITIONS: Array<{ azimuth: number; altitude: number }> = [
  { azimuth: -1.9, altitude: 0.12 },
  { azimuth: -1.0, altitude: 0.55 },
  { azimuth: 0, altitude: 1.15 },
  { azimuth: 0.9, altitude: 0.6 },
  { azimuth: 1.85, altitude: 0.1 },
];

/** Wide enough to hold the corpus and every shadow it casts at these sun angles. */
const WIDE_REGION = {
  west: LNG - 4000 / mPerLng,
  east: LNG + 4000 / mPerLng,
  south: LAT - 4000 / mPerLat,
  north: LAT + 4000 / mPerLat,
};

// ─── Equivalence with the pre-index implementation ────────────────────────────

describe("buildShadowIndex", () => {
  it("answers exactly what pointInPrismShadow answered, point for point", () => {
    const prisms = corpus(42);
    let shadowed = 0;
    let compared = 0;

    for (const sun of SUN_POSITIONS) {
      const index = buildShadowIndex(prisms, sun.azimuth, sun.altitude, mPerLat, mPerLng, WIDE_REGION);

      for (let gx = -11; gx <= 11; gx++) {
        for (let gy = -11; gy <= 11; gy++) {
          const lng = LNG + (gx * 24) / mPerLng;
          const lat = LAT + (gy * 24) / mPerLat;

          const before = refPointInPrismShadow(
            prisms, lng, lat, sun.azimuth, sun.altitude, mPerLat, mPerLng
          );
          expect(index.isShadowed(lng, lat)).toBe(before);
          compared++;
          if (before) shadowed++;
        }
      }
    }

    // Guard against a vacuous pass: the corpus must actually cast shadow somewhere,
    // and must not be so shadowed that agreement is trivial.
    expect(compared).toBe(SUN_POSITIONS.length * 23 * 23);
    expect(shadowed).toBeGreaterThan(200);
    expect(shadowed).toBeLessThan(compared - 200);
  });

  it("agrees with the reference across several independent corpora", () => {
    for (const seed of [1, 7, 1337]) {
      const prisms = corpus(seed);
      const sun = SUN_POSITIONS[1];
      const index = buildShadowIndex(prisms, sun.azimuth, sun.altitude, mPerLat, mPerLng, null);

      for (let gx = -8; gx <= 8; gx++) {
        for (let gy = -8; gy <= 8; gy++) {
          const lng = LNG + (gx * 30) / mPerLng;
          const lat = LAT + (gy * 30) / mPerLat;
          expect(index.isShadowed(lng, lat)).toBe(
            refPointInPrismShadow(prisms, lng, lat, sun.azimuth, sun.altitude, mPerLat, mPerLng)
          );
        }
      }
    }
  });
});

// ─── Prepared casters, and the footprint pre-filter they carry (A6) ───────────

/**
 * A6 moved the sun-independent half of the build — ring bounds, the flat ring, the
 * near cap, and a grid over footprints — out of `buildShadowIndex` and into
 * `prepareShadowCasters`, so a time sweep pays for it once. Two things can go wrong
 * silently: the prepared form can differ from what the per-sun build computed, and
 * the footprint pre-filter can drop a building whose shadow really does reach the
 * region. Both show up as a point that quietly reads sunlit.
 *
 * Every corpus here is 9x9 = 81 prisms, over `GRID_MIN_CASTERS`, because below that
 * threshold no footprint grid is built and the pre-filter is never exercised at all.
 */
describe("prepared casters", () => {
  const DENSE_HALF = 4;

  it("answers exactly what pointInPrismShadow answered, with the footprint grid live", () => {
    const prisms = corpus(42, DENSE_HALF);
    expect(prepareShadowCasters(prisms).grid).not.toBeNull();

    let shadowed = 0;
    let compared = 0;
    for (const sun of SUN_POSITIONS) {
      const index = buildShadowIndex(prisms, sun.azimuth, sun.altitude, mPerLat, mPerLng, WIDE_REGION);
      for (let gx = -11; gx <= 11; gx++) {
        for (let gy = -11; gy <= 11; gy++) {
          const lng = LNG + (gx * 24) / mPerLng;
          const lat = LAT + (gy * 24) / mPerLat;
          const before = refPointInPrismShadow(
            prisms, lng, lat, sun.azimuth, sun.altitude, mPerLat, mPerLng
          );
          expect(index.isShadowed(lng, lat)).toBe(before);
          compared++;
          if (before) shadowed++;
        }
      }
    }

    expect(shadowed).toBeGreaterThan(200);
    expect(shadowed).toBeLessThan(compared - 200);
  });

  it("keeps a shadow that reaches a tight region from far outside it", () => {
    // The pre-filter expands the region by the tallest prism's reach and reads the
    // footprint grid. Get that expansion wrong and this tower — whose footprint sits
    // 280 m east of the region, four footprint cells away, and whose shadow lands
    // squarely inside it — is never triangulated, and the point reads as open sun.
    // The filler is a band of low blocks a kilometre north: enough of them to build
    // the grid at all, too short and too far to shadow anything near the target.
    const prisms: BuildingPrism[] = [];
    for (let i = 0; i < 80; i++) prisms.push({ ring: block(i * 8, 1000, 6, 6), heightM: 2 });
    const tower: BuildingPrism = { ring: block(300, 0, 40, 40), heightM: 120 };
    prisms.push(tower);

    // Azimuth -pi/2 shifts the footprint due west by height / tan(0.35) ~ 330 m.
    const sun = { azimuth: -Math.PI / 2, altitude: 0.35 };
    const target: [number, number] = [LNG + 20 / mPerLng, LAT + 20 / mPerLat];
    const region = {
      west: target[0] - 30 / mPerLng,
      east: target[0] + 30 / mPerLng,
      south: target[1] - 30 / mPerLat,
      north: target[1] + 30 / mPerLat,
    };

    expect(prepareShadowCasters(prisms).grid).not.toBeNull();
    const withTower = buildShadowIndex(prisms, sun.azimuth, sun.altitude, mPerLat, mPerLng, region);
    const withoutTower = buildShadowIndex(
      prisms.slice(0, -1), sun.azimuth, sun.altitude, mPerLat, mPerLng, region
    );

    // Guard against a vacuous pass: the tower has to be what shadows this point.
    expect(withoutTower.isShadowed(target[0], target[1])).toBe(false);
    expect(withTower.isShadowed(target[0], target[1])).toBe(true);
    expect(withTower.isShadowed(target[0], target[1])).toBe(
      refPointInPrismShadow(prisms, target[0], target[1], sun.azimuth, sun.altitude, mPerLat, mPerLng)
    );
  });

  it("gives the same answers reused across sun positions as prepared per position", () => {
    const prisms = corpus(1337, DENSE_HALF);
    const shared = prepareShadowCasters(prisms);

    for (const sun of SUN_POSITIONS) {
      const reused = buildShadowIndexFor(
        shared, sun.azimuth, sun.altitude, mPerLat, mPerLng, WIDE_REGION
      );
      const fresh = buildShadowIndexFor(
        prepareShadowCasters(prisms), sun.azimuth, sun.altitude, mPerLat, mPerLng, WIDE_REGION
      );

      expect(reused.prismCount).toBe(fresh.prismCount);
      for (let gx = -9; gx <= 9; gx++) {
        for (let gy = -9; gy <= 9; gy++) {
          const lng = LNG + (gx * 28) / mPerLng;
          const lat = LAT + (gy * 28) / mPerLat;
          expect(reused.isShadowed(lng, lat)).toBe(fresh.isShadowed(lng, lat));
        }
      }
    }
  });

  it("keeps every far shadow that reaches a region far tighter than the reach", () => {
    // The test above is one hand-built scenario at one sun angle. This is the same
    // property asked in bulk: a 60 m region inside a corpus that spans ~560 m, whose
    // tallest prism throws an ~800 m shadow at the lowest sun here. Every prism in
    // the set is therefore a live candidate for this region and none may be dropped.
    // `WIDE_REGION` cannot see this — it is ±4 km, so the expansion radius never
    // matters there and a pre-filter that expanded by nothing would still pass.
    const prisms = corpus(21, DENSE_HALF);
    expect(prepareShadowCasters(prisms).grid).not.toBeNull();

    const region = {
      west: LNG - 30 / mPerLng,
      east: LNG + 30 / mPerLng,
      south: LAT - 30 / mPerLat,
      north: LAT + 30 / mPerLat,
    };

    let shadowed = 0;
    let compared = 0;
    for (const sun of SUN_POSITIONS) {
      const index = buildShadowIndex(prisms, sun.azimuth, sun.altitude, mPerLat, mPerLng, region);
      for (let gx = -5; gx <= 5; gx++) {
        for (let gy = -5; gy <= 5; gy++) {
          const lng = LNG + (gx * 5) / mPerLng;
          const lat = LAT + (gy * 5) / mPerLat;
          const before = refPointInPrismShadow(
            prisms, lng, lat, sun.azimuth, sun.altitude, mPerLat, mPerLng
          );
          expect(index.isShadowed(lng, lat)).toBe(before);
          compared++;
          if (before) shadowed++;
        }
      }
    }

    expect(shadowed).toBeGreaterThan(30);
    expect(shadowed).toBeLessThan(compared - 30);
  });

  it("agrees on ragged rings, open and closed, where earcut has a real choice to make", () => {
    // Every ring in the rest of this file is a four-vertex axis-aligned rectangle,
    // which `earcut` triangulates one way and only one way, and which `openRing`
    // never has to shorten. Neither the near cap cut once in `prepareShadowCasters`
    // nor the far cap cut per sun is under any pressure there. These rings are
    // concave, 6 to 9 vertices, and half of them arrive closed.
    const rand = rng(4242);
    const prisms: BuildingPrism[] = [];
    for (let b = 0; b < 90; b++) {
      const eastM = ((b % 10) - 5) * 90 + (rand() - 0.5) * 20;
      const northM = (Math.floor(b / 10) - 4) * 90 + (rand() - 0.5) * 20;
      const points = 6 + Math.floor(rand() * 4);
      const ring: [number, number][] = [];
      for (let v = 0; v < points; v++) {
        // Alternating radii make the ring a star: concave everywhere, and never
        // self-intersecting, so `earcut` has a genuine choice of diagonals.
        const angle = (v / points) * 2 * Math.PI;
        const radius = (v % 2 === 0 ? 30 : 12) * (0.7 + rand() * 0.6);
        ring.push([
          LNG + (eastM + Math.cos(angle) * radius) / mPerLng,
          LAT + (northM + Math.sin(angle) * radius) / mPerLat,
        ]);
      }
      if (b % 2 === 0) ring.push([ring[0][0], ring[0][1]]);
      prisms.push({ ring, heightM: 10 + rand() * 80 });
    }

    let shadowed = 0;
    let compared = 0;
    for (const sun of SUN_POSITIONS) {
      const index = buildShadowIndex(prisms, sun.azimuth, sun.altitude, mPerLat, mPerLng, WIDE_REGION);
      for (let gx = -14; gx <= 14; gx++) {
        for (let gy = -12; gy <= 12; gy++) {
          const lng = LNG + (gx * 22) / mPerLng;
          const lat = LAT + (gy * 22) / mPerLat;
          const before = refPointInPrismShadow(
            prisms, lng, lat, sun.azimuth, sun.altitude, mPerLat, mPerLng
          );
          expect(index.isShadowed(lng, lat)).toBe(before);
          compared++;
          if (before) shadowed++;
        }
      }
    }

    expect(shadowed).toBeGreaterThan(200);
    expect(shadowed).toBeLessThan(compared - 200);
  });

  it("emits the triangles buildShadowTriangles emits, vertex for vertex", () => {
    // The renderer still calls `buildShadowTriangles`; the index now emits the same
    // triangles itself, flat. Nothing else pins the two together — the frozen
    // reference compares them *through* `isShadowed`, which cannot see a difference
    // that changes the triangles without changing the region they cover, and a
    // differently-cut cap over the same polygon is exactly that. So compare the
    // vertices directly, over rings where the cut is not forced.
    const rand = rng(31337);
    let compared = 0;

    for (let b = 0; b < 60; b++) {
      const points = 5 + Math.floor(rand() * 5);
      const ring: [number, number][] = [];
      for (let v = 0; v < points; v++) {
        const angle = (v / points) * 2 * Math.PI;
        const radius = (v % 2 === 0 ? 28 : 11) * (0.7 + rand() * 0.6);
        ring.push([
          LNG + (Math.cos(angle) * radius) / mPerLng,
          LAT + (Math.sin(angle) * radius) / mPerLat,
        ]);
      }
      // Half closed, half open: `openRingLength` has to shorten one and not the other.
      if (b % 2 === 0) ring.push([ring[0][0], ring[0][1]]);

      const heightM = 10 + rand() * 80;
      const [caster] = prepareShadowCasters([{ ring, heightM }]).casters;

      for (const sun of SUN_POSITIONS) {
        const shadowLengthM = heightM / Math.tan(sun.altitude);
        const dLat = (Math.cos(sun.azimuth) * shadowLengthM) / mPerLat;
        const dLng = (Math.sin(sun.azimuth) * shadowLengthM) / mPerLng;

        const expected = buildShadowTriangles(
          ring, heightM, sun.azimuth, sun.altitude, mPerLat, mPerLng
        );
        // A ground-standing caster sweeps from its own footprint: base shift 0.
        const actual = shadowTrianglesFlat(caster, 0, 0, dLng, dLat);

        expect(actual.length).toBe(expected.length * 2);
        for (let i = 0; i < expected.length; i++) {
          expect(actual[i * 2]).toBe(expected[i][0]);
          expect(actual[i * 2 + 1]).toBe(expected[i][1]);
        }
        compared += expected.length;
      }
    }

    // Guard against a vacuous pass: rings that produced nothing would agree trivially.
    expect(compared).toBeGreaterThan(10000);
  });

  it("scans everything when the sun is too low for a bounded reach", () => {
    // `maxAbsHeightM / tan(altitude)` is not finite at the horizon, so the pre-filter
    // has no radius to expand by and must decline to filter rather than guess.
    const prisms = corpus(7, DENSE_HALF);
    const region = {
      west: LNG - 50 / mPerLng,
      east: LNG + 50 / mPerLng,
      south: LAT - 50 / mPerLat,
      north: LAT + 50 / mPerLat,
    };

    for (const altitude of [0, 1e-9]) {
      const index = buildShadowIndex(prisms, 1.2, altitude, mPerLat, mPerLng, region);
      expect(index.isShadowed(LNG, LAT)).toBe(
        refPointInPrismShadow(prisms, LNG, LAT, 1.2, altitude, mPerLat, mPerLng)
      );
    }
  });
});

// ─── Footprint precedence ─────────────────────────────────────────────────────

describe("footprint precedence", () => {
  /** Due south, 45° up: a shadow exactly as long as the building is tall, cast north. */
  const DUE_SOUTH = 0;
  const ALT_45 = Math.PI / 4;

  /** A tower whose 60 m shadow swallows a low neighbour standing 20 m to the north. */
  const tower: BuildingPrism = { ring: block(0, 0, 30, 30), heightM: 60 };
  const neighbour: BuildingPrism = { ring: block(0, 50, 30, 30), heightM: 4 };

  it("reports a roof inside a taller building's shadow as sunlit, not shadowed", () => {
    const index = buildShadowIndex(
      [tower, neighbour], DUE_SOUTH, ALT_45, mPerLat, mPerLng, null
    );
    // A point on the low neighbour's roof, which sits well inside the tower's shadow.
    const onRoof: [number, number] = [LNG + 15 / mPerLng, LAT + 65 / mPerLat];

    expect(index.isShadowed(...onRoof)).toBe(false);
    expect(
      refPointInPrismShadow([tower, neighbour], onRoof[0], onRoof[1], DUE_SOUTH, ALT_45, mPerLat, mPerLng)
    ).toBe(false);
  });

  it("still shadows the ground beside that roof", () => {
    const index = buildShadowIndex(
      [tower, neighbour], DUE_SOUTH, ALT_45, mPerLat, mPerLng, null
    );
    // Same latitude, but east of the neighbour's footprint — inside the tower's shadow
    // only if the shadow really reaches this far.
    expect(index.isShadowed(LNG + 15 / mPerLng, LAT + 40 / mPerLat)).toBe(true);
  });

  it("does not let the order prisms are listed in change the answer", () => {
    const forward = buildShadowIndex([tower, neighbour], DUE_SOUTH, ALT_45, mPerLat, mPerLng, null);
    const reversed = buildShadowIndex([neighbour, tower], DUE_SOUTH, ALT_45, mPerLat, mPerLng, null);

    for (let m = -20; m <= 120; m += 5) {
      const lat = LAT + m / mPerLat;
      expect(reversed.isShadowed(LNG + 15 / mPerLng, lat)).toBe(
        forward.isShadowed(LNG + 15 / mPerLng, lat)
      );
    }
  });
});

// ─── Elevated and translucent casters (A7, issues #276 and #244) ──────────────

describe("elevated casters", () => {
  const DUE_SOUTH = 0;
  /** Steep enough that a 3 m base shift is much shorter than the crown's own radius. */
  const ALT_80 = (80 * Math.PI) / 180;
  const ALT_45 = Math.PI / 4;

  /** A crown-sized octagon centred `eastM`/`northM` from the origin. */
  function crown(eastM: number, northM: number, radiusM: number): [number, number][] {
    const ring: [number, number][] = [];
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * 2 * Math.PI;
      ring.push([
        LNG + (eastM + Math.cos(angle) * radiusM) / mPerLng,
        LAT + (northM + Math.sin(angle) * radiusM) / mPerLat,
      ]);
    }
    ring.push([ring[0][0], ring[0][1]]);
    return ring;
  }

  /** A 9 m tree with a 3.5 m crown starting 3.15 m up — `canopy.ts`'s defaults. */
  const tree: BuildingPrism = {
    ring: crown(0, 0, 3.5),
    heightM: 9,
    baseM: 9 * 0.35,
    opacity: 0.9,
  };

  it("shadows the ground directly beneath it, which the footprint pass used to veto", () => {
    // The whole of issue #276: exclusion is a property of the caster, not the index.
    // At 80° the crown's shadow is displaced 0.56 m — well inside a 3.5 m radius — so
    // the point under the trunk is genuinely in shadow and must be reported so.
    const index = buildShadowIndex([tree], DUE_SOUTH, ALT_80, mPerLat, mPerLng, null);
    expect(index.isShadowed(LNG, LAT)).toBe(true);
    expect(index.opacityAt(LNG, LAT)).toBeCloseTo(0.9, 10);
  });

  it("keeps a ground-standing building's roof lit", () => {
    // The other half of #276's acceptance: nothing about the building case moved.
    const building: BuildingPrism = { ring: block(0, 0, 30, 30), heightM: 60 };
    const index = buildShadowIndex([building], DUE_SOUTH, ALT_45, mPerLat, mPerLng, null);
    expect(index.isShadowed(LNG + 15 / mPerLng, LAT + 15 / mPerLat)).toBe(false);
  });

  it("leaves the gap a ground-to-crown solid would wrongly fill", () => {
    // The other half of `baseM`, and the reason A7 needs it rather than just the
    // exclusion flag. At 10° the 3.15 m trunk displaces the crown's shadow 17.9 m, so
    // the ground 8 m from the trunk is in full sun. Model the crown from the ground up
    // and the same point reads shadowed — overstating, which is the direction that
    // routes someone into sun while promising shadow.
    const ALT_10 = (10 * Math.PI) / 180;
    const gap: [number, number] = [LNG, LAT + 8 / mPerLat];
    const elevated = buildShadowIndex([tree], DUE_SOUTH, ALT_10, mPerLat, mPerLng, null);
    const grounded = buildShadowIndex(
      [{ ...tree, baseM: 0 }], DUE_SOUTH, ALT_10, mPerLat, mPerLng, null
    );

    expect(elevated.isShadowed(...gap)).toBe(false);
    expect(grounded.isShadowed(...gap)).toBe(true);
  });

  it("still reaches as far as a ground-based caster of the same height", () => {
    // The far edge is set by the top, so lifting the base shortens the shadow's near
    // end and not its reach. A point 8 m north at 45° is under both.
    const far: [number, number] = [LNG, LAT + 8 / mPerLat];
    expect(buildShadowIndex([tree], DUE_SOUTH, ALT_45, mPerLat, mPerLng, null).isShadowed(...far))
      .toBe(true);
  });

  it("reports the largest opacity among overlapping casters, never their sum", () => {
    const sparse: BuildingPrism = { ...tree, opacity: 0.3 };
    const dense: BuildingPrism = { ...tree, opacity: 0.9 };
    const index = buildShadowIndex([sparse, dense], DUE_SOUTH, ALT_80, mPerLat, mPerLng, null);
    expect(index.opacityAt(LNG, LAT)).toBeCloseTo(0.9, 10);
  });

  it("agrees with isShadowed everywhere, in both directions", () => {
    const building: BuildingPrism = { ring: block(20, 20, 30, 30), heightM: 40 };
    const index = buildShadowIndex(
      [tree, building], DUE_SOUTH, ALT_45, mPerLat, mPerLng, null
    );
    let shadowed = 0;
    for (let e = -20; e <= 80; e += 2) {
      for (let n = -20; n <= 80; n += 2) {
        const lng = LNG + e / mPerLng;
        const lat = LAT + n / mPerLat;
        const opacity = index.opacityAt(lng, lat);
        expect(index.isShadowed(lng, lat)).toBe(opacity > 0);
        if (opacity > 0) shadowed++;
      }
    }
    // Guard against a vacuous pass over an all-sunlit grid.
    expect(shadowed).toBeGreaterThan(100);
  });

  it("leaves an all-opaque set answering 1 and 0, exactly as before", () => {
    const prisms = corpus(42, 4);
    const index = buildShadowIndex(prisms, 0.7, ALT_45, mPerLat, mPerLng, null);
    for (let e = -100; e <= 100; e += 7) {
      for (let n = -100; n <= 100; n += 7) {
        const lng = LNG + e / mPerLng;
        const lat = LAT + n / mPerLat;
        expect(index.opacityAt(lng, lat)).toBe(index.isShadowed(lng, lat) ? 1 : 0);
      }
    }
  });
});

// ─── The grid itself ──────────────────────────────────────────────────────────

describe("the grid", () => {
  it("finds a shadow that stretches across many cells, at either end", () => {
    // 10° sun: a 40 m tower throws a ~227 m shadow, far longer than one cell.
    const lowSun = (10 * Math.PI) / 180;
    const tower: BuildingPrism = { ring: block(0, 0, 20, 20), heightM: 40 };
    const index = buildShadowIndex([tower], 0, lowSun, mPerLat, mPerLng, null);

    // Sampled the whole length, so a prism missing from a middle bucket shows up.
    for (let m = 25; m <= 200; m += 5) {
      const lat = LAT + m / mPerLat;
      expect(index.isShadowed(LNG + 10 / mPerLng, lat)).toBe(
        refPointInPrismShadow([tower], LNG + 10 / mPerLng, lat, 0, lowSun, mPerLat, mPerLng)
      );
    }
  });

  it("leaves a point outside the indexed area sunlit", () => {
    const index = buildShadowIndex(corpus(42), 0, Math.PI / 4, mPerLat, mPerLng, null);
    expect(index.isShadowed(LNG + 50000 / mPerLng, LAT)).toBe(false);
    expect(index.isShadowed(LNG, LAT - 50000 / mPerLat)).toBe(false);
  });
});

// ─── The region filter ────────────────────────────────────────────────────────

describe("the region filter", () => {
  const DUE_SOUTH = 0;
  const ALT_45 = Math.PI / 4;

  it("drops a prism whose shadow cannot reach the region", () => {
    const near: BuildingPrism = { ring: block(0, 0, 30, 30), heightM: 30 };
    const faraway: BuildingPrism = { ring: block(5000, 5000, 30, 30), heightM: 30 };

    const region = {
      west: LNG - 200 / mPerLng,
      east: LNG + 200 / mPerLng,
      south: LAT - 200 / mPerLat,
      north: LAT + 200 / mPerLat,
    };
    const index = buildShadowIndex([near, faraway], DUE_SOUTH, ALT_45, mPerLat, mPerLng, region);

    expect(index.prismCount).toBe(1);
  });

  it("gives in-region answers identical to an unfiltered index", () => {
    const prisms = [...corpus(7), { ring: block(9000, 9000, 40, 40), heightM: 80 }];
    const region = {
      west: LNG - 300 / mPerLng,
      east: LNG + 300 / mPerLng,
      south: LAT - 300 / mPerLat,
      north: LAT + 300 / mPerLat,
    };
    const filtered = buildShadowIndex(prisms, -1.0, 0.55, mPerLat, mPerLng, region);
    const whole = buildShadowIndex(prisms, -1.0, 0.55, mPerLat, mPerLng, null);

    expect(filtered.prismCount).toBeLessThan(whole.prismCount);

    for (let gx = -9; gx <= 9; gx++) {
      for (let gy = -9; gy <= 9; gy++) {
        const lng = LNG + (gx * 30) / mPerLng;
        const lat = LAT + (gy * 30) / mPerLat;
        expect(filtered.isShadowed(lng, lat)).toBe(whole.isShadowed(lng, lat));
      }
    }
  });
});

// ─── Degeneracy ───────────────────────────────────────────────────────────────

describe("degenerate input", () => {
  it("shadows nothing when there is no geometry", () => {
    const index = buildShadowIndex([], 0, Math.PI / 4, mPerLat, mPerLng, null);
    expect(index.prismCount).toBe(0);
    expect(index.isShadowed(LNG, LAT)).toBe(false);
  });

  it("handles a single prism", () => {
    const one: BuildingPrism = { ring: block(0, 0, 20, 20), heightM: 20 };
    const index = buildShadowIndex([one], 0, Math.PI / 4, mPerLat, mPerLng, null);

    expect(index.prismCount).toBe(1);
    expect(index.isShadowed(LNG + 10 / mPerLng, LAT + 30 / mPerLat)).toBe(true);
    expect(index.isShadowed(LNG + 10 / mPerLng, LAT - 30 / mPerLat)).toBe(false);
  });

  it("terminates on a sun exactly at the horizon, and shadows nothing", () => {
    // tan(0) is 0, so the shadow length is Infinity and the shift is Infinity/NaN.
    // Left unguarded that gives the grid an infinite extent, and the coarsening loop
    // never exits — this test is the reason the finiteness check exists.
    const index = buildShadowIndex(corpus(42), 0, 0, mPerLat, mPerLng, null);
    expect(index.prismCount).toBe(0);
    expect(index.isShadowed(LNG, LAT)).toBe(false);
  });

  it("keeps the grid bounded under a sun almost on the horizon", () => {
    // 0.5°: a 90 m building "casts" over 10 km. The grid must coarsen rather than
    // allocate a cell per 20 m across that span.
    const grazing = (0.5 * Math.PI) / 180;
    const prisms = corpus(42);
    const index = buildShadowIndex(prisms, 0, grazing, mPerLat, mPerLng, null);

    expect(index.prismCount).toBe(prisms.length);
    // Sampled across the corpus's own footprint span (±200 m of it), where every
    // shadow triangle actually lives.
    for (let gx = -5; gx <= 5; gx++) {
      const lng = LNG + (gx * 40) / mPerLng;
      expect(index.isShadowed(lng, LAT + 300 / mPerLat)).toBe(
        refPointInPrismShadow(prisms, lng, LAT + 300 / mPerLat, 0, grazing, mPerLat, mPerLng)
      );
    }
  });

  it("does not inherit the pre-index sliver hit from outside the shadow's own bounds", () => {
    // The one place the index deliberately differs. At 0.5° the shadow's side walls
    // collapse to a single longitude, and `pointInTriangle`'s absolute degeneracy
    // epsilon stops rejecting them once the latitude span reaches ~0.09° — so the
    // per-query path calls this point shadowed despite it sitting 20 m west of every
    // triangle in the set. The index culls by bounds first and gets it right.
    const grazing = (0.5 * Math.PI) / 180;
    const prisms = corpus(42);
    const index = buildShadowIndex(prisms, 0, grazing, mPerLat, mPerLng, null);
    const westOfEverything = LNG - 240 / mPerLng;
    const lat = LAT + 300 / mPerLat;

    let westmost = Number.POSITIVE_INFINITY;
    for (const prism of prisms) for (const [lng] of prism.ring) westmost = Math.min(westmost, lng);
    expect(westOfEverything).toBeLessThan(westmost);

    expect(refPointInPrismShadow(prisms, westOfEverything, lat, 0, grazing, mPerLat, mPerLng)).toBe(true);
    expect(index.isShadowed(westOfEverything, lat)).toBe(false);
  });

  it("shadows nothing for a zero-height building", () => {
    const flat: BuildingPrism = { ring: block(0, 0, 20, 20), heightM: 0 };
    const index = buildShadowIndex([flat], 0, Math.PI / 4, mPerLat, mPerLng, null);

    expect(index.isShadowed(LNG + 10 / mPerLng, LAT + 30 / mPerLat)).toBe(false);
    expect(index.isShadowed(LNG + 10 / mPerLng, LAT + 10 / mPerLat)).toBe(false); // on the footprint
  });

  it("skips a ring with an infinite coordinate rather than spinning on it", () => {
    // An infinite coordinate survives the bounds sweep and would give the grid an
    // infinite extent, which the coarsening loop can never bring under budget.
    const broken: BuildingPrism = {
      ring: [[LNG, LAT], [Number.POSITIVE_INFINITY, LAT], [LNG, LAT + 0.001]],
      heightM: 30,
    };
    const good: BuildingPrism = { ring: block(0, 0, 20, 20), heightM: 20 };
    const index = buildShadowIndex([broken, good], 0, Math.PI / 4, mPerLat, mPerLng, null);

    expect(index.prismCount).toBe(1);
    expect(index.isShadowed(LNG + 10 / mPerLng, LAT + 30 / mPerLat)).toBe(true);
  });

  it("keeps a ring with a NaN coordinate, and answers what the reference answers", () => {
    // NaN loses every comparison in the bounds sweep, so the bounds stay finite and
    // the prism carries the same harmless triangles it always did. No guard needed —
    // the point is that the index does not diverge here.
    const broken: BuildingPrism = {
      ring: [[LNG, LAT], [Number.NaN, LAT], [LNG, LAT + 0.001]],
      heightM: 30,
    };
    const good: BuildingPrism = { ring: block(0, 0, 20, 20), heightM: 20 };
    const prisms = [broken, good];
    const index = buildShadowIndex(prisms, 0, Math.PI / 4, mPerLat, mPerLng, null);

    expect(index.prismCount).toBe(2);
    for (let m = -40; m <= 60; m += 10) {
      const lat = LAT + m / mPerLat;
      expect(index.isShadowed(LNG + 10 / mPerLng, lat)).toBe(
        refPointInPrismShadow(prisms, LNG + 10 / mPerLng, lat, 0, Math.PI / 4, mPerLat, mPerLng)
      );
    }
  });

  it("shadows nothing for a NaN query point", () => {
    const index = buildShadowIndex(corpus(42), 0, Math.PI / 4, mPerLat, mPerLng, null);
    expect(index.isShadowed(Number.NaN, LAT)).toBe(false);
    expect(index.isShadowed(LNG, Number.NaN)).toBe(false);
  });
});
