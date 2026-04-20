# ShadeMap Navigator — Build State

Browser-based sun shadow simulation app built with React + Vite. Shadows render in real time as the user navigates a map and drags a time slider. Includes shade-aware pedestrian routing and sketch-guided route drawing.

---

## Running the App

```bash
# Create / edit .env.local with keys below
npm install
npm run dev # http://localhost:5173
```

---

## Required API Keys (`.env.local`)

| Variable | Where to get it | Cost |
|---|---|---|
| `VITE_MAPTILER_API_KEY` | https://maptiler.com/ | Free (100k tiles/month) |
| `VITE_FOURSQUARE_API_KEY` | https://foursquare.com/developers/ | Free tier |

Notes:
- `VITE_TRANSITLAND_API_KEY` exists in some local setups but is **not used by the current app code**.
- `VITE_SHADEMAP_API_KEY` exists in some local setups but is **not used** (the app currently renders shadows locally).

---

## Stack

- **Vite 5** + React 19, TypeScript, Tailwind CSS v4, `react-router-dom` for client routing
- **`maplibre-gl` pinned to `5.9.0`** — see critical note below, do NOT upgrade
- **Local WebGL shadow renderer** (`app/lib/shadow/LocalShadowAdapter.ts`) registered as a MapLibre `CustomLayerInterface` (current default)
- **`mapbox-gl-shadow-simulator` ^0.68.1** — installed; legacy adapter exists (`ShadeMapAdapter.ts`) but is not currently used
- **`vitest`** — unit tests (`npm test`)
- No extra packages for GeoTIFF — custom binary TIFF writer inline in `AccumulationPanel.tsx`
- **Foursquare Places API** — building/POI info for draw-mode popups; proxied in dev via `/__fsq` (Vite) and in prod via `/api/fsq/*` (Vercel serverless function in `api/fsq.js`)

### ⚠ maplibre-gl Must Stay at 5.9.0

`mapbox-gl-shadow-simulator` internally calls `canvasSource.texture.update({ width, height })` with no `data` key.

- **v5.9.0**: routes `{width, height}` (no DOM image, no `data`) to the 9-arg `texImage2D(target, 0, fmt, w, h, 0, fmt, UNSIGNED_BYTE, null)` → creates an empty-sized texture correctly ✓
- **v5.10.0+**: refactored `hasDataProperty` check routes same object to `_uploadDomImage` → `texImage2D(..., {width, height})` → WebGL2 rejects plain object → `"Overload resolution failed"` crash ✗

This primarily matters if re-enabling the legacy `ShadeMapAdapter` path; the current build uses the local custom layer.

---

## File Structure

```
app/
  main.tsx              # React entry point; BrowserRouter with routes / and /about
  globals.css             # Tailwind v4 import; html/body full-screen (overflow:hidden)
  page.tsx                # Root page — owns all state, lazy-imports MapView
  about/
    page.tsx              # API docs, npm packages, pricing tier table
  components/
    AppShell.tsx          # Responsive shell: desktop sidebar overlay + mobile map overlays + bottom timeline
    MapView.tsx           # MapLibre map + local shadow layer (lazy-loaded)
    TimelineSlider.tsx    # Custom scrollable 24-h ruler; inertial drag; fixed red center cursor
    DaySlider.tsx         # Day-of-year slider for day-mode
    SearchBar.tsx         # Search UI shown in sidebar/overlays
    DirectionsPanel.tsx   # Routing UI (waypoints, routes, saved routes, draw mode)
    PlaceDetail.tsx       # Place details screen (selected search result)
    BottomSheet.tsx       # Mobile bottom sheet
    FloatingMapControls.tsx # Locate-me + map controls (mobile/desktop overlay)
    QuickActions.tsx      # Mobile quick actions
    LocationSearch.tsx    # (older) Nominatim search component; not the primary UI in current build
    AccumulationPanel.tsx # Sun exposure mode toggle + date range + quality slider + GeoTIFF export
    NavigationPanel.tsx   # Older routing panel; not the primary UI in current build
    SaveRouteModal.tsx    # Modal for naming/saving routes to localStorage folders
    SettingsPanel.tsx     # App settings
    DateInput.tsx         # Styled date input wrapper
  lib/
    overpass.ts           # Fetches walkable road graph from Overpass API; LRU bbox-containment cache
    routing.ts            # Pure TS: Pareto bi-criteria routing, snapToGraph/Edge, SpatialGrid, RDP simplification
    trainGraph.ts         # Dynamic OSM-based train graph: fetch, parse, Dijkstra, route finder
    building-snap.ts      # Snaps a coordinate inside a building to just outside its footprint
    exportRoute.ts        # GPX and GeoJSON export for route cards
    savedRoutes.ts        # localStorage CRUD for saved routes (folders, names, sun conditions)
    nominatim.ts          # Nominatim geocoding helpers
    timezone.ts           # Auto-resolves local timezone from map center
    metrics.ts            # Route distance/shade percentage calculations
    shadeSampling.ts      # Pure functions for shade sampling + solar intensity
  services/
    foursquare.ts         # Foursquare Places API v2 wrapper; TTL cache (1 hr); CORS-proxied via /__fsq
  lib/shadow/
    IShadowLayer.ts       # Interface: setDate, resize, remove, setSunExposure, on
    ShadeMapAdapter.ts    # Wraps the external mapbox-gl-shadow-simulator library
    LocalShadowAdapter.ts # Custom WebGL CustomLayer shadow renderer (4-pass pipeline)
    createShadowLayer.ts  # Factory: currently always returns LocalShadowAdapter

api/
  fsq.js                  # Vercel serverless proxy for Foursquare Places API (production)
```

### `page.tsx` layout (overlay structure)

Current layout is driven by `AppShell.tsx`:

- **Desktop:** full-screen map with a left **overlay sidebar** (SearchBar + panels) and a full-width **bottom timeline**.
- **Mobile:** full-screen map with overlays + a **BottomSheet** when the menu is open; timeline controls are rendered as a bottom overlay.

The timeline ruler and controls row are hidden when Sun Exposure (accumulation) mode is active. The mode-toggle button switches between time-of-day (clock icon) and day-of-year (calendar icon) slider modes; in day-of-year mode, ± year buttons replace the date/time inputs.

`page.tsx` defines UI helpers like `TimeInput` and relies on `useShadowTime` for `formatTime12h`/`parseTime`.

---

## MapView Architecture

`MapView.tsx` is **lazy-loaded** via `React.lazy(() => import(...))` wrapped in `<Suspense>` in `page.tsx`. This code-splits the heavy MapLibre bundle.

**Init pattern:**
- `initRef` guards against double-init (React strict mode / HMR)
- `mapRef` and `shadeRef` hold the MapLibre map and ShadeMap instances
- `dateRef` mirrors the `date` prop so the `map.on("resize")` handler avoids stale closures
- `shadeUpdateTimerRef` holds a 1ms debounce timer for `setDate` calls — prevents GPU thrash during rapid slider drags
- `onMapClickRef` mirrors the `onMapClick` prop to avoid stale closures on the map click handler
- `markerARef` / `markerBRef` hold MapLibre Marker instances for navigation waypoints A (green) and B (red)
- Map instance is surfaced to `page.tsx` via `onMapReady(map)` callback → stored in a ref (not state) to avoid re-renders

**Map init options:**
- `maxTileCacheSize: 50` — evicts tiles once cached count exceeds limit (controls GPU VRAM)
- `maxParallelImageRequests: 6` — limits concurrent GPU texture uploads
- `canvasContextAttributes: { preserveDrawingBuffer: true }` — required for GeoTIFF export and shade sampling

**On `map.on("load")`:**
1. Add `fill-extrusion` layer (`buildings-3d`) on `maptiler_planet` / `building` source (hidden by default via `ENABLE_3D = false`)
2. Register `pitchend` handler to lazily add/remove terrain source and toggle 3D visibility (only active if `ENABLE_3D = true`)
3. Construct the shadow layer via `createShadowLayer()` (currently `LocalShadowAdapter`) and register it if it implements `CustomLayerInterface`
4. Register `map.on("resize")` → calls `shadeRef.current.setDate(dateRef.current)` to force shadow buffer resize

**`ENABLE_3D` flag (`MapView.tsx` line 26):**
Set to `false` by default. When false, the `buildings-3d` layer is hidden and the `pitchend` handler no-ops — no elevation tiles are fetched, no terrain mesh rendered. Set to `true` to restore 3D buildings and terrain mesh on map tilt.

**Resize fix explanation:**
The shadow simulator renders into a framebuffer texture sized to the viewport. On resize, calling `setDate` forces `setRenderBuffer(gl, gl.canvas.width, gl.canvas.height)` which resizes the texture to match the new dimensions, preventing shadow offset.

**`bringNavOverlaysToFront()`:**
Helper called after any layer add to defensively `moveLayer` nav-related layers to the top of the style stack. Needed because ShadeMap's WebGL layer can be re-inserted above vector layers after each `setDate`, which would hide route lines and sketch polylines.

**Navigation layers (updated via effects):**
- Waypoint markers managed in a `useEffect` on `navWaypoints` — removes old markers and places new MapLibre Markers
- Route line managed in a `useEffect` on `navRoute` — adds/updates/removes `nav-route` GeoJSON source and `nav-route-line` layer (amber `#f59e0b`, width 4, opacity 0.9)

**Sketch layers (updated via effects):**
- `sketch-line` GeoJSON source + `sketch-line-layer` (white polyline) drawn while user places freehand points in draw mode
- `sketch-preview-layer` renders a rubber-band segment from the last sketch point to the current cursor position
- Both layers managed in a `useEffect` on `sketchPoints` and `drawMode`; cleared automatically after a route is calculated

**Transit visualization layers:**
- `mrt-entrance-connector-line` — dashed line connecting the walk leg to the train station entrance
- Train route stops and transfer marker layers added dynamically for "Via Transit" route cards

**Foursquare integration:**
- `MapView.tsx` imports `getPlaceDetails`, `getPlaceInfoFromAddress`, `isFoursquareRateLimited`, `getFoursquareApiStatus` from `services/foursquare.ts`
- When the user clicks sketch/simplified draw markers, MapView fetches Foursquare place info and displays it in a popup
- **Dev:** proxied via Vite `/__fsq` (see `vite.config.ts`)  
  **Prod:** proxied via Vercel serverless function `/api/fsq/*` (see `api/fsq.js`)

---

## LocalShadowAdapter (`app/lib/shadow/LocalShadowAdapter.ts`)

Custom WebGL shadow renderer registered as a MapLibre `CustomLayerInterface`. Replaces the ShadeMap API path for local/offline use. Draws shadows inside MapLibre's render loop using the camera matrix, eliminating the pan/zoom lag that occurred with a separate 2D canvas overlay.

**4-pass render pipeline:**

```
Pass A: Shadow triangles → Shadow FBO       (MAX blending, shadow color #01112f)
Pass B: Shadow triangles → Height FBO       (MAX blending, height-as-grayscale h/maxH)
Pass C: Roof footprints  → Shadow FBO       (destination-out, conditional erase)
Pass D: Shadow FBO       → Screen           (standard premult-alpha compositing)
```

**Passes B + C implement height-aware roof exclusion:**
- Pass B writes the normalized height of the tallest shadow caster at each pixel into a separate FBO (grayscale, 8-bit, `h/maxH`)
- Pass C renders each building's un-offset footprint (convex hull, triangulated) and samples the height FBO; if `maxIncomingHeight <= buildingHeight + 0.004` the fragment outputs `alpha=1` which destination-out erases the shadow → buildings do NOT self-shadow their own rooftops
- The `0.004` tolerance covers 8-bit quantization (1/255 ≈ 0.004); two buildings of equal height also have shadow erased (correct behaviour)
- Passes B+C are skipped when sun is below horizon or zoom < 12

**`ShadowGeometry` struct (returned by `computeShadowGeometry()`):**
- `shadowVerts / shadowHeights` — Mercator XY shadow triangles + normalized height per vertex
- `roofVerts / roofHeights` — Mercator XY footprint triangles + normalized height per vertex
- `sunBelowHorizon` — when true, a full-world quad covers the screen; B+C skipped

**Shadow color:** premultiplied `#01112f` at α=0.7. The B/R ratio (47/1 ≈ 47) satisfies the `B/R > 1.8` shade-sampling heuristic in `page.tsx`.

---

## Shade-Aware Routing

The main feature beyond shadow display. Users click "Navigate", place two waypoints on the map, then request route options.

**Pipeline (in `page.tsx` `calculateRoute`):**
1. Compute bounding box with 0.005° padding (~500 m) around the two waypoints
2. `fetchRoutingGraph(south, west, north, east)` — POST to Overpass API, returns `RoutingGraph`; LRU cache (max 5) reuses a cached graph if the new bbox is contained within a previously-fetched one
3. Read the current map canvas once via `canvas.toBlob` → `createImageBitmap` → 2D canvas `getImageData`
4. For every graph edge: call `sampleEdgeShade(map, imageData, dpr, from, to, samples=5)` — samples 6 evenly-spaced pixels along the edge; a pixel is "shaded" if `B/R > 1.8` (ShadeMap's overlay color `#01112f` has heavy blue dominance)
5. Run **Pareto bi-criteria label-setting** (`paretoRoutes` in `routing.ts`) to find the full Pareto front of (distance, shaded distance) trade-offs; extract up to 3 representatives: shortest (min distM), most shaded (max shadeM), balanced (knee point — closest to the ideal in normalized space). Labels use integer back-pointer IDs so memory is O(nodes × MAX_LABELS_PER_NODE) rather than O(nodes × pathLength); paths are reconstructed lazily only for the selected representatives.
6. Render up to 3 route cards: "Shortest", "Balanced", "Most shaded" — with distance and % shaded

**For multi-point / loop routes** (intermediate waypoints set via Alt+click), three separate `dijkstra` calls with fixed strengths [0.0, 0.5, 1.0] are run per leg and stitched together, rather than Pareto routing across all legs.

**Cost model (`routing.ts`):**
```
edge cost = distanceM * (1 - shadeStrength * shadeFactor * MAX_SHADE_SAVING)
MAX_SHADE_SAVING = 0.7   // caps saving so fully-shaded edges still cost 30% of distance
```

**Overpass query (`overpass.ts`):**
- Highway types: `footway|path|pedestrian|living_street|residential|unclassified|tertiary|secondary|service|cycleway|steps`
- Bidirectional adjacency list; all edge `shadeFactor` values initialised to 0 (caller fills in)
- Also exports `fetchStationEntrances()` for matching OSM `railway=subway_entrance` nodes to transit stations
- Throws if no walkable roads found in the bounding box

---

## Sketch-Guided Routing

Users can draw a freehand route on the map (draw mode) to hint the routing algorithm at a preferred path shape.

**Pipeline:**
1. User toggles "Draw Route" in NavigationPanel; `drawMode` state activates in `page.tsx`
2. Each map click appends a `SketchPoint` to `sketchPoints[]`; MapView renders the live polyline and rubber-band preview
3. On "Calculate": `simplifyPolyline(sketchPoints, 30)` runs Ramer-Douglas-Peucker (30 m tolerance) to reduce point count
4. `findSketchGaps()` checks each consecutive simplified pair for gaps > 200 m to the nearest road node; warns if any are found
5. `dijkstraMultiLeg()` runs Dijkstra on each consecutive simplified-waypoint pair and stitches results into one route
6. Sketch polyline is automatically cleared from the map after the route calculates

**Key exports in `routing.ts`:** `SketchPoint`, `simplifyPolyline`, `sketchBoundingBox`, `findSketchGaps`, `dijkstraMultiLeg`, `snapToEdge`, `SpatialGrid`

---

## Train Transit Routing (`trainGraph.ts`)

Generic multimodal routing using live OSM data. Works for any city with subway, light rail, or monorail in OpenStreetMap — no hardcoded station data required.

**Three-part journey:**
```
[Walk] → entry station → [Train] → exit station → [Walk]
  A                                                   B
```

**Overpass query:**
```
rel["type"="route"]["route"~"^(subway|light_rail|monorail|metro)$"](bbox);
out body;
node(r);
out body;
```
Fetches complete route relations that have at least one stop in the bbox, then all their member nodes. This gives the full network graph for lines passing through the area.

**Graph building pipeline:**
1. **Index nodes** — build lookup map from OSM node ID → {lat, lon, tags}
2. **Extract station sequences** — for each route relation, extract ordered stop node IDs (filter by role="stop" etc., skip consecutive duplicates)
3. **Build station registry** — one entry per physical station, collecting all lines that serve it
4. **Line edges** — connect consecutive stations with haversine-weighted bidirectional edges
5. **Transfer edges** — connect stations with same name within 150m (Pattern B interchanges) with 300m penalty weight

**Routing algorithm (`findBestTrainRoute`):**
1. Find N nearest stations (default 5) to origin A within 1.5km
2. Find N nearest stations to destination B within 1.5km
3. Run Dijkstra for each (entry, exit) pair on the train graph
4. Add walking distances A→entry and exit→B to each pair's cost
5. Pick lowest total cost; require ≥3 stations in path (at least 1 intermediate)

**Integration in `page.tsx`:**
- Only attempts train routing when straight-line distance > 500m
- Fetches train graph in parallel with walking graph (expanded bbox, +1.5km)
- Walk legs use the existing shade-aware Dijkstra on the walking graph
- Station entrances from `fetchStationEntrances()` are matched by name/proximity; prefers OSM `railway=subway_entrance` nodes over station centroids, falling back to centroid if no entrance found
- Train travel time estimated at 30 km/h average
- Sun exposure per mode: subway=0, light_rail=0.25, monorail=0.1
- Route displayed as "Via Transit" card with line color/name from OSM relation tags

**Caching:** Train graph cached by bbox (max 3 entries). Overpass query has 30s timeout with fallback endpoint.

---

## Tile Sources

| Purpose | Source | API Key? |
|---|---|---|
| Basemap + vector buildings | MapTiler `outdoor-v2` style | Yes (`VITE_MAPTILER_API_KEY`) |
| Shadow building data | `maptiler_planet` source, `building` layer (inside MapTiler style) | Same key |
| Terrain (shadows) | AWS Terrarium `s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png` | No |
| 3D terrain mesh | Same AWS Terrarium tiles, `encoding: "terrarium"`, `raster-dem` type (lazy, only when tilted and `ENABLE_3D=true`) | No |
| Geocoding | Nominatim (`nominatim.openstreetmap.org/search`) — requires `User-Agent` header | No |
| Routing graph | Overpass API (`overpass-api.de`) — requires `User-Agent` header | No |
| POI / building info | Foursquare Places API v2 — CORS-proxied in dev via `/__fsq` in `vite.config.ts` | Yes (`VITE_FOURSQUARE_API_KEY`) |

**Building query (`getFeatures`):**
- Source: `maptiler_planet`, layer: `building`
- Must be **async** — awaits `waitForMapLoad(map)` before calling `querySourceFeatures`
- Defaults missing heights to `render_height ?? 3.1` (one storey)
- Sorts features shortest → tallest (required by shadow simulator rasterization order)
- Returns empty array below zoom 12 (buildings not loaded at lower zooms)

---

## GeoTIFF Export (`buildGeoTIFF` in `AccumulationPanel.tsx`)

Captures map canvas → RGBA to RGB → writes a minimal uncompressed TIFF with georeferencing tags:

```
Offset   Content
0        TIFF header (8 bytes, little-endian)
8        IFD: 11 entries × 12 bytes + count + next-IFD = 138 bytes
146      BitsPerSample data: [8, 8, 8]
152      ModelPixelScaleTag: [scaleX, scaleY, 0]  (3 × float64)
176      ModelTiepointTag: [0, 0, 0, west, north, 0]  (6 × float64)
224      RGB pixel data
```

Tags: `ImageWidth`, `ImageLength`, `BitsPerSample`, `Compression=1`, `PhotometricInterpretation=2(RGB)`, `StripOffsets`, `SamplesPerPixel=3`, `RowsPerStrip`, `StripByteCounts`, `ModelPixelScaleTag(33550)`, `ModelTiepointTag(33922)`.

Canvas capture uses `canvas.toBlob` → `createImageBitmap` → 2D canvas `getImageData` (same pattern as routing shade sampling). Requires `canvasContextAttributes: { preserveDrawingBuffer: true }` on the MapLibre map.

---

## Timeline Ruler (`TimelineSlider.tsx`)

Replaces the native `<input type="range">`. The ruler is a fixed-width overflow-hidden container; a 2880 px content div (1440 min × 2 px/min) scrolls under a fixed red center cursor.

**Interaction model:**
- Drag left/right → content scrolls, red cursor stays centered → selected time = minute aligned with cursor
- `setPointerCapture` keeps drag live outside the element
- `fracMin` ref accumulates fractional pixel moves so sub-pixel drags are never lost

**Inertial scrolling:**
- EMA-smoothed velocity tracked during drag (70% new sample, 30% history)
- On pointer-up: `requestAnimationFrame` loop with `v *= e^(-0.018 * dt)` (frame-rate independent); stops at |v| < 0.04 px/ms or on boundary hit
- `dt` capped at 64 ms to avoid teleport on tab-switch; inertia cancelled immediately on next pointer-down

**Tick marks (static, computed at module load):**
- Hour ticks: 20 px, `rgba(255,255,255,0.35)` + label above
- 15-min ticks: 12 px, dimmer
- 5-min ticks: 5 px, dimmest

**Animation (in `page.tsx`):** `setInterval` at 50 ms, advances 2 min/tick (≈ 24 s/day). Play/pause uses SVG icons (triangle / two rectangles).

**`TimeInput` (in `page.tsx`):** Clicking the time label (e.g. `6:30 AM`) opens a text input. Accepts `6:30 AM`, `6:30PM`, `14:30`, `6:30`, `6 AM`, `14`, `6`. Enter/blur commits; Escape cancels.

---

## Known Working State

- ✅ Shadows render in real time as timeline ruler is dragged
- ✅ Inertial scrolling on timeline ruler with exponential decay
- ✅ Play/pause animation (2 min/tick, 50 ms interval, SVG icons)
- ✅ Editable time label (click to type; parses 12/24-hour formats)
- ✅ Terrain shadows (hills/valleys) via AWS Terrarium elevation data
- ✅ Building shadows from OSM heights via MapTiler vector tiles
- ✅ Height-aware roof exclusion — building rooftops not self-shadowed; only taller buildings' shadows fall on shorter rooftops
- ✅ 3D extruded buildings + terrain mesh when map is tilted (`ENABLE_3D=true` required; currently `false`)
- ✅ Location search (Nominatim)
- ⚠️ Sun exposure (accumulation) UI is present, but the **local renderer currently no-ops `setSunExposure()`** (accumulation rendering not implemented in `LocalShadowAdapter`)
- ✅ Sun exposure legend bar in AccumulationPanel (blue → cyan → green → yellow → red, 0 h → 12 h+)
- ✅ GeoTIFF export of the current map canvas
- ✅ Shadow overlay correctly resizes when browser window is resized
- ✅ Shade-aware pedestrian routing — Pareto bi-criteria algorithm returning Shortest / Balanced / Most shaded routes
- ✅ Sketch-guided routing — freehand draw mode with RDP simplification, gap detection, multi-leg Dijkstra, auto-clear after route calculates
- ✅ Generic train transit routing via OSM route relations (subway/light_rail/monorail, any city)
- ✅ `/about` page with API docs and pricing tiers
- ✅ Save Route: bookmark routes with names, folders, and sun conditions (localStorage)
- ✅ Multi-point waypoints for loop routes (Alt+click on map)
- ✅ GPX and GeoJSON export for generated routes
- ✅ NavigationPanel collapse/expand toggle
- ✅ User geolocation ("Locate me" with "Use as start/end" options) in NavigationPanel
- ✅ Foursquare Places info popups when clicking buildings in draw mode
- ✅ Timeline slider mode toggle: time-of-day (clock) ↔ day-of-year (calendar) with ± year buttons
