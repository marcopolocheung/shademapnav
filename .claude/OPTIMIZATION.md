# ShadeMap — Timeline Slider Lag Fix
## ClaudeCode Implementation Plan

> **Goal:** Eliminate lag spikes when dragging the time slider by fixing three root causes in `LocalShadowAdapter.ts`. The app must use `LocalShadowAdapter` exclusively (no ShadeMap API).

---

## Pre-flight: Read before touching anything

At the start of your session, read these files in full before making any edits:

```
app/lib/shadow/LocalShadowAdapter.ts
app/lib/shadow/IShadowLayer.ts
app/lib/shadow/createShadowLayer.ts
app/components/MapView.tsx          ← lines 1–80 only
app/page.tsx                        ← search "shadeUpdateTimerRef", read ±40 lines
```

After reading, verify your understanding by confirming:
1. Where `computeShadowGeometry()` is called and what triggers it
2. How `setDate()` flows from the slider event to the WebGL draw calls
3. What data is rebuilt vs reused between frames

**Do not make any edits until you have confirmed these three points.**

> ⚠️ `maplibre-gl` is pinned to `5.9.0`. Do not suggest or apply any version change to this package under any circumstances.

---

## Phase 1 — Sun angle dirty check

**File:** `app/lib/shadow/LocalShadowAdapter.ts`  
**Problem:** `setDate()` recomputes sun azimuth/altitude on every pointer event. The slider fires ~60 events/second on desktop and bursty bursts on mobile, causing redundant geometry rebuilds when the sun has barely moved.

**Task:** Add a sun-angle dirty check so `computeShadowGeometry()` is skipped when the sun position hasn't changed enough to matter.

**Requirements:**
- Add a named constant at the top of the file:
  ```ts
  const SUN_ANGLE_REBUILD_THRESHOLD_DEG = 0.15;
  ```
- Store last computed sun position on the adapter instance:
  ```ts
  private lastSunAzimuthDeg: number | null = null;
  private lastSunAltitudeDeg: number | null = null;
  ```
- Inside `setDate()`, after computing the new sun position, skip `computeShadowGeometry()` if **both** azimuth and altitude are within `SUN_ANGLE_REBUILD_THRESHOLD_DEG` of the stored values
- Update the stored values whenever geometry IS rebuilt
- The existing 1ms debounce in `MapView.tsx` (`shadeUpdateTimerRef`) must remain untouched — this dirty check is a complementary second guard inside the adapter itself

**Do not change** `IShadowLayer.ts`, `MapView.tsx`, or any other file.

**Verification:** Add temporary instrumentation after implementing:
```ts
// PERF: temporary — remove after confirming
console.time("sun-dirty-check");
// ... dirty check logic ...
console.timeEnd("sun-dirty-check");
```

---

## Phase 2 — Split and cache building geometry

**File:** `app/lib/shadow/LocalShadowAdapter.ts`  
**Problem:** `computeShadowGeometry()` rebuilds all building vertex arrays (footprints, roof triangulations) on every `setDate()` call. On mobile with 200+ buildings loaded, this is the largest source of frame-drop spikes. Building footprints do not change when time changes — only the shadow extrusion direction does.

**Task:** Split `computeShadowGeometry()` into two functions and cache the static part.

### Step 2a — Show signatures first

Before writing the full implementation, output **only the new function signatures** and wait for approval:

```ts
// Show these signatures and STOP. Do not implement yet.
private buildBuildingGeometryCache(): CachedBuildingGeometry
private extrudeShadows(sunVec: Vec3, cache: CachedBuildingGeometry): ShadowGeometry
```

Define a `CachedBuildingGeometry` interface that holds the roof verts, footprint triangulations, and a cache key. Include a `// PERF:` comment on the interface explaining the invalidation strategy.

### Step 2b — Implement after approval

Once the signatures are approved, implement the split:

- `buildBuildingGeometryCache()` — computes footprints and roof triangulations; result stored on `this.buildingCache`
- `extrudeShadows(sunVec, cache)` — applies shadow extrusion offset based on sun direction; runs every frame
- Invalidate `this.buildingCache` (set to `null`) on:
  - `map.on("moveend")`
  - `map.on("zoomend")`
- In `setDate()`, call `buildBuildingGeometryCache()` only when `this.buildingCache === null`, then always call `extrudeShadows()`

**Constraint:** Only edit `LocalShadowAdapter.ts`. Do not modify the `IShadowLayer` interface or any callers.

**Verification:** Add instrumentation:
```ts
// PERF: temporary — remove after confirming
console.time("building-cache-rebuild");
this.buildingCache = this.buildBuildingGeometryCache();
console.timeEnd("building-cache-rebuild");
```
Expected result: `building-cache-rebuild` fires only on map pan/zoom, never during slider drags.

---

## Phase 3 — WebGL buffer dirty check

**File:** `app/lib/shadow/LocalShadowAdapter.ts`  
**Problem:** The 4-pass WebGL render re-uploads vertex buffers to the GPU every frame via `gl.bufferData()`, even when geometry is identical to the previous frame. This wastes GPU bandwidth on every `render()` call.

**Task:** Add a version counter so GPU uploads are skipped when geometry hasn't changed.

**Requirements:**
- Add to the adapter instance:
  ```ts
  private geomVersion: number = 0;
  private lastUploadedVersion: number = -1;
  ```
- Increment `geomVersion` every time `extrudeShadows()` (from Phase 2) produces new geometry
- In the `render()` method, wrap all `gl.bufferData()` calls:
  ```ts
  if (this.geomVersion !== this.lastUploadedVersion) {
    // ... gl.bufferData() calls ...
    this.lastUploadedVersion = this.geomVersion;
  }
  ```
- `gl.drawArrays()` must still be called every frame regardless — MapLibre requires the custom layer to draw on every render tick

**Constraint:** This is purely additive. Do not remove or restructure any existing render logic.

---

## Phase 4 — Offload sun math to a Web Worker

**File:** `app/workers/sunPosition.worker.ts` (new file)  
**Problem:** Sun position calculation (azimuth/altitude from lat/lon/datetime) runs synchronously on the main thread. On mobile, this blocks touch event processing and causes jank.

### Step 4a — Locate sun math first

Before writing any code, find where sun position math currently lives:
- Is it inline in `LocalShadowAdapter.ts`?
- Is it imported from a utility file?

Report the answer and the exact function/import involved. Do not write any code yet.

### Step 4b — Check for Comlink

Run:
```bash
grep -r "comlink" package.json package-lock.json 2>/dev/null
```

If Comlink is present, use it. If not, use a plain `postMessage`/`onmessage` pattern. **Do not add any new npm packages.**

### Step 4c — Implement

Create `app/workers/sunPosition.worker.ts`:
```ts
// Worker receives: { lat: number, lon: number, timestamp: number }
// Worker posts back: { azimuthDeg: number, altitudeDeg: number }
```

In `LocalShadowAdapter.ts`:
- Instantiate the worker once in the constructor, store as `this.sunWorker`
- Make `setDate()` post to the worker and await the response before triggering geometry rebuild
- The `SUN_ANGLE_REBUILD_THRESHOLD_DEG` dirty check from Phase 1 runs **after** the worker responds, not before posting

**Vite worker import syntax** (required for this stack):
```ts
import SunWorker from '../workers/sunPosition.worker?worker';
this.sunWorker = new SunWorker();
```

---

## Phase 5 — Remove ShadeMap API path

**Files:** `app/lib/shadow/createShadowLayer.ts`, `app/components/MapView.tsx`, `.env.local`

**Task:** Ensure `LocalShadowAdapter` is always used. Remove dead code paths for the ShadeMap API adapter.

**Requirements:**
- In `createShadowLayer.ts`, remove any conditional that selects `ShadeMapAdapter` based on env vars or feature flags — always return a `LocalShadowAdapter` instance
- In `MapView.tsx`, remove any import or reference to `ShadeMapAdapter`
- Remove `VITE_SHADEMAP_API_KEY` from `.env.local.example` and add a comment explaining it is no longer used
- Do not delete `ShadeMapAdapter.ts` itself yet — leave it in place but unused (safe to delete later after confirming nothing imports it)

---

## Verification checklist

After all phases are complete, confirm the following in the browser DevTools console:

| Check | Expected |
|---|---|
| `building-cache-rebuild` timing | Fires on map pan/zoom only, never during slider drag |
| `sun-dirty-check` timing | Exits early (no rebuild) for most slider events |
| GPU buffer uploads | Only fires when `geomVersion` increments |
| Sun worker | `sunPosition.worker.ts` visible in DevTools Sources |
| No ShadeMap API calls | Network tab shows zero requests to `shademap.app` |

Then remove all `// PERF: temporary` instrumentation comments.

---

## Constraints that apply to all phases

- `maplibre-gl` stays at `5.9.0` — no version changes
- Do not modify `IShadowLayer.ts` interface
- Do not add new npm packages
- Each phase edits only the files listed for that phase
- After Phase 2 Step 2a, stop and wait for signature approval before implementing
- All new constants and private fields get a `// PERF:` comment explaining their purpose