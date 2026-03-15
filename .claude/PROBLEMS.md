# Fix: Tall Building Height Accuracy (building_part layer)

## Problem

Complex tall buildings (e.g. Taipei 101) are rendered as a single extruded polygon at the maximum height of the entire structure. A building with a wide 30m podium and a narrow 509m tower casts a shadow as if the entire footprint is 509m tall.

**Root cause:** `getFeatures()` only queries the `building` layer, which returns one feature per building relation tagged with the aggregate max height. The individual `building:part` members — each with their own footprint and correct height — are available in the `building_part` layer but are never queried.

## Scope of Change

The behavioral fix is entirely in **`getFeatures()`** in `MapView.tsx`.

Note: The local renderer (`LocalShadowAdapter`) also queries the building vector
tiles internally, so it needs to use the same selection/height fallback rules.
That implementation detail lives in `app/lib/shadow/LocalShadowAdapter.ts`,
but it should remain a pure “feature selection + height normalization” change
as well (no WebGL changes).

---

## Height Threshold

Only apply the `building_part` substitution for buildings taller than **100m**. Below that threshold, the height inaccuracy is visually negligible and not worth the extra feature count.

---

## Implementation

Modify `getFeatures()` as follows:

### Step 1 — Query building_part layer alongside building layer

`building_part` features are in the same `maptiler_planet` source. Query it the same way the `building` layer is queried:

```ts
const partFeatures = map.querySourceFeatures('maptiler_planet', {
  sourceLayer: 'building_part',
});
```

### Step 2 — Build a lookup of which building footprints have tall parts

Iterate the `building_part` features. For each part, extract its height (same fallback logic as buildings: `render_height ?? height ?? building:levels * 3.1 ?? 3.1`). If any part exceeds 100m, record the parent building's footprint as "covered by parts."

The simplest way to associate parts to parent buildings is **spatial**: a part whose geometry centroid falls inside a building polygon belongs to that building. Use the existing bounding-box or point-in-polygon approach already present in the codebase if one exists — otherwise a simple centroid containment check is sufficient.

### Step 3 — Substitute parts for tall parent buildings

When assembling the final feature list:

- For each `building` feature:
  - Compute its height using the same fallback chain
  - If height **≤ 100m**: include it as-is (existing behaviour, no change)
  - If height **> 100m**: **skip it** — its parts will be included instead
- Append all `building_part` features whose parent building height exceeded 100m

### Step 4 — Apply the same height fallback and sort to part features

`building_part` features need the same treatment as building features:
- Extract height via: `render_height ?? height ?? building:levels * 3.1 ?? 3.1`
- Include them in the same shortest→tallest sort that already exists at the end of `getFeatures()`

---

## What Not To Change

- Do **not** query `building_part` for buildings at or below 100m
- Do **not** change the height fallback logic for regular buildings
- Do **not** modify `computeShadowGeometry()` or any WebGL pass
- Do **not** change the zoom < 12 early-return — `building_part` features aren't loaded below zoom 12 anyway, so the guard already covers both layers
- Do **not** add any new npm packages

---

## Verification

1. `npx tsc --noEmit` — zero new errors
2. `npm test` — existing tests pass (pre-existing Foursquare failures are unrelated)
3. Navigate to Taipei 101 (~zoom 15). Confirm the wide podium casts a short wide shadow and the tower casts a narrow tall shadow, rather than one giant extruded blob covering the whole footprint
4. Navigate to a low-rise residential area. Confirm no visual change — simple buildings are completely unaffected
5. Check a dense high-rise district (e.g. central Taipei, Shinjuku). Shadow recalculation should feel the same as before — only buildings >100m are affected and those are relatively rare even in dense areas