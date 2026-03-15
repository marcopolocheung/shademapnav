# Fix: LocalShadowAdapter Missing Building Footprints

> **Problem:** The `LocalShadowAdapter` currently renders shadow polygons only. It emits **zero building geometry** — no rooftop fills, no building footprint layer. The base MapLibre tile style may draw extruded buildings, but `LocalShadowAdapter` must also render flat building footprint fills to match ShadeMap's visual output, where buildings appear as distinct surfaces that shadows fall *onto*.

---

## Background: What ShadeMap Actually Renders

ShadeMap produces two simultaneous visual outputs:

1. **Shadow polygons** — dark shapes cast by buildings onto the ground and other surfaces
2. **Building rooftop fills** — flat fills on top of building footprints so that shadows landing on a roof are visually distinct from shadows on the ground

Without (2), shadows visually "pass through" buildings as if they were flat ground. The rooftop layer also acts as an occluder — it sits above the shadow layer so that a building does not show its own shadow on its own roof.

---

## What to Change

**File:** `src/lib/shadow/LocalShadowAdapter.ts`

**No other files change.** `IShadowLayer`, `ShadeMapAdapter`, `createShadowLayer`, and `MapView.tsx` are all untouched.

---

## New Constants to Add

Add these alongside the existing `SHADOW_SOURCE` / `SHADOW_LAYER` constants at the top of the file:

```ts
const BUILDING_SOURCE  = 'local-building-source';
const BUILDING_LAYER   = 'local-building-layer';

// Neutral warm-grey rooftop color — visually matches ShadeMap's building top fill.
// Must be clearly different from SHADOW_COLOR so the contrast is readable.
const BUILDING_COLOR   = '#d4cfc9';
const BUILDING_OPACITY = 1.0;
```

---

## Layer Initialisation — `initLayer()`

Add a **second** GeoJSON source and `fill` layer for buildings. It must be added **after** the shadow layer so it renders on top of shadows (buildings occlude their own shadows).

Replace the existing `initLayer()` method with:

```ts
private initLayer() {
  // ── Shadow layer ──────────────────────────────────────────────────────────
  if (!this.map.getSource(SHADOW_SOURCE)) {
    this.map.addSource(SHADOW_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    this.map.addLayer({
      id: SHADOW_LAYER,
      type: 'fill',
      source: SHADOW_SOURCE,
      paint: {
        'fill-color': SHADOW_COLOR,
        'fill-opacity': SHADOW_OPACITY,
      },
    });
  }

  // ── Building rooftop layer — added AFTER shadow so it renders on top ──────
  if (!this.map.getSource(BUILDING_SOURCE)) {
    this.map.addSource(BUILDING_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    this.map.addLayer({
      id: BUILDING_LAYER,
      type: 'fill',
      source: BUILDING_SOURCE,
      paint: {
        'fill-color': BUILDING_COLOR,
        'fill-opacity': BUILDING_OPACITY,
      },
    });
  }
}
```

---

## Cleanup — `remove()`

The `remove()` method must clean up both layers and both sources. Replace with:

```ts
remove() {
  if (this.map.getLayer(BUILDING_LAYER))   this.map.removeLayer(BUILDING_LAYER);
  if (this.map.getSource(BUILDING_SOURCE)) this.map.removeSource(BUILDING_SOURCE);
  if (this.map.getLayer(SHADOW_LAYER))     this.map.removeLayer(SHADOW_LAYER);
  if (this.map.getSource(SHADOW_SOURCE))   this.map.removeSource(SHADOW_SOURCE);
}
```

> **Order matters:** remove layers before sources, and remove the building layer before the shadow layer (reverse of add order).

---

## Rendering — `render()`

Inside the existing `render()` method, after the `buildings` array is built and the shadow `features` are assembled, extract the building footprint polygons into a **separate** GeoJSON collection and push it to the building source.

Find the section at the end of `render()` that calls `source.setData(...)` and extend it as follows:

```ts
// --- existing shadow features assembly (unchanged) ---
const shadowFeatures = buildings.flatMap(b => {
  // ... existing shadow projection logic, unchanged ...
});

// --- NEW: building footprint features ---
const buildingFeatures = buildings.flatMap(b => {
  if (b.geometry.type !== 'Polygon' && b.geometry.type !== 'MultiPolygon') return [];

  const rings =
    b.geometry.type === 'Polygon'
      ? b.geometry.coordinates
      : b.geometry.coordinates.flat(1);

  return rings.map(ring => ({
    type: 'Feature' as const,
    geometry: {
      type: 'Polygon' as const,
      coordinates: [ring as [number, number][]],
    },
    properties: {},
  }));
});

// Push shadow polygons
source.setData({ type: 'FeatureCollection', features: shadowFeatures });

// Push building footprints
const buildingSource = this.map.getSource(BUILDING_SOURCE) as maplibregl.GeoJSONSource;
if (buildingSource) {
  buildingSource.setData({ type: 'FeatureCollection', features: buildingFeatures });
}
```

Also handle the **early-exit paths** — when the sun is below the horizon or zoom is too low, clear both sources:

```ts
// Sun below horizon → full dark overlay, no buildings visible
if (sun.altitude <= 0) {
  source.setData(fullDarkOverlay());
  const bs = this.map.getSource(BUILDING_SOURCE) as maplibregl.GeoJSONSource;
  if (bs) bs.setData({ type: 'FeatureCollection', features: [] });
  return;
}

// Zoom too low → clear both
if (this.map.getZoom() < 12) {
  source.setData({ type: 'FeatureCollection', features: [] });
  const bs = this.map.getSource(BUILDING_SOURCE) as maplibregl.GeoJSONSource;
  if (bs) bs.setData({ type: 'FeatureCollection', features: [] });
  return;
}
```

---

## Layer Ordering with `bringNavOverlaysToFront()`

`LocalShadowAdapter` now adds two layers: `local-shadow-layer` and `local-building-layer`. The existing `bringNavOverlaysToFront()` call in `MapView.tsx` moves navigation overlays to the front — this continues to work correctly because both new layers are standard MapLibre layers.

**No changes needed in `MapView.tsx`.**

If your `bringNavOverlaysToFront()` function explicitly lists layers to move, confirm it does **not** accidentally move `local-shadow-layer` or `local-building-layer` above navigation overlays. The correct visual stack from bottom to top is:

```
base tile layers
  └── local-shadow-layer      ← shadows on ground
  └── local-building-layer    ← building rooftops (occlude their own shadow)
  └── navigation route layers
  └── nav UI overlays
```

---

## Verification

After implementing:

- [ ] Buildings appear as flat `#d4cfc9` fills at zoom ≥ 12
- [ ] Shadow polygons are visible on the ground around buildings
- [ ] Building fills sit **on top of** shadows (a building does not show its own shadow on its own footprint)
- [ ] At zoom < 12, both layers are empty (no fills, no shadows)
- [ ] At night (sun below horizon), the full dark overlay shows and building fills are cleared
- [ ] `remove()` cleans up both layers and sources without errors on component unmount
- [ ] `sampleEdgeShade` pixel sampling in routing still works — the `#01112f` shadow color preserves the `B/R > 1.8` heuristic; building fill `#d4cfc9` has roughly equal R/B so it does not false-positive as shadow
- [ ] No TypeScript errors (`npm run build` clean)
- [ ] `npm test` passes