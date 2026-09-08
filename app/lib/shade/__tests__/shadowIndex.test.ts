/**
 * `shadowIndex` must answer exactly what `pointInPrismShadow` answered before it.
 *
 * The index is a performance change wearing correctness clothes: it drops prisms
 * (the region filter), reorders which ones a point is tested against (the grid), and
 * moves the geometry build out of the query. Any of those three can change an answer
 * silently, and a wrong shade number is invisible in review and contaminates routing.
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
import { buildShadowIndex } from "../shadowIndex";

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
 */
function corpus(seed: number): BuildingPrism[] {
  const rand = rng(seed);
  const prisms: BuildingPrism[] = [];
  for (let gx = -3; gx <= 3; gx++) {
    for (let gy = -3; gy <= 3; gy++) {
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
    let shaded = 0;
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
          expect(index.isShaded(lng, lat)).toBe(before);
          compared++;
          if (before) shaded++;
        }
      }
    }

    // Guard against a vacuous pass: the corpus must actually cast shade somewhere,
    // and must not be so shaded that agreement is trivial.
    expect(compared).toBe(SUN_POSITIONS.length * 23 * 23);
    expect(shaded).toBeGreaterThan(200);
    expect(shaded).toBeLessThan(compared - 200);
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
          expect(index.isShaded(lng, lat)).toBe(
            refPointInPrismShadow(prisms, lng, lat, sun.azimuth, sun.altitude, mPerLat, mPerLng)
          );
        }
      }
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

  it("reports a roof inside a taller building's shadow as sunlit, not shaded", () => {
    const index = buildShadowIndex(
      [tower, neighbour], DUE_SOUTH, ALT_45, mPerLat, mPerLng, null
    );
    // A point on the low neighbour's roof, which sits well inside the tower's shadow.
    const onRoof: [number, number] = [LNG + 15 / mPerLng, LAT + 65 / mPerLat];

    expect(index.isShaded(...onRoof)).toBe(false);
    expect(
      refPointInPrismShadow([tower, neighbour], onRoof[0], onRoof[1], DUE_SOUTH, ALT_45, mPerLat, mPerLng)
    ).toBe(false);
  });

  it("still shades the ground beside that roof", () => {
    const index = buildShadowIndex(
      [tower, neighbour], DUE_SOUTH, ALT_45, mPerLat, mPerLng, null
    );
    // Same latitude, but east of the neighbour's footprint — inside the tower's shadow
    // only if the shadow really reaches this far.
    expect(index.isShaded(LNG + 15 / mPerLng, LAT + 40 / mPerLat)).toBe(true);
  });

  it("does not let the order prisms are listed in change the answer", () => {
    const forward = buildShadowIndex([tower, neighbour], DUE_SOUTH, ALT_45, mPerLat, mPerLng, null);
    const reversed = buildShadowIndex([neighbour, tower], DUE_SOUTH, ALT_45, mPerLat, mPerLng, null);

    for (let m = -20; m <= 120; m += 5) {
      const lat = LAT + m / mPerLat;
      expect(reversed.isShaded(LNG + 15 / mPerLng, lat)).toBe(
        forward.isShaded(LNG + 15 / mPerLng, lat)
      );
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
      expect(index.isShaded(LNG + 10 / mPerLng, lat)).toBe(
        refPointInPrismShadow([tower], LNG + 10 / mPerLng, lat, 0, lowSun, mPerLat, mPerLng)
      );
    }
  });

  it("leaves a point outside the indexed area sunlit", () => {
    const index = buildShadowIndex(corpus(42), 0, Math.PI / 4, mPerLat, mPerLng, null);
    expect(index.isShaded(LNG + 50000 / mPerLng, LAT)).toBe(false);
    expect(index.isShaded(LNG, LAT - 50000 / mPerLat)).toBe(false);
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
        expect(filtered.isShaded(lng, lat)).toBe(whole.isShaded(lng, lat));
      }
    }
  });
});

// ─── Degeneracy ───────────────────────────────────────────────────────────────

describe("degenerate input", () => {
  it("shades nothing when there is no geometry", () => {
    const index = buildShadowIndex([], 0, Math.PI / 4, mPerLat, mPerLng, null);
    expect(index.prismCount).toBe(0);
    expect(index.isShaded(LNG, LAT)).toBe(false);
  });

  it("handles a single prism", () => {
    const one: BuildingPrism = { ring: block(0, 0, 20, 20), heightM: 20 };
    const index = buildShadowIndex([one], 0, Math.PI / 4, mPerLat, mPerLng, null);

    expect(index.prismCount).toBe(1);
    expect(index.isShaded(LNG + 10 / mPerLng, LAT + 30 / mPerLat)).toBe(true);
    expect(index.isShaded(LNG + 10 / mPerLng, LAT - 30 / mPerLat)).toBe(false);
  });

  it("terminates on a sun exactly at the horizon, and shades nothing", () => {
    // tan(0) is 0, so the shadow length is Infinity and the shift is Infinity/NaN.
    // Left unguarded that gives the grid an infinite extent, and the coarsening loop
    // never exits — this test is the reason the finiteness check exists.
    const index = buildShadowIndex(corpus(42), 0, 0, mPerLat, mPerLng, null);
    expect(index.prismCount).toBe(0);
    expect(index.isShaded(LNG, LAT)).toBe(false);
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
      expect(index.isShaded(lng, LAT + 300 / mPerLat)).toBe(
        refPointInPrismShadow(prisms, lng, LAT + 300 / mPerLat, 0, grazing, mPerLat, mPerLng)
      );
    }
  });

  it("does not inherit the pre-index sliver hit from outside the shadow's own bounds", () => {
    // The one place the index deliberately differs. At 0.5° the shadow's side walls
    // collapse to a single longitude, and `pointInTriangle`'s absolute degeneracy
    // epsilon stops rejecting them once the latitude span reaches ~0.09° — so the
    // per-query path calls this point shaded despite it sitting 20 m west of every
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
    expect(index.isShaded(westOfEverything, lat)).toBe(false);
  });

  it("shades nothing for a zero-height building", () => {
    const flat: BuildingPrism = { ring: block(0, 0, 20, 20), heightM: 0 };
    const index = buildShadowIndex([flat], 0, Math.PI / 4, mPerLat, mPerLng, null);

    expect(index.isShaded(LNG + 10 / mPerLng, LAT + 30 / mPerLat)).toBe(false);
    expect(index.isShaded(LNG + 10 / mPerLng, LAT + 10 / mPerLat)).toBe(false); // on the footprint
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
    expect(index.isShaded(LNG + 10 / mPerLng, LAT + 30 / mPerLat)).toBe(true);
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
      expect(index.isShaded(LNG + 10 / mPerLng, lat)).toBe(
        refPointInPrismShadow(prisms, LNG + 10 / mPerLng, lat, 0, Math.PI / 4, mPerLat, mPerLng)
      );
    }
  });

  it("shades nothing for a NaN query point", () => {
    const index = buildShadowIndex(corpus(42), 0, Math.PI / 4, mPerLat, mPerLng, null);
    expect(index.isShaded(Number.NaN, LAT)).toBe(false);
    expect(index.isShaded(LNG, Number.NaN)).toBe(false);
  });
});
