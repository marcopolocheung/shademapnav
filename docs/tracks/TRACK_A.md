# Track A — Shade Engine

> **Charter:** make shade a *computed field*, not a screenshot. Given any coordinate or edge
> and any time, return a shade fraction with a source and a confidence — without moving the
> camera, without re-rendering, and eventually without a main thread.

**Class:** Flagship. **Runs alongside:** B, C freely; coordinate with E (`routing.ts`) and G (fixtures).

---

## Current state

- **Active checkpoint:** A4 (routing reads the field) — **second slice only**. A4a (live
  providers, #126) is done and on `main`; the `useNavigation.ts` swap is not.
- **Done and on `main`:** A1 (#123 / PR #134), A2 (#125 / PR #135), A3 (#129 / PR #136),
  A4a (#126 / PR #137) — A2, A3 and A4a only as of this re-land.
- **How that went wrong, so it does not happen again:** #134→#137 were stacked, each based on
  the previous, and all four merged within 11 seconds — so #135, #136 and #137 landed on their
  *parent branches* and only #134 ever reached `main`. The tree survived at
  `origin/shade/a3-agreement` (`35f9c6e2`); this PR re-lands those seven files verbatim.
  **Do not stack Track A PRs.** Branch each from `main` and let it merge before the next starts.
- **Blocked on:** **A4's second half is blocked on #122** — `pointInPrismShadow` rebuilds every
  shadow polygon per query point, far too slow to sample a route graph, so the swap cannot be
  wired until the geometry is built once and indexed. It is also gated on #121: swapping
  `useNavigation.ts`'s shade source changes what every user sees on every route, and the
  definition of done requires that confirmed in `npm run dev`. Do not land the swap on test
  evidence alone; this track's stated risk #1 is a field that looks right and is quietly wrong,
  and A3 measures agreement, not whether the app still works.
  Also open: #128 (boundary-parallel disagreement), #120 (height reconciliation).
- **The agreement number, as of this re-land** (unchanged from what #136 recorded, despite
  `geometry.ts` gaining 98 lines from #159): `150 cases · mean 2.6pp · p90 0.0pp · worst 62.5pp ·
  severe 3.3% · [madrid 2.2pp, singapore 2.3pp, kent-wa 3.4pp]`. Committed ceilings: mean 0.04,
  p90 0.05, severe share 0.04. **These come down as the field improves; raising one is a product
  decision, not a way to make a failure go away.**

### Decisions made

**A1 — geometry extraction**
- `BuildingPrism` is **one prism per ring**, not per building. Both pre-existing implementations
  already treated inner rings as separate solids, so flattening changes nothing and keeps the type
  flat enough to transfer to a worker later (A5).
- Prisms carry the ring **exactly as the source delivered it** (closed); `openRing` normalizes at
  use. Rewriting coordinates on ingest would have changed the earcut output and therefore the
  rendered roof triangles.
- `PrismSet.maxHeightM` is computed over the *filtered* feature set, before the geometry-type
  check — that is what the renderer's height normalization did before.
- Height derivation is **not** unified across sources (tiles 3.1 m storeys / 3.1 m default,
  Overpass 3 m / 10 m). Filed as #120; it changes numbers, so it belongs to whoever calibrates.
- `vitest.config.ts`'s include glob was widened to `**/__tests__/**` so `app/lib/shade/__tests__/`
  runs at all. Track G owns that file — one glob, flagged in the PR.

**A2 — the field**
- **Providers, not a hard-wired source.** `PrismProvider.prismsFor(bbox)` returns `null` when it
  cannot speak for an area, never an empty set — "no buildings here" and "I haven't loaded this"
  give the same shade number and completely different confidence. Providers are tried in order.
- **`source: "none"`** was added to the published union, distinguished by confidence: `1` for a sun
  below the horizon (astronomically certain, no geometry consulted) and `0` for "nothing covered
  this point", which is a request to fall back rather than a claim of full sun.
- **Confidence is `sourceBase × horizonFactor × dataFactor`**, each documented in `confidenceFor`.
  `dataFactor` keys off *whether the covering source holds any buildings at all*, deliberately
  **not** off whether one is within shadow reach of the sample — the first draft did the latter
  and scored every sunlit point at 0.32, which would have sent almost every open-street edge to
  the canvas fallback at A4. Base values (tiles 0.8, Overpass 0.7) are priors; A3 is what turns
  them into calibrated numbers.
- **`sampleEdges` mirrors `sampleBothSidewalks` exactly** — same ±4 m offset, same `111195` m/deg
  constant, same sign convention, and the same **sample count**: `useNavigation.ts:951` passes
  `max(3, ceil(distanceM / 25))`, *not* the sampler's default of 5, so `edgeSampleCount`
  reproduces that rule. Missing it would have made long edges disagree purely on density.
- **`shadeAt` softens, `sampleEdges` does not.** A point query averages the 5-offset ±4 m probe
  that `queryPointShade` and `computeBuildingShadeFraction` have always run — right for "is this
  terrace shaded?", a question about a few square metres. Edge sampling tests the exact sidewalk
  point instead, because it has *already* displaced the sample ±4 m; doing both smears each
  sidewalk across the street it belongs to. **The first draft did both, and A3 caught it as a
  60pp disagreement on a Madrid street.** Pinned by a test.
- An edge's confidence is the **minimum** of its two sidewalks': the whole edge is only as
  trustworthy as its least-covered side.
- `sweep` is correct but naive. A6 replaces the body; a test pins it to be identical to N separate
  `sampleEdges` calls.

**A4a — live providers**
- **`prismsFor` is synchronous and never fetches.** Only `ready()`/`load()` touches the network.
  If the synchronous query could trigger a fetch, sampling one route would fire one Overpass
  request per edge against a shared, rate-limited public service.
- **The tile provider declines anything off-screen.** `querySourceFeatures` sees loaded tiles, not
  the world, so an empty result outside the viewport means "I don't know", and returning an empty
  `PrismSet` would read as open sky at 0.8 confidence. It also declines below zoom 12, where
  MapTiler stops serving building geometry — the same threshold `LocalShadowAdapter` bails at.
- **The Overpass fetch is padded 25% past the requested bbox**, because a shadow is cast by
  buildings *outside* the area it falls on; a fetch stopping at the bbox edge reports a sunlit
  street beside an unseen tower.
- **A too-large area is declined, not attempted.** `fetchBuildingFootprintsAround` gives Overpass
  10 s and aborts at 12 s; a city-scale bbox fails both. Splitting a long route's bbox belongs
  with A5's worker.
- **A failed fetch caches nothing.** Caching it as an empty set would turn a 429 into a confident
  claim of open sky. Concurrent loads of the same area collapse into one request.

**A3 — the harness**
- **The reference is the real pixel sampler**, imported, not reimplemented: `sampleBothSidewalks`
  and `isBlueDominantShadowPixel` run over a synthetic canvas painted in `LocalShadowAdapter`'s
  actual shadow colours and composited the way MapLibre does. That also makes this the only test
  in the suite that exercises **invariant #5** end to end — paint shade in the renderer's colours,
  read it back through the blue-dominant predicate.
- **The corpus isolates sampling disagreement from geometry disagreement**, and says so. Because
  both paths see the same prisms, the number measures pixel quantization, offset placement,
  sample density and the colour round-trip — *not* MapTiler-vs-Overpass building differences.
  Measuring those needs a browser (#121); the fixture format is already the one that recording
  produces, so the real corpus slots in without touching the metric.
- **Three morphologies, chosen for what breaks an estimate:** Madrid (dense mid-rise grid with
  courtyards — shadow edges land *on* streets), Singapore (towers at 1.3°N — short shadows that
  swing fast), Kent WA (low-rise at 47°N — long shadows, winter sun barely clearing the roofline).
- **A `severeShare` gate, not just p90.** With nine cases in ten agreeing exactly, p90 is 0 and
  blind to the tail. `severeShare` counts readings differing by more than 25pp — enough to change
  which side of a street a route picks.
- **The remaining tail is understood, not hand-waved.** Almost all of it is a shadow boundary
  running *parallel* to a street and landing within a pixel of the sidewalk line, so every sample
  flips together. The field is the more accurate side (it samples the true 4 m offset; the canvas
  rounds to the nearest 1.2 m pixel), but the renderer is what the user believes — filed as #128
  with two candidate fixes for A4.

- **Verification gap:** no browser check is possible on this machine — the cached Playwright
  Chromium is missing `libnss3`/`libnspr4`/`libasound2` and there is no passwordless sudo (#121).
  A1 substituted `tileGeometryParity.test.ts` (pre-refactor implementation held as a reference,
  identical roof triangles, shadow triangles at five sun positions, and point-in-shadow answers
  over a grid). A2 and A3 are pure logic with no UI.
- **Also filed:** #122 — `pointInPrismShadow` rebuilds every prism's shadow polygon per query
  point. A3's canvas painter had to hoist that out to run at all, which is a preview of the fix
  A6 needs.
- **Next action:** A4b — the `useNavigation.ts` swap, **once #121 clears**. Replace the
  `edgeShadeCache` / `sampleBothSidewalks` block (`useNavigation.ts:956`) with
  `field.sampleEdges()`, keep the pixel path behind a `confidence < LOW_CONFIDENCE` fallback, call
  `field.ready(bbox)` alongside `fetchRoutingGraph`, and drop the pre-sampling `fitBounds`
  (`:879`) once the field is authoritative. ⚠️ `useNavigation.ts` is a contested file — keep the
  diff surgical, say so in the PR's first sentence, and coordinate with Track E.
  If A4b stays blocked, A6 (time sweep) is the next unblocked checkpoint and is pure logic.
- **Last verified:** 2026-08-24, 245 tests / 28 files green on `feat/a4-live-prism-providers`
  (baseline on `main` was 156 / 23)

---

## Why this track exists

`useNavigation.ts:890-897` does this, every time a route is calculated:

```ts
const canvas = map.getCanvas();
const tmp = document.createElement("canvas");
ctx2d.drawImage(canvas, 0, 0);
const imageData = ctx2d.getImageData(0, 0, tmp.width, tmp.height);
```

…then classifies pixels with `isBlueDominantShadowPixel` (`shadeSampling.ts:10`). Shade is
whatever the renderer painted, in the viewport, at the current zoom, right now.

Five consequences, all of which are somebody else's blocked checkpoint:

| Consequence | Who it blocks |
|---|---|
| Routing can't leave the main thread (needs the DOM canvas) | #38, A5 |
| A 14-hour time sweep costs 14 re-renders | D1, D6 — the daily-habit product |
| The route must be inside the viewport (`fitBounds` before sampling, `useNavigation.ts:879`) | long routes, B (guidance ahead of the user) |
| Only what the renderer draws counts — no trees, ever | #46, A7 |
| Accuracy is capped by the shade-color predicate (invariant #5) | D4, D8 |

## What already exists (do not rebuild these)

- **`IShadowLayer.queryPointShade(lng, lat, {date}) → { shadeFraction, source: "geometry-cache" } | null`**
  (`app/lib/shadow/IShadowLayer.ts`) — the camera-free probe contract, already defined, with a
  documented "return null and let the caller fall back" rule. **`ShadeField` is the
  generalization of this interface, not a replacement for it.**
- **`LocalShadowAdapter.ts:251-282`** — implements it from `buildingCache`, a cache of building
  prisms built from MapTiler vector tiles, invalidated on `sourcedata`/`moveend`/`zoomend`
  (`:122-141`). Viewport-scoped, which is exactly the limitation to remove.
- **`app/lib/shadow/offscreenShade.ts`** — `queryOffscreenBuildingShade()`: fetches footprints
  within 180 m via Overpass, `computeBuildingShadeFraction()` ray-tests 5 offsets against sun
  azimuth/altitude from suncalc. Pure, tested, viewport-independent — **this is the seed of the
  geometric field.** It's already the fallback path in the agent's `check_shade` (`tools.ts:365`).
- **`shadeSampling.ts:sampleBothSidewalks()`** — samples ±4 m perpendicular offsets at 5 points
  per edge, returning `{left, right}` so Dijkstra can pick the shaded sidewalk. **The
  left/right split is a genuine product asset** (Track B's "cross to the shaded side" cue
  depends on it). Preserve this semantics in the field API.
- **`app/lib/overpass.ts:382 fetchBuildingFootprintsAround()`**, `:399` the building query.

## Hard invariants that bite this track

- **Invariant #5 — shadow color ↔ shade predicate coupling.** `isBlueDominantShadowPixel`
  (`r+g+b < 600 && b - (r+g)/2 > 18 && b > (r+g)/2 * 1.15`) must keep working against
  `LocalShadowAdapter`'s colors for as long as the pixel path is the fallback. **Do not tune
  shadow colors to improve the field** — the field must not depend on them at all.
- **Invariant #3 — `preserveDrawingBuffer: true`** stays; GeoTIFF export and the fallback both read back.
- **Invariant #2 — `suncalc` stays on 1.x** and is imported as a default import.
- **Invariant #1 — `maplibre-gl` pinned at 5.9.0.**
- Overpass calls need a `User-Agent` (invariant #6) and polite rate limiting + caching.

## The contract this track publishes

`app/lib/shade/ShadeField.ts` — nobody else implements shade math:

```ts
export interface ShadeSample {
  shade: number;                                              // 0–1
  source: "tiles" | "overpass" | "canopy" | "mixed" | "canvas";
  confidence: number;                                         // 0–1
}

export interface EdgeShade { left: number; right: number; confidence: number }

export interface ShadeField {
  shadeAt(lng: number, lat: number, when: Date): ShadeSample;
  sampleEdges(edges: EdgeRef[], when: Date): EdgeShade[];
  sweep(edges: EdgeRef[], times: Date[]): EdgeShade[][];       // A6
  ready(bbox: BBox): Promise<void>;                            // geometry preload
}
```

`confidence` is not decoration — it's how callers decide to fall back to the canvas path
(A4) and how the UI stays honest (guardrail: any number shown must be traceable).

---

## What Track A has published (import this, don't re-derive it)

`app/lib/shade/geometry.ts` — A1:

```ts
interface BuildingPrism { ring: [number, number][]; heightM: number }  // ring as-delivered, may be closed
interface PrismSet { prisms: BuildingPrism[]; maxHeightM: number }

prismsFromTileFeatures(features)   // MapTiler `building` features -> PrismSet (filtered, shortest first)
prismsFromFootprints(footprints)   // Overpass BuildingFootprint[]  -> PrismSet
buildingHeightM(props)             // render_height -> height -> levels x 3.1 -> 3.1
openRing(ring) / metersPerDegree(lat)
buildShadowTriangles(ring, heightM, azimuth, altitude, mPerLat, mPerLng)
pointInPrismShadow(prisms, lng, lat, azimuth, altitude, mPerLat, mPerLng)
triangulateRing / pointInPolygon / pointInTriangle / pointInTriangles
```

Mercator projection and vertex-buffer packing deliberately stayed in `LocalShadowAdapter` — they
are rendering concerns, and keeping them out is what lets A5 move this module into a worker.

`app/lib/shade/ShadeField.ts` — A2:

```ts
type ShadeSource = "tiles" | "overpass" | "canopy" | "mixed" | "canvas" | "none";
interface ShadeSample { shade: number; source: ShadeSource; confidence: number }
interface EdgeRef    { from: [number, number]; to: [number, number] }   // canonical direction
interface EdgeShade  { left: number; right: number; source: ShadeSource; confidence: number }
interface BBox       { west: number; south: number; east: number; north: number }

interface PrismProvider {
  source: "tiles" | "overpass";
  prismsFor(bbox: BBox): PrismSet | null;   // null = "I can't speak for this area"
  load?(bbox: BBox): Promise<void>;
}

createGeometryShadeField(providers): ShadeField   // shadeAt / sampleEdges / sweep / ready
staticPrismProvider(set, coverage, source)        // tests, or a caller already holding geometry
confidenceFor(source, sunAltitudeRad, prismsAvailable)
edgeSampleCount(distanceM)                        // max(3, ceil(d/25)) — the pixel path's rule
LOW_CONFIDENCE = 0.5                              // below this, prefer another source
sidewalkOffsets(edge) / bboxAroundPoint / bboxAroundEdges / bboxContains
```

`app/lib/shade/providers.ts` — A4a:

```ts
createTilePrismProvider(getMap)        // MapTiler tiles; declines off-screen and below zoom 12
createOverpassPrismProvider(opts?)     // Overpass; fetches only from load(), LRU over 4 areas
bboxRadiusM(bbox)
interface TileMapLike { getZoom, getBounds, querySourceFeatures }   // maplibregl.Map satisfies it
```

Order them tiles-first: `createGeometryShadeField([tiles, overpass])`.

**Other tracks:** import `ShadeField`, not the geometry module, unless you are working on the
field itself. `confidence` is the contract's point — a low-confidence sample must never become a
confident sentence in the UI or in an assistant answer.

---

## Checkpoints

### A1 — Extract geometry assembly
**Goal.** One module owns "footprints + heights → prisms", from both sources.
**Approach.** New `app/lib/shade/geometry.ts` with a normalized `BuildingPrism { ring: [number,number][], heightM: number }`. Move the prism-building half of `LocalShadowAdapter.buildBuildingGeometryCache()` into it; make `offscreenShade.ts` produce the same type from `BuildingFootprint`. Keep the WebGL buffer packing in the adapter — only geometry moves.
**Acceptance.** Adapter consumes the module; zero visual change in `npm run dev` (shadows identical at 3 zooms and 3 times of day); unit tests build prisms from a vector-tile feature fixture and an Overpass fixture; `queryPointShade` still returns identical values on a fixture.
**Files.** `app/lib/shade/geometry.ts` (new), `LocalShadowAdapter.ts`, `offscreenShade.ts`.
**Size.** Medium. Pure refactor — no behavior change is the whole point.

### A2 — `ShadeField` v1 (the contract)
**Goal.** Publish the interface and a working geometry-backed implementation.
**Approach.** `shadeAt` = `computeBuildingShadeFraction`'s ray test over A1 prisms, generalized to accept a prism provider (tiles or Overpass) and a sun position. `sampleEdges` = `sampleBothSidewalks`'s ±4 m / 5-sample geometry, but testing prisms instead of pixels. Cache prisms by tile key with an LRU (copy the containing-bbox LRU pattern already in `overpass.ts`).
**Acceptance.** Tests over hand-computed cases: one prism, sun due south at 30° altitude → known shadow polygon; a point inside/outside it; an edge half-covered returns ≈0.5; sun below horizon returns 1.0 everywhere; `confidence` drops when no prism source covers the bbox. Published in the brief for other tracks to import.
**Files.** `app/lib/shade/ShadeField.ts`, `app/lib/shade/__tests__/`.
**Size.** Large — the core of the track. Split into "point query" and "edge query" PRs if it runs long.

### A3 — Agreement harness
**Goal.** Make "is the field as good as the pixels?" a number, not an opinion.
**Approach.** ~200 (edge, time) fixtures across 3 cities with different morphology (Madrid grid + courtyards, Singapore towers, a low-rise suburb). Record the pixel sampler's answer once, offline, as the reference. Report mean absolute disagreement and the 90th percentile.
**Acceptance.** `npm test` prints the disagreement metric; a threshold is committed; CI fails on regression. Coordinate with **G4** — Track G owns the fixture infrastructure, this track owns what's in the fixtures.
**Files.** `app/lib/shade/__tests__/agreement/`, coordinated with `e2e/**`.
**Size.** Medium. **Gate: A4 does not start until this is green.**

### A4 — Routing reads the field
**Goal.** Cut the canvas out of the routing path.
**Approach.** In `useNavigation.ts:801 calculateRoute` (and `:495 calculateSketchRoute`), replace the `edgeShadeCache`/`sampleBothSidewalks` block (`:956`) with `field.sampleEdges()`. Keep the pixel path behind a `confidence < threshold` fallback. Remove the pre-sampling `fitBounds` (`:879`) once the field is authoritative.
**Acceptance.** A route calculates correctly with the map panned two cities away; A3 disagreement stays under threshold; `window.__shadeMapMetrics` shows `canvasRead` at ~0 on the field path; existing routing tests unchanged and passing.
**Files.** `useNavigation.ts` (⚠️ contested — keep the diff surgical), `app/lib/shade/**`.
**Size.** Medium. **Coordinate with Track E** if E1 (cost model) is in flight.

### A5 — Worker offload
**Goal.** Get graph build + shade sampling + Dijkstra off the main thread. Closes **#38**.
**Approach.** `app/workers/routing.worker.ts` following the `?worker` import pattern from `sunPosition.worker.ts`. The field is now pure data + math, so it transfers. Post prisms and the graph as transferables; stream per-leg results back (the streaming preview already exists).
**Acceptance.** Main-thread long-task time during a 5-point route drops measurably against **G2's committed benchmark** (no benchmark → no claim); UI stays interactive (timeline draggable mid-calculation).
**Files.** `app/workers/routing.worker.ts` (new), `useNavigation.ts`, `app/lib/shade/**`.
**Size.** Large. **Depends on G2 existing.**

### A6 — Time sweep
**Goal.** `sweep(edges, times[])` — N hours for far less than N× the cost.
**Approach.** Load geometry once; vectorize sun positions across times; reuse the per-edge sample geometry. The shadow polygon for a prism is an affine function of sun azimuth/altitude — precompute per-prism projections per time, not per edge per time.
**Acceptance.** A 14-hour sweep over a 3 km route costs < 2× a single-hour sample; results match 14 individual `sampleEdges` calls exactly.
**Files.** `app/lib/shade/ShadeField.ts`, tests.
**Size.** Medium. **This is Track D's dependency — D1 can ship before it, D6 can't.**

### A7 — Canopy v1 (Overpass trees)
**Goal.** Stop under-reporting shade on the streets shade-seekers actually use. Closes **#46**.
**Approach.** Extend the Overpass query with `natural=tree`, `natural=tree_row`, `landuse=forest`, `leaf_type`. Crown model: radius from `diameter_crown` when tagged, else a species/`leaf_type` default (document the defaults); height from `height` else a default. Contribute as `source: "canopy"` with **lower confidence than buildings** — the tagging is sparse and the model is crude.
**Acceptance.** A tree-lined Madrid/Barcelona street reports materially more shade than before; confidence reflects tag sparsity; the UI can distinguish building shade from tree shade; seasonal honesty: deciduous canopy is discounted outside leaf-on months (document the month window per hemisphere).
**Files.** `app/lib/overpass.ts`, `app/lib/shade/canopy.ts` (new).
**Size.** Large. Split: (a) fetch + model, (b) integrate into the field, (c) surface in the UI.

### A8 — Canopy v2 + height fallback *(stretch)*
Meta/WRI 1 m global canopy height (free, AWS/GEE, updated 2026, MAE 2.8 m) where tiles can be
served; Overture Buildings heights where OSM `building:levels` is missing — the leading cause
of "the app says sun and I'm standing in shade". Both are raster/tile plumbing, not new math.

### A9 — Beyond binary *(stretch, feeds Track D)*
Export the ingredients of a radiant load, not just a fraction: sky view factor per sample, sun
altitude, surface class. This is what turns Track D's heat score from a heuristic into
something comparable with the SOLWEIG/UTCI literature.

---

## Subagent plan

- **Scouts, freely.** "Where does the adapter build prisms and where is that cache invalidated?" / "Does Overpass expose `diameter_crown` often enough to matter in Madrid?" — bounded, read-only, parallel.
- **A3 fixtures are swarm-able**: three cities, three independent fixture sets, disjoint files, worktree isolation.
- **A7 is swarm-able in three slices** (fetch+model / field integration / UI) *only after* the interfaces between them are written down.
- **A1, A2, A4, A5, A6 are solo.** Each is the next one's input, and A4 edits a contested file.
- **Verifier on every checkpoint.** This track's failure mode is a field that looks right and is quietly wrong; a cold reviewer with the acceptance criteria catches more than another self-review.

## Risks

1. **The field disagrees with the render and users see both.** The map paints pixels; routing uses geometry. If they diverge visibly, trust dies. Mitigation: A3's threshold is a product gate, not a test detail — and when they diverge, the *renderer* is what the user believes, so fix the field or lower the confidence.
2. **Overpass rate limits** on tree queries in dense cities. Mitigation: reuse the routing-graph bbox and cache; never issue a tree query the graph fetch didn't already cover.
3. **Sparse tagging** makes canopy confidence low in exactly the cities that need it. Mitigation: A8's raster; and say so in the UI rather than overclaiming.
4. **Scope drift into a microclimate simulator.** Out of scope — see AUTONOMOUS_GOAL §7. Approximate honestly, hand the physics to Track D.

## Out of scope / hand-offs

- Heat units, UV, UTCI → **Track D** (consumes A9).
- Cost-model weighting of shade → **Track E** (A supplies the numbers; E decides what they're worth).
- Agent probes → **Track C** (already calls `queryPointShade`; will call `ShadeField` at C3).
- Benchmarks, fixtures infrastructure, CI budgets → **Track G**.
