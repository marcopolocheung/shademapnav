# app/lib

Pure TypeScript utilities. No React, no MapLibre imports — all functions are testable in isolation.

## Key Files
- `routing.ts` — Core types (`RoutingGraph`, `GraphNode`, `GraphEdge`, `SketchPoint`), `haversine`, `snapToGraph`, `snapToEdge`, `SpatialGrid`, `simplifyPolyline`, `dijkstraMultiLeg`, `graphToGeoJSON`; Pareto multi-criteria routing (not simple Dijkstra × 3); cost model: `distanceM * (1 - shadeStrength * shadeFactor * 0.7)`
- `overpass.ts` — `fetchRoutingGraph(S, W, N, E)` — POSTs to Overpass API, returns `RoutingGraph`; highway filter: footway/path/pedestrian/residential/etc.; requires `User-Agent` header; also exports `fetchStationEntrances`; LRU cache with bbox-containment check (max 5 entries — reuses cached graph if new bbox is contained within a cached one)
- `trainGraph.ts` — Dynamic OSM train graph: fetches subway/light_rail/monorail route relations, builds station graph, runs Dijkstra; works for any city in OSM
- `building-snap.ts` — Snaps a coordinate that falls inside a building to just outside the nearest building footprint (does not snap to road nodes — that role belongs to `snapToGraph` in routing.ts)
- `exportRoute.ts` — GPX and GeoJSON export for route cards
- `savedRoutes.ts` — localStorage CRUD for saved routes (folders, names, sun conditions)
- `nominatim.ts` — Nominatim geocoding helpers; requires `User-Agent` header
- `timezone.ts` — Auto-resolves local timezone from map center coordinates
- `metrics.ts` — Route distance/shade percentage calculations

## Shadow Renderer (`shadow/` subdirectory)
- `IShadowLayer.ts` — interface: `setDate(date)`, `resize()`, `remove()`, `setSunExposure(...)`, `on(event, cb)`
- `ShadeMapAdapter.ts` — wraps the external `mapbox-gl-shadow-simulator` npm package
- `createShadowLayer.ts` — factory that returns `ShadeMapAdapter` or `LocalShadowAdapter` based on env
- `LocalShadowAdapter.ts` — custom WebGL `CustomLayerInterface`; 4-pass pipeline:
  - Pass A: shadow triangles → shadow FBO with MAX blending
  - Pass B: shadow triangles → height FBO (grayscale `h/maxH`) with MAX blending
  - Pass C: roof footprints → shadow FBO with destination-out (erases self-shadow; skips if `maxIncoming > buildingHeight + 0.004`)
  - Pass D: shadow FBO → screen
  - Roof geometry = convex hull of raw footprint, triangulated, at same normalized height
  - Passes B+C skipped when `sunBelowHorizon` or zoom < 12

## Test Coverage (`__tests__/`)
- `routing.test.ts` — Dijkstra correctness, graph construction
- `overpass.test.ts` — Overpass response parsing
- `building-snap.test.ts` — Waypoint snapping
- `timezone.test.ts` — Timezone resolution

## Patterns
- All functions are pure or explicitly async (no side effects on import)
- Overpass queries use POST with `application/x-www-form-urlencoded` body
- Graph edges store `shadeFactor: 0` initially; `sampleEdgeShade` in `page.tsx` fills values from canvas pixels
- Train graph cached by bbox string key (max 3 entries) to avoid redundant Overpass fetches
- Overpass routing graph uses LRU cache with bbox-containment check: if the requested bbox fits inside an already-cached bbox, the cached graph is returned without re-fetching (max 5 entries)

## Gotchas
- `trainGraph.ts` requires ≥3 stations in result path (rejects trivial single-hop routes)
- Transfer edges between same-named stations within 150 m get 300 m penalty weight
