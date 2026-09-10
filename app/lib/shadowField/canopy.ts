/**
 * The canopy crown model (Track A, checkpoint A7).
 *
 * Buildings-only shadow systematically under-reports the streets a shadow-seeker
 * actually walks. This module turns OSM's canopy tags — `natural=tree`,
 * `natural=tree_row`, `natural=wood`, `landuse=forest` — into the same
 * `BuildingPrism` the rest of the engine already consumes, so nothing downstream
 * has to learn that a tree exists.
 *
 * ## Two numbers that must not be conflated
 *
 * Wen et al. 2025 (via Melnikov et al. 2022, *Sci. Rep.* 12:2441) measured that tree
 * shadow is *perceived* as roughly **half** as intense as building shadow, and price
 * it at `0.5θ` against `θ` in their route cost. That is a route-choice preference
 * weight. It is **not** what `ShadowField.shadow` means: that field is documented as
 * "0 = full sun, 1 = fully shadowed", a physical fraction of the direct beam, and
 * multiplying a preference into it would corrupt every other consumer of the number
 * — the exposure series, the heat score, the assistant's spot checks. So the physics
 * lives here, in `crownOpacity`, and the preference weight is published as
 * `CANOPY_PREFERENCE_WEIGHT` for the cost model to apply. See #244.
 *
 * ## Every default in this file is doing more work than it looks
 *
 * A tagged-canopy census over the three A3 corpus cities (2026-09-09,
 * `docs/notes/canopy-coverage-2026-09-09.md`, reproducible with
 * `node scripts/canopy-census.mjs`) found `diameter_crown` on **0.14% of Madrid's
 * trees and 0% of Singapore's and Kent's**, and `height` on **0.33% / 0% / 0%**. So
 * the tagged values below are almost never read: in practice this model is its own
 * defaults, applied to a point. They are priors of the same kind as
 * `SOURCE_BASE_CONFIDENCE`, and the honest place that shows up is the confidence the
 * field reports, not a hedge in this file.
 *
 * Where a choice has a direction, it is made the *under*-reporting way. Modelling a
 * crown as an opaque solid overstates shadow, and overstating is what routes someone
 * into sun while promising shadow.
 *
 * This module is pure: no map, no network, no time zone. `when` is read in UTC.
 */

import type { CanopyFeature, CanopyTags } from "../overpass";
import { type BuildingPrism, type PrismSet, metersPerDegree } from "./geometry";

// ─── The published weight A7 does not apply ───────────────────────────────────

/**
 * What a route cost model should weight canopy shadow at, against building shadow.
 *
 * Melnikov et al. 2022 measured this in Singapore and Wen et al. 2025 carry it into
 * their cost model as `0.5θ` for tree shadow against `θ` for building shadow. It is
 * a published number rather than an invented one, which is the whole reason to use
 * it — see #244.
 *
 * **Caveat, to be quoted wherever the number is:** one experiment, one city, 13
 * tasks, measuring *perceived* intensity. It is a preference, not physics, so it
 * belongs in the routing cost and not in the shadow fraction. Nothing in this repo
 * applies it yet: `EdgeShadow` reports one blended fraction and does not say how much
 * of it was canopy, so there is nothing for Track E to weight — issue #277.
 */
export const CANOPY_PREFERENCE_WEIGHT = 0.5;

// ─── Transmittance, which A7 does apply ───────────────────────────────────────

/**
 * Share of the direct beam that gets through a crown in leaf, and out of it.
 *
 * The ~10% / ~70% pair is the figure `THREAD_SHADOW.md` carries for canopy
 * transmittance. Opacity is `1 - transmittance`, so a leafed crown stops 0.90 of the
 * beam and a bare one 0.30 — which is what keeps a winter plane tree from being
 * priced like a wall, and what the fractional `shadow` field exists for.
 */
const TRANSMITTANCE_LEAF_ON = 0.1;
const TRANSMITTANCE_LEAF_OFF = 0.7;

/**
 * Months, 1-based and inclusive, in which deciduous canopy is treated as in leaf.
 *
 * April–October in the northern hemisphere, October–April in the southern: a coarse
 * mid-latitude window, deliberately not a phenology model. It is stated as a window
 * rather than smoothed because a smooth ramp would imply a precision that a fixed
 * default crown on an untagged point cannot support. Read in **UTC** so the same
 * `Date` produces the same answer wherever the code runs.
 *
 * Inside the tropics there is no leaf-off season worth modelling and this is skipped
 * entirely — which matters, because Singapore is one of the three corpus cities.
 */
const LEAF_ON_MONTHS_NORTH: [number, number] = [4, 10];
const TROPICS_LAT = 23.5;

// ─── Crown geometry: the defaults that are, in practice, the model ────────────

/**
 * Crown *diameter* in metres when `diameter_crown` is absent, which the census says
 * is 99.9% of the time. Split by `leaf_type` because that is the one crown-shape tag
 * OSM does carry with any regularity (13% in Madrid, 59% in Kent).
 *
 * A mature broadleaved street tree spreads considerably wider than a needleleaved
 * one; 7 m and 4 m are middle-of-the-road figures for a pruned urban specimen. Priors.
 */
const DEFAULT_CROWN_DIAMETER_M: Record<string, number> = {
  broadleaved: 7,
  needleleaved: 4,
};
const DEFAULT_CROWN_DIAMETER_UNKNOWN_M = 5.5;

/** Tree height when `height` is absent — which the census says is ~always. A prior. */
const DEFAULT_TREE_HEIGHT_M = 9;

/** Canopy height over woodland, whose ways carry `height` even less often than trees do. */
const DEFAULT_WOOD_HEIGHT_M = 12;

/**
 * Where the crown starts, as a fraction of the tree's height.
 *
 * This is the number issue #276 is about. A crown is not a solid from the ground up:
 * it sits on a trunk, so its shadow is displaced from the trunk by
 * `baseM / tan(altitude)` and slides further as the sun drops — which is exactly the
 * late-afternoon window where Wen et al. found tree shadow carrying the street while
 * building shadow collapses. Modelling the crown from the ground instead would paint
 * shadow across that whole displacement, overstating it in the dangerous direction.
 */
const CROWN_BASE_FRACTION = 0.35;

/**
 * Vertices in the polygon standing in for a circular crown.
 *
 * Eight, **inscribed** in the crown circle rather than circumscribed about it, so the
 * polygon covers ~90% of the circle's area. Under-covering is the safe direction; a
 * circumscribed octagon would over-cover by ~10% everywhere, on a radius that is
 * itself a default.
 */
const CROWN_VERTICES = 8;

/**
 * Crowns emitted per tree row, at most.
 *
 * A row is a line, and it is filled with crowns spaced one diameter apart so they
 * just touch — the gaps that leaves between them are the under-covering direction
 * again. The cap stops a kilometre-long park boundary tagged `tree_row` from emitting
 * thousands of prisms into a route-scale index; such a row is woodland mapped as a
 * line, and the honest answer to it is that this model does not cover it.
 */
const MAX_CROWNS_PER_ROW = 300;

// ─── Seasonality ──────────────────────────────────────────────────────────────

/** A finite positive number from an OSM tag value, or `null` — OSM tags are free text. */
function tagMetres(value: string | undefined): number | null {
  if (value === undefined) return null;
  // "12" and "12 m" both occur, and a range like "8-12" reads as its lower bound —
  // the under-reporting end. A value with no leading number falls back to the default
  // rather than being guessed at.
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Is this tree in leaf at this moment?
 *
 * `leaf_cycle` settles it when tagged. Otherwise `leaf_type=needleleaved` is taken as
 * evergreen — true of most conifers and wrong for larch, which is rare enough in
 * street planting to accept — and everything else falls to deciduous, because
 * assuming deciduous reports *less* shadow out of season.
 */
export function inLeaf(tags: CanopyTags, when: Date, lat: number): boolean {
  if (tags.leaf_cycle === "evergreen") return true;
  if (tags.leaf_cycle === "deciduous" || tags.leaf_cycle === "semi_deciduous") {
    return inLeafSeason(when, lat);
  }
  if (tags.leaf_type === "needleleaved") return true;
  return inLeafSeason(when, lat);
}

function inLeafSeason(when: Date, lat: number): boolean {
  if (Math.abs(lat) < TROPICS_LAT) return true;
  const month = when.getUTCMonth() + 1;
  const [from, to] = LEAF_ON_MONTHS_NORTH;
  const north = month >= from && month <= to;
  return lat >= 0 ? north : !north;
}

/** Share of the direct beam this crown stops, 0–1. */
export function crownOpacity(tags: CanopyTags, when: Date, lat: number): number {
  return 1 - (inLeaf(tags, when, lat) ? TRANSMITTANCE_LEAF_ON : TRANSMITTANCE_LEAF_OFF);
}

// ─── Crowns → prisms ──────────────────────────────────────────────────────────

/** Crown radius in metres: the tagged diameter if there is one, else a `leaf_type` prior. */
function crownRadiusM(tags: CanopyTags): number {
  const tagged = tagMetres(tags.diameter_crown);
  if (tagged !== null) return tagged / 2;
  const byLeaf = tags.leaf_type ? DEFAULT_CROWN_DIAMETER_M[tags.leaf_type] : undefined;
  return (byLeaf ?? DEFAULT_CROWN_DIAMETER_UNKNOWN_M) / 2;
}

/** An inscribed `CROWN_VERTICES`-gon around a point, closed the way OSM closes rings. */
function crownRing(
  lng: number,
  lat: number,
  radiusM: number,
  mPerLat: number,
  mPerLng: number
): [number, number][] {
  const ring: [number, number][] = [];
  for (let i = 0; i < CROWN_VERTICES; i++) {
    const angle = (i / CROWN_VERTICES) * 2 * Math.PI;
    ring.push([
      lng + (Math.cos(angle) * radiusM) / mPerLng,
      lat + (Math.sin(angle) * radiusM) / mPerLat,
    ]);
  }
  ring.push([ring[0][0], ring[0][1]]);
  return ring;
}

/** Points one diameter apart along a polyline, so consecutive crowns just touch. */
function crownCentresAlong(
  points: [number, number][],
  spacingM: number,
  mPerLat: number,
  mPerLng: number
): Array<[number, number]> {
  const centres: Array<[number, number]> = [points[0]];
  let carry = 0;

  for (let i = 1; i < points.length && centres.length < MAX_CROWNS_PER_ROW; i++) {
    const [aLng, aLat] = points[i - 1];
    const [bLng, bLat] = points[i];
    const dx = (bLng - aLng) * mPerLng;
    const dy = (bLat - aLat) * mPerLat;
    const segmentM = Math.sqrt(dx * dx + dy * dy);
    if (!(segmentM > 0)) continue;

    // Walk the segment, dropping a crown every `spacingM` and carrying the remainder
    // into the next segment so a polyline of short segments is not over-planted.
    let along = spacingM - carry;
    while (along <= segmentM && centres.length < MAX_CROWNS_PER_ROW) {
      const t = along / segmentM;
      centres.push([aLng + t * (bLng - aLng), aLat + t * (bLat - aLat)]);
      along += spacingM;
    }
    carry = (carry + segmentM) % spacingM;
  }

  return centres;
}

/**
 * Canopy features → prisms, for one moment.
 *
 * The moment is a parameter because opacity is seasonal and geometry is not: a caller
 * holding one fetched area gets one prism array per leaf state, not per query. See
 * `createOverpassCanopyProvider`, which caches on exactly that.
 *
 * `maxHeightM` is reported the way `prismsFromFootprints` reports it — the renderer
 * normalizes against it — even though no renderer draws canopy yet (issue #275).
 */
export function prismsFromCanopy(features: CanopyFeature[], when: Date): PrismSet {
  const prisms: BuildingPrism[] = [];
  let maxHeightM = 0;

  for (const feature of features) {
    if (feature.points.length === 0) continue;
    const lat = feature.points[0][1];
    const { mPerLat, mPerLng } = metersPerDegree(lat);
    const opacity = crownOpacity(feature.tags, when, lat);

    if (feature.kind === "wood") {
      const heightM = tagMetres(feature.tags.height) ?? DEFAULT_WOOD_HEIGHT_M;
      prisms.push({
        ring: feature.points,
        heightM,
        baseM: heightM * CROWN_BASE_FRACTION,
        opacity,
      });
      if (heightM > maxHeightM) maxHeightM = heightM;
      continue;
    }

    const heightM = tagMetres(feature.tags.height) ?? DEFAULT_TREE_HEIGHT_M;
    const radiusM = crownRadiusM(feature.tags);
    const baseM = heightM * CROWN_BASE_FRACTION;
    const centres =
      feature.kind === "tree"
        ? [feature.points[0]]
        : crownCentresAlong(feature.points, radiusM * 2, mPerLat, mPerLng);

    for (const [lng, centreLat] of centres) {
      prisms.push({
        ring: crownRing(lng, centreLat, radiusM, mPerLat, mPerLng),
        heightM,
        baseM,
        opacity,
      });
    }
    if (heightM > maxHeightM) maxHeightM = heightM;
  }

  return { prisms, maxHeightM: maxHeightM === 0 ? 1 : maxHeightM };
}
