/**
 * The crown model's job is to be honest about how little it knows.
 *
 * The 2026-09-09 census (`docs/notes/canopy-coverage-2026-09-09.md`) found
 * `diameter_crown` on 0.14% of Madrid's trees and `height` on 0.33%, and zero of
 * either in Singapore or Kent. So the defaults are not a fallback here — they are
 * the model in the overwhelming majority of cases, and what these tests pin is that
 * every choice with a direction leans towards reporting *less* shadow.
 */

import { describe, expect, it } from "vitest";
import type { CanopyFeature } from "../../overpass";
import { CANOPY_PREFERENCE_WEIGHT, crownOpacity, inLeaf, prismsFromCanopy } from "../canopy";
import { metersPerDegree } from "../geometry";

const MADRID: [number, number] = [-3.7038, 40.4168];
const SINGAPORE: [number, number] = [103.8198, 1.3521];
const SYDNEY: [number, number] = [151.2093, -33.8688];

const JULY = new Date("2026-07-15T12:00:00Z");
const JANUARY = new Date("2026-01-15T12:00:00Z");

function tree(
  at: [number, number],
  tags: CanopyFeature["tags"] = {}
): CanopyFeature {
  return { id: 1, kind: "tree", points: [at], tags };
}

/** Metres between two lng/lat points, planar — fine at crown scale. */
function metresBetween(a: [number, number], b: [number, number]): number {
  const { mPerLat, mPerLng } = metersPerDegree(a[1]);
  const dx = (b[0] - a[0]) * mPerLng;
  const dy = (b[1] - a[1]) * mPerLat;
  return Math.sqrt(dx * dx + dy * dy);
}

/** The largest distance from `centre` to any vertex — the crown's modelled radius. */
function ringRadiusM(ring: [number, number][], centre: [number, number]): number {
  return Math.max(...ring.map((p) => metresBetween(centre, p)));
}

describe("seasonality", () => {
  it("keeps an evergreen in leaf all year", () => {
    expect(inLeaf({ leaf_cycle: "evergreen" }, JANUARY, MADRID[1])).toBe(true);
    expect(inLeaf({ leaf_cycle: "evergreen" }, JULY, MADRID[1])).toBe(true);
  });

  it("drops a deciduous tree out of leaf in a northern winter", () => {
    expect(inLeaf({ leaf_cycle: "deciduous" }, JULY, MADRID[1])).toBe(true);
    expect(inLeaf({ leaf_cycle: "deciduous" }, JANUARY, MADRID[1])).toBe(false);
  });

  it("mirrors the window in the southern hemisphere", () => {
    expect(inLeaf({ leaf_cycle: "deciduous" }, JANUARY, SYDNEY[1])).toBe(true);
    expect(inLeaf({ leaf_cycle: "deciduous" }, JULY, SYDNEY[1])).toBe(false);
  });

  it("keeps the tropics in leaf year-round", () => {
    // Singapore is one of the three corpus cities, and a Northern-winter leaf-off
    // window applied there would halve its canopy for no physical reason.
    expect(inLeaf({ leaf_cycle: "deciduous" }, JANUARY, SINGAPORE[1])).toBe(true);
  });

  it("treats an untagged tree as deciduous — the under-reporting direction", () => {
    // `leaf_cycle` is tagged on 1.8% of Madrid's trees, so this is the usual path.
    expect(inLeaf({}, JANUARY, MADRID[1])).toBe(false);
    expect(inLeaf({}, JULY, MADRID[1])).toBe(true);
  });

  it("reads needleleaved as evergreen when the cycle is untagged", () => {
    expect(inLeaf({ leaf_type: "needleleaved" }, JANUARY, MADRID[1])).toBe(true);
  });

  it("lets an explicit leaf_cycle override the leaf_type shortcut", () => {
    expect(inLeaf({ leaf_type: "needleleaved", leaf_cycle: "deciduous" }, JANUARY, MADRID[1]))
      .toBe(false);
  });

  it("reads the date in UTC, so the answer does not depend on the host's zone", () => {
    // A `Date` one minute either side of a UTC month boundary must not flip with TZ.
    const lastOfOctober = new Date("2026-10-31T23:59:00Z");
    const firstOfNovember = new Date("2026-11-01T00:01:00Z");
    expect(inLeaf({}, lastOfOctober, MADRID[1])).toBe(true);
    expect(inLeaf({}, firstOfNovember, MADRID[1])).toBe(false);
  });
});

describe("crownOpacity", () => {
  it("stops most of the beam in leaf and little of it bare", () => {
    expect(crownOpacity({}, JULY, MADRID[1])).toBeCloseTo(0.9, 10);
    expect(crownOpacity({}, JANUARY, MADRID[1])).toBeCloseTo(0.3, 10);
  });

  it("never reaches 1 — a crown is not a wall", () => {
    // The whole reason `shadow` is a fraction. An opaque crown would let routing price
    // a plane tree like a tower, which is the overstating direction A7 exists to avoid.
    for (const when of [JULY, JANUARY]) {
      for (const lat of [MADRID[1], SINGAPORE[1], SYDNEY[1]]) {
        expect(crownOpacity({}, when, lat)).toBeLessThan(1);
        expect(crownOpacity({}, when, lat)).toBeGreaterThan(0);
      }
    }
  });
});

describe("prismsFromCanopy", () => {
  it("puts a crown on a trunk rather than on the ground", () => {
    // Issue #276's premise: a crown's underside is what its shadow starts from.
    const [prism] = prismsFromCanopy([tree(MADRID)], JULY).prisms;
    expect(prism.baseM).toBeGreaterThan(0);
    expect(prism.baseM).toBeLessThan(prism.heightM);
  });

  it("reads a tagged crown diameter and halves it", () => {
    const [prism] = prismsFromCanopy([tree(MADRID, { diameter_crown: "12" })], JULY).prisms;
    expect(ringRadiusM(prism.ring, MADRID)).toBeCloseTo(6, 3);
  });

  it("accepts a unit suffix and rejects anything it cannot read", () => {
    const withUnit = prismsFromCanopy([tree(MADRID, { height: "15 m" })], JULY).prisms[0];
    expect(withUnit.heightM).toBe(15);

    // A range takes its lower bound, which is the under-reporting end; anything with no
    // leading number at all falls back to the default rather than being guessed at.
    expect(prismsFromCanopy([tree(MADRID, { height: "8-12" })], JULY).prisms[0].heightM).toBe(8);
    const nonsense = prismsFromCanopy([tree(MADRID, { height: "tall" })], JULY).prisms[0];
    const untagged = prismsFromCanopy([tree(MADRID)], JULY).prisms[0];
    expect(nonsense.heightM).toBe(untagged.heightM);
  });

  it("gives a broadleaved tree a wider default crown than a needleleaved one", () => {
    const broad = prismsFromCanopy([tree(MADRID, { leaf_type: "broadleaved" })], JULY).prisms[0];
    const needle = prismsFromCanopy([tree(MADRID, { leaf_type: "needleleaved" })], JULY).prisms[0];
    expect(ringRadiusM(broad.ring, MADRID)).toBeGreaterThan(ringRadiusM(needle.ring, MADRID));
  });

  it("under-covers the crown circle rather than over-covering it", () => {
    // An inscribed polygon: every vertex sits *on* the circle, so the modelled area is
    // ~90% of it. Circumscribing would over-report shadow on a radius that is itself a
    // default, everywhere, in the dangerous direction.
    const [prism] = prismsFromCanopy([tree(MADRID, { diameter_crown: "8" })], JULY).prisms;
    const open = prism.ring.slice(0, -1);
    for (const vertex of open) {
      expect(metresBetween(MADRID, vertex)).toBeCloseTo(4, 3);
    }
    expect(open.length).toBeGreaterThanOrEqual(6);
  });

  it("closes every ring, the way the rest of the engine expects", () => {
    const { prisms } = prismsFromCanopy([tree(MADRID)], JULY);
    for (const prism of prisms) {
      expect(prism.ring[0]).toEqual(prism.ring[prism.ring.length - 1]);
    }
  });

  it("carries the season into every prism's opacity", () => {
    const summer = prismsFromCanopy([tree(MADRID)], JULY).prisms[0];
    const winter = prismsFromCanopy([tree(MADRID)], JANUARY).prisms[0];
    expect(summer.opacity).toBeGreaterThan(winter.opacity ?? 1);
  });

  describe("tree rows", () => {
    const { mPerLng } = metersPerDegree(MADRID[1]);
    /** A 60 m row running due east from the Madrid origin. */
    const row: CanopyFeature = {
      id: 2,
      kind: "tree_row",
      points: [MADRID, [MADRID[0] + 60 / mPerLng, MADRID[1]]],
      tags: { leaf_type: "broadleaved" },
    };

    it("fills the row with crowns spaced one diameter apart", () => {
      // A 7 m default diameter over 60 m: the first crown plus one every 7 m.
      const { prisms } = prismsFromCanopy([row], JULY);
      expect(prisms.length).toBe(1 + Math.floor(60 / 7));
    });

    it("spaces them so consecutive crowns touch rather than overlap", () => {
      const { prisms } = prismsFromCanopy([row], JULY);
      const centres = prisms.map((p) => {
        const open = p.ring.slice(0, -1);
        return [
          open.reduce((sum, v) => sum + v[0], 0) / open.length,
          open.reduce((sum, v) => sum + v[1], 0) / open.length,
        ] as [number, number];
      });
      const radiusM = ringRadiusM(prisms[0].ring, centres[0]);
      for (let i = 1; i < centres.length; i++) {
        expect(metresBetween(centres[i - 1], centres[i])).toBeCloseTo(radiusM * 2, 2);
      }
    });

    it("caps a row long enough to be woodland mapped as a line", () => {
      const long: CanopyFeature = {
        ...row,
        points: [MADRID, [MADRID[0] + 40000 / mPerLng, MADRID[1]]],
      };
      expect(prismsFromCanopy([long], JULY).prisms.length).toBeLessThanOrEqual(300);
    });
  });

  it("takes woodland as one prism over its own ring", () => {
    const { mPerLat, mPerLng } = metersPerDegree(MADRID[1]);
    const wood: CanopyFeature = {
      id: 3,
      kind: "wood",
      points: [
        MADRID,
        [MADRID[0] + 100 / mPerLng, MADRID[1]],
        [MADRID[0] + 100 / mPerLng, MADRID[1] + 100 / mPerLat],
        MADRID,
      ],
      tags: {},
    };
    const { prisms } = prismsFromCanopy([wood], JULY);
    expect(prisms).toHaveLength(1);
    expect(prisms[0].ring).toEqual(wood.points);
    expect(prisms[0].baseM).toBeGreaterThan(0);
  });

  it("skips a feature with no geometry rather than emitting a degenerate prism", () => {
    const empty: CanopyFeature = { id: 4, kind: "tree", points: [], tags: {} };
    expect(prismsFromCanopy([empty], JULY).prisms).toHaveLength(0);
  });

  it("reports a usable maxHeightM even over nothing", () => {
    // `prismsFromFootprints` does the same: the renderer divides by it.
    expect(prismsFromCanopy([], JULY).maxHeightM).toBe(1);
  });
});

describe("the published preference weight", () => {
  it("is Melnikov's 0.5 and is not applied to the shadow fraction", () => {
    // #244 asks for the citation in-source, and `TRACK_A.md` asks for the two numbers
    // to stay apart: 0.5 is *perceived* intensity, for a route cost model; the ~10%/70%
    // transmittance pair is physics, and `shadow` is physical. If a future change
    // multiplies the weight into `crownOpacity`, this is what fails.
    expect(CANOPY_PREFERENCE_WEIGHT).toBe(0.5);
    expect(crownOpacity({}, JULY, MADRID[1])).toBeCloseTo(0.9, 10);
  });
});
