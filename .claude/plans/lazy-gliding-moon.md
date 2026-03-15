# Plan: ShadeMap API Fallback — Local Shadow Renderer

## Context

The app currently hard-depends on `mapbox-gl-shadow-simulator` (ShadeMap API) for shadow rendering. The API key is free but only works on localhost. This plan implements a fallback `LocalShadowAdapter` using `suncalc` + MapLibre GeoJSON layers that activates when the ShadeMap API key is missing or fails. The local renderer produces building shadows with the same `#01112f` color so shade-aware routing (`B/R > 1.8` heuristic) continues working.

## Path Convention Fix

The spec says `src/lib/shadow/` but the project uses `app/lib/` — all new files go under **`app/lib/shadow/`**.

## Spec Gaps to Address

The PROBLEMS.md `IShadowLayer` interface only defines `setDate`, `resize`, `remove`. But MapView.tsx also calls:

1. **`setSunExposure(enabled, opts)`** — accumulation mode (lines 729, 807-813). Must be in the interface (no-op in LocalShadowAdapter).
2. **`.on('idle', callback)`** — used to call `bringNavOverlaysToFront` (line 719). Must be in the interface or handled separately.
3. **`.addTo(map)`** — ShadeMap chains this; factory must handle it inside `ShadeMapAdapter`.

---

## Steps

### Step 1 — Install `suncalc`

```bash
npm install suncalc
npm install --save-dev @types/suncalc
```

### Step 2 — Create `app/lib/shadow/IShadowLayer.ts`

Extended interface (beyond spec) to cover actual usage:

```ts
export interface IShadowLayer {
  setDate(date: Date): void;
  resize(): void;
  remove(): void;
  setSunExposure(enabled: boolean, opts?: { startDate: Date; endDate: Date; iterations: number }): void;
  on(event: string, callback: () => void): void;
}
```

### Step 3 — Create `app/lib/shadow/ShadeMapAdapter.ts`

Wraps the existing ShadeMap instance. Delegates all calls. Nearly identical to spec but adds `setSunExposure` and `on` delegation.

### Step 4 — Create `app/lib/shadow/LocalShadowAdapter.ts`

Per the spec: `suncalc` + MapLibre GeoJSON `fill` layer. Building shadows computed from sun azimuth/altitude + building height, rendered as convex hulls. Key details:
- Shadow color `#01112f`, opacity 0.72 — preserves `B/R > 1.8` shade sampling
- Queries `maptiler_planet` / `building` source (same as ShadeMap)
- `setSunExposure` → no-op (accumulation not supported in local mode)
- `on('idle', cb)` → call immediately after render (no async texture pipeline)
- Below zoom 12 → empty features (matches existing guard)
- Sun below horizon → full dark overlay

### Step 5 — Create `app/lib/shadow/createShadowLayer.ts`

Factory function per spec. Probes ShadeMap with 1500ms timeout; falls back to LocalShadowAdapter. Console logs which path was taken.

### Step 6 — Edit `MapView.tsx` (only existing file changed)

**Replace lines 688-718** (ShadeMap import + construction + `shadeRef` assignment) with the `createShadowLayer` factory call. Keep everything else (resize handler, `on('idle')`, accumulation, cleanup) unchanged — they all go through the `IShadowLayer` interface now.

Key change: `shadeRef` type becomes `useRef<IShadowLayer | null>(null)` instead of `useRef<any>(null)`.

### Files modified:
- `app/lib/shadow/IShadowLayer.ts` — **new**
- `app/lib/shadow/ShadeMapAdapter.ts` — **new**
- `app/lib/shadow/LocalShadowAdapter.ts` — **new**
- `app/lib/shadow/createShadowLayer.ts` — **new**
- `app/components/MapView.tsx` — **edit** (ShadeMap construction block only)

### Files NOT modified:
- `page.tsx` — `sampleEdgeShade` / `sampleBothSidewalks` reads canvas pixels, unaffected
- `AccumulationPanel.tsx` — reads canvas via `getImageData`, unaffected
- `routing.ts`, `overpass.ts` — no shadow dependency
- `package.json` — only `suncalc` added via npm

---

## Verification

1. `npm run dev` starts without errors
2. On localhost with API key: console shows `[shadow] ShadeMap API active`
3. Without API key: console shows `[shadow] No ShadeMap key — using local renderer`, building shadows render
4. Timeline slider drag updates shadows in real time
5. Shade-aware routing returns correct route cards (shade sampling reads canvas pixels, works with both backends)
6. Window resize → shadows resize correctly
7. Play/pause animation works
8. `npm test` passes
