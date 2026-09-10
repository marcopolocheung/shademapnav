/**
 * Tagged-canopy census (Track A, A7).
 *
 * Answers one question the A7 model cannot answer for itself: **how much of the canopy
 * that is actually there does OSM know about?** The crown model is only as good as the
 * tags feeding it, and #275 (should the renderer paint tree shadow at all?) turns
 * entirely on whether OSM has three trees on a forty-tree street or thirty-five.
 *
 * Run against the same three cities the A3 agreement corpus uses, so the coverage
 * number and the agreement number describe the same places.
 *
 *   node scripts/canopy-census.mjs [--radius 800] > census.json
 *
 * Hits the public Overpass API directly, from Node, with a real User-Agent — which is
 * why this is a script and not app code (CLAUDE.md invariant 6). Read-only, a handful
 * of queries, spaced out and backing off on a refusal. Results as of 2026-09-09 are
 * written up in `docs/notes/canopy-coverage-2026-09-09.md`; OSM changes under it, so
 * re-run rather than trusting the numbers there indefinitely.
 */

const ENDPOINT = "https://overpass-api.de/api/interpreter";
const USER_AGENT = "umbra-canopy-census/1.0 (https://github.com/marcopolocheung/ShadeMapNavigation)";

/**
 * The A3 corpus cities, same centres as `__tests__/agreement/fixtures.ts`.
 *
 * `area` is an Overpass area filter for the whole municipality, and `inventory` the
 * count that municipality publishes for its own trees — the two together are what
 * turn a tag-density figure into an answer to "how much of the canopy is OSM missing?"
 * Kent, WA has no published inventory to hand and is left without one rather than
 * compared against a guess.
 */
const CITIES = [
  {
    name: "Madrid",
    centre: [-3.7038, 40.4168],
    area: 'area["wikidata"="Q2807"]->.a;',
    inventory: {
      trees: 300_000,
      what: "street trees (arbolado viario) under municipal maintenance",
      source: "Ayuntamiento de Madrid, Arbolado viario — madrid.es",
    },
  },
  {
    name: "Singapore",
    centre: [103.8198, 1.3521],
    area: 'area["name:en"="Singapore"]["admin_level"="2"]->.a;',
    inventory: {
      trees: 500_000,
      what: "urban trees mapped on Trees.SG",
      source: "NParks / GovTech, Trees.SG — tech.gov.sg",
    },
  },
  { name: "Kent, WA", centre: [-122.2348, 47.3809] },
];

const WALKABLE =
  "^(footway|path|pedestrian|living_street|residential|unclassified|tertiary|secondary|service|cycleway|steps|track|bridleway)$";

function bboxAround([lng, lat], radiusM) {
  const dLat = radiusM / 111320;
  const dLng = radiusM / (111320 * Math.cos((lat * Math.PI) / 180));
  return [lat - dLat, lng - dLng, lat + dLat, lng + dLng];
}

function haversineM(a, b) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function lineLengthM(geometry) {
  let sum = 0;
  for (let i = 1; i < geometry.length; i++) sum += haversineM(geometry[i - 1], geometry[i]);
  return sum;
}

/** Planar shoelace area in m², good enough at neighbourhood scale. */
function ringAreaM2(geometry) {
  if (geometry.length < 3) return 0;
  const lat0 = geometry[0].lat;
  const mPerLng = 111320 * Math.cos((lat0 * Math.PI) / 180);
  let a2 = 0;
  for (let i = 0; i < geometry.length; i++) {
    const p = geometry[i];
    const q = geometry[(i + 1) % geometry.length];
    a2 += (p.lon * mPerLng) * (q.lat * 111320) - (q.lon * mPerLng) * (p.lat * 111320);
  }
  return Math.abs(a2) / 2;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * One Overpass call, with backoff.
 *
 * The public instance answers 429 well before it answers wrongly, and a census is
 * three large queries against a service other people are also using — so a refusal
 * is waited out rather than retried immediately.
 */
async function overpass(query, attempt = 0) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
    },
    body: `data=${encodeURIComponent(query)}`,
  });
  if ((res.status === 429 || res.status === 504) && attempt < 5) {
    const waitMs = 30_000 * 2 ** attempt;
    process.stderr.write(`  ${res.status}; retrying in ${waitMs / 1000}s\n`);
    await sleep(waitMs);
    return overpass(query, attempt + 1);
  }
  if (!res.ok) throw new Error(`Overpass ${res.status} ${res.statusText}`);
  const text = await res.text();
  if (text.trimStart().startsWith("<")) throw new Error("Overpass returned an error document");
  return JSON.parse(text);
}

function pct(n, d) {
  return d === 0 ? null : (100 * n) / d;
}

async function censusFor(city, radiusM) {
  const [s, w, n, e] = bboxAround(city.centre, radiusM);
  const bbox = `${s},${w},${n},${e}`;
  const query = `
[out:json][timeout:120];
(
  node["natural"="tree"](${bbox});
  way["natural"="tree_row"](${bbox});
  way["natural"="wood"](${bbox});
  way["landuse"="forest"](${bbox});
  way["highway"~"${WALKABLE}"]["area"!="yes"](${bbox});
);
out body geom;
`.trim();

  const json = await overpass(query);
  const elements = json.elements ?? [];

  const trees = elements.filter((el) => el.type === "node" && el.tags?.natural === "tree");
  const rows = elements.filter((el) => el.type === "way" && el.tags?.natural === "tree_row");
  const woods = elements.filter(
    (el) => el.type === "way" && (el.tags?.natural === "wood" || el.tags?.landuse === "forest")
  );
  const streets = elements.filter((el) => el.type === "way" && el.tags?.highway);

  const streetKm = streets.reduce((sum, el) => sum + lineLengthM(el.geometry ?? []), 0) / 1000;
  const rowKm = rows.reduce((sum, el) => sum + lineLengthM(el.geometry ?? []), 0) / 1000;
  const woodHa = woods.reduce((sum, el) => sum + ringAreaM2(el.geometry ?? []), 0) / 10000;

  const has = (tag) => trees.filter((t) => t.tags?.[tag] != null).length;

  const municipality = city.area
    ? {
        ...city.inventory,
        osmTrees: Number(
          (await overpass(`[out:json][timeout:300];${city.area}node["natural"="tree"](area.a);out count;`))
            .elements[0].tags.total
        ),
      }
    : null;
  if (municipality) {
    municipality.osmShare = municipality.osmTrees / municipality.trees;
  }

  return {
    city: city.name,
    centre: city.centre,
    radiusM,
    areaKm2: (Math.PI * radiusM * radiusM) / 1e6,
    streetKm,
    trees: trees.length,
    treesPerStreetKm: streetKm === 0 ? null : trees.length / streetKm,
    treeRows: rows.length,
    treeRowKm: rowKm,
    woods: woods.length,
    woodHa,
    tagged: {
      diameter_crown: pct(has("diameter_crown"), trees.length),
      height: pct(has("height"), trees.length),
      leaf_type: pct(has("leaf_type"), trees.length),
      leaf_cycle: pct(has("leaf_cycle"), trees.length),
      species: pct(has("species"), trees.length),
    },
    municipality,
  };
}

const args = process.argv.slice(2);
const radiusM = Number(args[args.indexOf("--radius") + 1]) || 800;

const results = [];
for (const city of CITIES) {
  process.stderr.write(`querying ${city.name}…\n`);
  results.push(await censusFor(city, radiusM));
  await sleep(10_000);
}

console.log(JSON.stringify(results, null, 2));
