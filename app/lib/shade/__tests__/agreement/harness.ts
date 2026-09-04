/**
 * The agreement harness (Track A, checkpoint A3).
 *
 * A4 swaps routing's shade source from the map canvas to `ShadeField`. Before that
 * is safe, "is the field as good as the pixels?" has to be a number rather than an
 * opinion — and it has to be a number CI can hold, because the failure mode this
 * track fears is a field that looks right and is quietly wrong.
 *
 * ## What this measures, and what it does not
 *
 * The reference is the **real pixel sampler** — `sampleBothSidewalks` and
 * `isBlueDominantShadowPixel`, imported, not reimplemented — run over a synthetic
 * canvas painted with `LocalShadowAdapter`'s actual shadow colours. So it measures
 * the disagreements A4 can actually introduce:
 *
 * - the ±4 m sidewalk offsets landing on different pixels than on geometry,
 * - pixel quantization at shadow edges, where a sidewalk is half-covered,
 * - **the blue-dominant predicate round-trip** — whether shade painted in the
 *   renderer's colours is still recoverable as shade (invariant #5, which nothing
 *   else in the suite exercises),
 * - sample-count and sample-position differences between the two paths.
 *
 * It does **not** measure the disagreement that comes from the two sources having
 * different buildings — MapTiler's tile geometry versus Overpass's, missing OSM
 * heights, `hide_3d` landmarks. That needs the pixel sampler's answer recorded from
 * a real browser over real cities, which this machine cannot do (issue #121). The
 * fixture format below is the format that recording produces, so the real corpus
 * drops in without changing the metric.
 *
 * Read the number accordingly: green here means the field and the sampler agree
 * about the *same geometry*. It is a necessary condition for A4, not a sufficient one.
 */

import {
  type EdgeRef,
  type PrismProvider,
  bboxAroundEdges,
  bboxAroundPoint,
  createGeometryShadeField,
  edgeSampleCount,
  staticPrismProvider,
} from "../../ShadeField";
import {
  type BuildingPrism,
  type PrismSet,
  buildShadowTriangles,
  metersPerDegree,
  pointInPolygon,
  pointInTriangle,
} from "../../geometry";
import { sampleBothSidewalks } from "../../../shadeSampling";

// ─── Fixture format ───────────────────────────────────────────────────────────

/**
 * One (edge, time) case.
 *
 * `reference` is the pixel sampler's answer. Here it is computed from the synthetic
 * canvas; in the recorded corpus it is captured once from a real browser and frozen
 * into JSON. Nothing else about the harness changes between the two.
 */
export interface AgreementFixture {
  city: string;
  edge: EdgeRef;
  when: Date;
  prisms: PrismSet;
  reference?: { left: number; right: number };
}

export interface Disagreement {
  city: string;
  /** |field − pixels| on each sidewalk. */
  left: number;
  right: number;
}

export interface AgreementReport {
  cases: number;
  /** Mean absolute disagreement across both sidewalks of every case, 0–1. */
  meanAbsolute: number;
  /** 90th percentile of the same population. */
  p90: number;
  worst: number;
  /**
   * Share of sidewalk readings differing by more than `SEVERE`.
   *
   * The tail is what breaks a route, and with p90 at zero it is invisible to a
   * percentile. Almost all of it is one situation: a shadow boundary running
   * *parallel* to a street and landing within a pixel of the sidewalk line, so every
   * sample along that edge flips together instead of scattering. The field is the
   * more accurate side there — it samples the true 4 m offset while the canvas path
   * rounds to the nearest pixel — but the renderer is what the user believes, so the
   * count is a gate rather than a footnote.
   */
  severeShare: number;
  byCity: Record<string, number>;
}

/** A disagreement large enough to change which side of a street a route picks. */
export const SEVERE = 0.25;

// ─── The synthetic canvas ─────────────────────────────────────────────────────

/** `LocalShadowAdapter.BASE_RGB` / `NOON_RGB` / `SHADOW_ALPHA` — invariant #5's other half. */
const SHADOW_BASE_RGB: [number, number, number] = [1, 17, 47];
const SHADOW_NOON_RGB: [number, number, number] = [0x22, 0x46, 0x7f];
const SHADOW_ALPHA = 0.7;

/** A mid-grey basemap, roughly what MapTiler's outdoor-v2 reads as under a street. */
const BASEMAP_RGB: [number, number, number] = [232, 228, 220];

/**
 * The shadow colour the renderer would paint at this sun altitude, composited over
 * the basemap. `LocalShadowAdapter.computeShadowColor` interpolates base→noon by
 * `altitude / noonAltitude` and MapLibre composites the premultiplied result, so
 * `out = shadow × α + basemap × (1 − α)`.
 */
export function shadowPixelAt(altitudeFraction: number): [number, number, number] {
  const t = Math.min(1, Math.max(0, altitudeFraction));
  const blended = SHADOW_BASE_RGB.map(
    (base, i) => base + t * (SHADOW_NOON_RGB[i] - base)
  ) as [number, number, number];

  return blended.map((c, i) =>
    Math.round(c * SHADOW_ALPHA + BASEMAP_RGB[i] * (1 - SHADOW_ALPHA))
  ) as [number, number, number];
}

export interface SyntheticCanvas {
  imageData: ImageData;
  dpr: number;
  project: (lng: number, lat: number) => [number, number];
}

/** A minimal ImageData stand-in — `sampleBothSidewalks` only reads these three fields. */
function makeImageData(width: number, height: number): ImageData {
  return { data: new Uint8ClampedArray(width * height * 4), width, height } as ImageData;
}

/** Axis-aligned bounds of a triangle, so a pixel can reject most triangles with four compares. */
interface BoundedTriangle {
  a: [number, number];
  b: [number, number];
  c: [number, number];
  minLng: number;
  maxLng: number;
  minLat: number;
  maxLat: number;
}

function bound(a: [number, number], b: [number, number], c: [number, number]): BoundedTriangle {
  return {
    a,
    b,
    c,
    minLng: Math.min(a[0], b[0], c[0]),
    maxLng: Math.max(a[0], b[0], c[0]),
    minLat: Math.min(a[1], b[1], c[1]),
    maxLat: Math.max(a[1], b[1], c[1]),
  };
}

export interface CanvasOpts {
  widthPx: number;
  heightPx: number;
  metresPerPixel: number;
  dpr: number;
}

/**
 * Paints the prisms' shadows into a canvas the way the renderer would.
 *
 * Each pixel is classified with the same shadow polygons the field tests against,
 * then painted in the renderer's colours. That is deliberate: the point of the
 * metric is to isolate *sampling* disagreement from *geometry* disagreement, and
 * geometry disagreement is what the recorded corpus (#121) exists to measure.
 *
 * Shadow triangles are built once per canvas rather than once per pixel — the
 * per-query rebuild that `pointInPrismShadow` still does (issue #122) is fine for
 * five offsets and hopeless for ten thousand.
 */
export function paintShadowCanvas(
  prisms: BuildingPrism[],
  centre: [number, number],
  sun: { azimuth: number; altitude: number },
  altitudeFraction: number,
  opts: CanvasOpts
): SyntheticCanvas {
  const { widthPx, heightPx, metresPerPixel, dpr } = opts;
  const imageData = makeImageData(widthPx, heightPx);
  const { mPerLat, mPerLng } = metersPerDegree(centre[1]);
  const [shadowR, shadowG, shadowB] = shadowPixelAt(altitudeFraction);

  const daytime = sun.altitude > 0;
  const triangles: BoundedTriangle[] = [];
  if (daytime) {
    for (const prism of prisms) {
      const tris = buildShadowTriangles(
        prism.ring, prism.heightM, sun.azimuth, sun.altitude, mPerLat, mPerLng
      );
      for (let i = 0; i < tris.length; i += 3) {
        triangles.push(bound(tris[i], tris[i + 1], tris[i + 2]));
      }
    }
  }

  // Screen origin is the top-left; y grows southward.
  const originLng = centre[0] - ((widthPx / 2) * metresPerPixel) / mPerLng;
  const originLat = centre[1] + ((heightPx / 2) * metresPerPixel) / mPerLat;

  for (let py = 0; py < heightPx; py++) {
    const lat = originLat - ((py + 0.5) * metresPerPixel) / mPerLat;

    for (let px = 0; px < widthPx; px++) {
      const lng = originLng + ((px + 0.5) * metresPerPixel) / mPerLng;

      let shaded = false;
      if (daytime) {
        let onRoof = false;
        for (const prism of prisms) {
          if (pointInPolygon(lng, lat, prism.ring)) {
            onRoof = true;
            break;
          }
        }

        if (!onRoof) {
          for (const t of triangles) {
            if (lng < t.minLng || lng > t.maxLng || lat < t.minLat || lat > t.maxLat) continue;
            if (pointInTriangle(lng, lat, t.a, t.b, t.c)) {
              shaded = true;
              break;
            }
          }
        }
      } else {
        // The renderer paints a full-screen dark quad once the sun is down.
        shaded = true;
      }

      const idx = (py * widthPx + px) * 4;
      imageData.data[idx] = shaded ? shadowR : BASEMAP_RGB[0];
      imageData.data[idx + 1] = shaded ? shadowG : BASEMAP_RGB[1];
      imageData.data[idx + 2] = shaded ? shadowB : BASEMAP_RGB[2];
      imageData.data[idx + 3] = 255;
    }
  }

  // `sampleBothSidewalks` multiplies the projected CSS pixel by dpr, so project into
  // CSS pixels and let it scale back up — exactly what MapLibre's `map.project`
  // hands `useNavigation`.
  const project = (lng: number, lat: number): [number, number] => [
    ((lng - originLng) * mPerLng) / metresPerPixel / dpr,
    ((originLat - lat) * mPerLat) / metresPerPixel / dpr,
  ];

  return { imageData, dpr, project };
}

// ─── The metric ───────────────────────────────────────────────────────────────

/**
 * Ground resolution of the synthetic canvas.
 *
 * ~1.2 m/px is roughly what MapLibre renders at z17 near 40° latitude, which is the
 * zoom `useNavigation` fits a route to before sampling. Using a realistic figure
 * matters: quantization at shadow edges is one of the disagreements being measured,
 * so an unrealistically fine canvas would flatter the field.
 */
const METRES_PER_PIXEL = 1.2;

/** A typical phone. `sampleBothSidewalks` scales CSS pixels by this. */
const DEVICE_PIXEL_RATIO = 2;

/** Enough room around the edge for the ±4 m sidewalk offsets and the shadow's approach. */
const CANVAS_MARGIN_M = 25;

function edgeMetrics(edge: EdgeRef): {
  centre: [number, number];
  distanceM: number;
  spanEastM: number;
  spanNorthM: number;
} {
  const centre: [number, number] = [
    (edge.from[0] + edge.to[0]) / 2,
    (edge.from[1] + edge.to[1]) / 2,
  ];
  const { mPerLat, mPerLng } = metersPerDegree(centre[1]);
  const spanEastM = Math.abs(edge.to[0] - edge.from[0]) * mPerLng;
  const spanNorthM = Math.abs(edge.to[1] - edge.from[1]) * mPerLat;

  return {
    centre,
    distanceM: Math.sqrt(spanEastM * spanEastM + spanNorthM * spanNorthM),
    spanEastM,
    spanNorthM,
  };
}

function canvasOptsFor(edge: EdgeRef): CanvasOpts {
  const { spanEastM, spanNorthM } = edgeMetrics(edge);
  const toPx = (spanM: number) =>
    Math.max(16, Math.ceil((spanM + 2 * CANVAS_MARGIN_M) / METRES_PER_PIXEL));

  return {
    widthPx: toPx(spanEastM),
    heightPx: toPx(spanNorthM),
    metresPerPixel: METRES_PER_PIXEL,
    dpr: DEVICE_PIXEL_RATIO,
  };
}

/** The pixel sampler's answer for one fixture, from a canvas painted for it. */
export function referenceFor(
  fixture: AgreementFixture,
  sun: { azimuth: number; altitude: number },
  altitudeFraction: number
): { left: number; right: number } {
  const { centre, distanceM } = edgeMetrics(fixture.edge);
  const canvas = paintShadowCanvas(
    fixture.prisms.prisms, centre, sun, altitudeFraction, canvasOptsFor(fixture.edge)
  );

  return sampleBothSidewalks(
    canvas.project,
    canvas.imageData,
    canvas.dpr,
    fixture.edge.from,
    fixture.edge.to,
    edgeSampleCount(distanceM)
  );
}

/** The field's answer for one fixture, over that fixture's own geometry. */
export function fieldAnswerFor(fixture: AgreementFixture): { left: number; right: number } {
  const bbox = bboxAroundEdges([fixture.edge], 2000) ?? bboxAroundPoint(0, 0, 1);
  const provider: PrismProvider = staticPrismProvider(fixture.prisms, bbox, "tiles");
  const [shade] = createGeometryShadeField([provider]).sampleEdges([fixture.edge], fixture.when);
  return { left: shade.left, right: shade.right };
}

export function disagreementsFor(
  fixtures: AgreementFixture[],
  referenceOf: (f: AgreementFixture) => { left: number; right: number }
): Disagreement[] {
  return fixtures.map((fixture) => {
    const reference = fixture.reference ?? referenceOf(fixture);
    const field = fieldAnswerFor(fixture);
    return {
      city: fixture.city,
      left: Math.abs(field.left - reference.left),
      right: Math.abs(field.right - reference.right),
    };
  });
}

export function reportFor(disagreements: Disagreement[]): AgreementReport {
  const all = disagreements.flatMap((d) => [d.left, d.right]);
  if (all.length === 0) {
    return { cases: 0, meanAbsolute: 0, p90: 0, worst: 0, severeShare: 0, byCity: {} };
  }

  const sorted = [...all].sort((a, b) => a - b);
  const mean = all.reduce((sum, v) => sum + v, 0) / all.length;
  // Nearest-rank p90: with 2N samples this is stable and needs no interpolation.
  const p90 = sorted[Math.min(sorted.length - 1, Math.ceil(0.9 * sorted.length) - 1)];

  const byCity: Record<string, number> = {};
  for (const city of new Set(disagreements.map((d) => d.city))) {
    const cityValues = disagreements
      .filter((d) => d.city === city)
      .flatMap((d) => [d.left, d.right]);
    byCity[city] = cityValues.reduce((sum, v) => sum + v, 0) / cityValues.length;
  }

  return {
    cases: disagreements.length,
    meanAbsolute: mean,
    p90,
    worst: sorted[sorted.length - 1],
    severeShare: all.filter((v) => v > SEVERE).length / all.length,
    byCity,
  };
}

export function formatReport(report: AgreementReport): string {
  const pp = (v: number) => `${(v * 100).toFixed(1)}pp`;
  const cities = Object.entries(report.byCity)
    .map(([city, mean]) => `${city} ${pp(mean)}`)
    .join(", ");

  return [
    `shade-field agreement: ${report.cases} cases`,
    `mean ${pp(report.meanAbsolute)}`,
    `p90 ${pp(report.p90)}`,
    `worst ${pp(report.worst)}`,
    `severe ${(report.severeShare * 100).toFixed(1)}%`,
    `[${cities}]`,
  ].join(" · ");
}
