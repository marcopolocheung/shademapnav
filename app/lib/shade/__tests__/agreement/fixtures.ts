/**
 * The A3 fixture corpus: (edge, time) cases across three city morphologies.
 *
 * The brief asks for three cities that stress the model differently, and these are
 * chosen for what breaks a shade estimate rather than for variety's sake:
 *
 * - **Madrid** — a dense grid of mid-rise blocks with courtyards. Shadow edges land
 *   *on* streets here, which is where a sidewalk is half-covered and where the field
 *   and the pixels have the most room to disagree.
 * - **Singapore** — sparse towers, 1.3°N. The sun passes almost overhead, so shadows
 *   are short and swing fast; a small azimuth error moves a tower's shadow off the
 *   street entirely.
 * - **Kent, WA** — low-rise suburb at 47°N. Long shadows from short buildings, and
 *   in winter the sun barely clears the roofline. This is where the horizon term in
 *   `confidenceFor` earns its keep.
 *
 * The geometry is synthetic and regular. That is deliberate: this corpus isolates
 * *sampling* disagreement, and real building data belongs to the recorded corpus
 * (#121) that will slot into the same `AgreementFixture` shape.
 */

import SunCalc from "suncalc";
import type { EdgeRef } from "../../ShadeField";
import type { BuildingPrism, PrismSet } from "../../geometry";
import { metersPerDegree } from "../../geometry";
import type { AgreementFixture } from "./harness";

interface CitySpec {
  name: string;
  centre: [number, number];
  /** Footprint side length, metres. */
  blockM: number;
  /** Street width between adjacent blocks, metres. */
  streetM: number;
  heightM: number;
  /** Local hours (in UTC, for determinism) to sample. */
  hoursUtc: number[];
  /** Days to sample, as [month (1-12), day]. */
  days: Array<[number, number]>;
  /** Whether blocks have a courtyard — an inner ring, which becomes its own prism. */
  courtyards: boolean;
}

const CITIES: CitySpec[] = [
  {
    name: "madrid",
    centre: [-3.7038, 40.4168],
    blockM: 60,
    streetM: 20,
    heightM: 21,
    hoursUtc: [7, 10, 13, 16, 19],
    days: [
      [6, 21],
      [12, 21],
    ],
    courtyards: true,
  },
  {
    name: "singapore",
    centre: [103.8198, 1.3521],
    blockM: 45,
    streetM: 25,
    heightM: 120,
    hoursUtc: [1, 4, 7, 10, 12],
    days: [
      [3, 21],
      [9, 21],
    ],
    courtyards: false,
  },
  {
    name: "kent-wa",
    centre: [-122.2348, 47.3809],
    blockM: 18,
    streetM: 14,
    heightM: 6,
    hoursUtc: [15, 18, 20, 22, 23],
    days: [
      [6, 21],
      [12, 21],
    ],
    courtyards: false,
  },
];

/** A closed rectangular ring centred on an offset from the city centre, in metres. */
function ringAt(
  centre: [number, number],
  eastM: number,
  northM: number,
  sideM: number
): [number, number][] {
  const { mPerLat, mPerLng } = metersPerDegree(centre[1]);
  const cLng = centre[0] + eastM / mPerLng;
  const cLat = centre[1] + northM / mPerLat;
  const dLng = sideM / 2 / mPerLng;
  const dLat = sideM / 2 / mPerLat;

  return [
    [cLng - dLng, cLat - dLat],
    [cLng + dLng, cLat - dLat],
    [cLng + dLng, cLat + dLat],
    [cLng - dLng, cLat + dLat],
    [cLng - dLng, cLat - dLat],
  ];
}

/** A 3×3 block of buildings around the city centre. */
function cityPrisms(spec: CitySpec): PrismSet {
  const pitch = spec.blockM + spec.streetM;
  const prisms: BuildingPrism[] = [];

  for (let row = -1; row <= 1; row++) {
    for (let col = -1; col <= 1; col++) {
      prisms.push({
        ring: ringAt(spec.centre, col * pitch, row * pitch, spec.blockM),
        heightM: spec.heightM,
      });
      if (spec.courtyards) {
        prisms.push({
          ring: ringAt(spec.centre, col * pitch, row * pitch, spec.blockM / 3),
          heightM: spec.heightM,
        });
      }
    }
  }

  return { prisms, maxHeightM: spec.heightM };
}

/** Street-centreline edges running between the blocks, plus two diagonals. */
function cityEdges(spec: CitySpec): EdgeRef[] {
  const { mPerLat, mPerLng } = metersPerDegree(spec.centre[1]);
  const pitch = spec.blockM + spec.streetM;
  const halfRun = pitch; // a street segment spanning one block plus its junctions

  const point = (eastM: number, northM: number): [number, number] => [
    spec.centre[0] + eastM / mPerLng,
    spec.centre[1] + northM / mPerLat,
  ];

  const edges: EdgeRef[] = [];

  // East–west streets, on the two gaps between block rows.
  for (const northM of [-pitch / 2, pitch / 2]) {
    edges.push({ from: point(-halfRun, northM), to: point(halfRun, northM) });
    edges.push({ from: point(-halfRun, northM + 3), to: point(halfRun, northM + 3) });
  }

  // North–south streets, on the two gaps between block columns.
  for (const eastM of [-pitch / 2, pitch / 2]) {
    edges.push({ from: point(eastM, -halfRun), to: point(eastM, halfRun) });
    edges.push({ from: point(eastM + 3, -halfRun), to: point(eastM + 3, halfRun) });
  }

  // Diagonals, so no fixture set is purely axis-aligned — a sign error in the
  // perpendicular offset hides completely on a due-east street.
  edges.push({ from: point(-pitch, -pitch), to: point(pitch, pitch) });
  edges.push({ from: point(-pitch, pitch), to: point(pitch, -pitch) });

  return edges;
}

function timesFor(spec: CitySpec): Date[] {
  const times: Date[] = [];
  for (const [month, day] of spec.days) {
    for (const hour of spec.hoursUtc) {
      times.push(new Date(Date.UTC(2026, month - 1, day, hour, 0, 0)));
    }
  }
  return times;
}

/** The full corpus. Deterministic — no randomness, no network, no clock. */
export function agreementFixtures(): AgreementFixture[] {
  const fixtures: AgreementFixture[] = [];

  for (const spec of CITIES) {
    const prisms = cityPrisms(spec);
    const edges = cityEdges(spec);
    const times = timesFor(spec);

    // Pair each edge with a rotating slice of the times so the corpus stays around
    // 200 cases rather than 10 × 10 × 3, while every edge and every time is used.
    edges.forEach((edge, edgeIndex) => {
      times.forEach((when, timeIndex) => {
        if ((edgeIndex + timeIndex) % 2 !== 0) return;
        fixtures.push({ city: spec.name, edge, when, prisms });
      });
    });
  }

  return fixtures;
}

/**
 * The sun for a fixture, plus how high it is relative to that day's solar noon —
 * which is what `LocalShadowAdapter` uses to pick the shadow's colour.
 */
export function sunFor(fixture: AgreementFixture): {
  azimuth: number;
  altitude: number;
  altitudeFraction: number;
} {
  const lng = (fixture.edge.from[0] + fixture.edge.to[0]) / 2;
  const lat = (fixture.edge.from[1] + fixture.edge.to[1]) / 2;
  const sun = SunCalc.getPosition(fixture.when, lat, lng);

  const { solarNoon } = SunCalc.getTimes(fixture.when, lat, lng);
  const noonAltitude = SunCalc.getPosition(solarNoon, lat, lng).altitude;
  const altitudeFraction = noonAltitude > 0 && sun.altitude > 0 ? sun.altitude / noonAltitude : 0;

  return { azimuth: sun.azimuth, altitude: sun.altitude, altitudeFraction };
}
